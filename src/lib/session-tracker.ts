import { getMemoryClient } from "./memory-cache";
import { logger } from "@/lib/logger";

/**
 * Session 追踪器 - 统一管理活跃 Session 集合
 *
 * 核心功能：
 * 1. 使用 Sorted Set (ZSET) 管理 session 生命周期（基于时间戳）
 * 2. 自动清理过期 session（5 分钟无活动）
 * 3. 验证 session:${sessionId}:info 是否存在（双重保障）
 * 4. 兼容旧格式（Set）实现零停机迁移
 *
 * 数据结构：
 * - global:active_sessions (ZSET): score = timestamp, member = sessionId
 * - key:${keyId}:active_sessions (ZSET): 同上
 * - provider:${providerId}:active_sessions (ZSET): 同上
 */
export class SessionTracker {
  private static readonly SESSION_TTL = 300000; // 5 分钟（毫秒）

  /**
   * 初始化 SessionTracker
   *
   * 应在应用启动时调用一次。
   * 对于 InMemoryStore，所有数据结构都是新的，无需清理旧格式。
   */
  static async initialize(): Promise<void> {
    const memoryClient = getMemoryClient();
    if (!memoryClient || memoryClient.status !== "ready") {
      logger.warn("SessionTracker: Memory store not ready, skipping initialization");
      return;
    }

    // InMemoryStore uses native ZSET implementation, no legacy format cleanup needed
    logger.trace("SessionTracker: Initialized with InMemoryStore");
  }

  /**
   * 追踪 session（添加到全局和 key 级集合）
   *
   * 调用时机：SessionGuard 分配 sessionId 后
   *
   * @param sessionId - Session ID
   * @param keyId - API Key ID
   */
  static async trackSession(sessionId: string, keyId: number): Promise<void> {
    const memoryClient = getMemoryClient();
    if (!memoryClient || memoryClient.status !== "ready") return;

    try {
      const now = Date.now();
      const pipeline = memoryClient.pipeline();

      // 添加到全局集合（ZSET）
      pipeline.zadd("global:active_sessions", now, sessionId);
      pipeline.expire("global:active_sessions", 3600); // 1 小时兜底 TTL

      // 添加到 key 级集合（ZSET）
      pipeline.zadd(`key:${keyId}:active_sessions`, now, sessionId);
      pipeline.expire(`key:${keyId}:active_sessions`, 3600);

      const results = await pipeline.exec();

      // 检查执行结果
      if (results) {
        for (const [err] of results) {
          if (err) {
            logger.error("SessionTracker: Pipeline command failed", { error: err });
          }
        }
      }

      logger.trace("SessionTracker: Tracked session", { sessionId, keyId });
    } catch (error) {
      logger.error("SessionTracker: Failed to track session", { error });
    }
  }

  /**
   * 更新 session 的 provider 信息（同时刷新时间戳）
   *
   * 调用时机：ProviderResolver 选择 provider 后
   *
   * @param sessionId - Session ID
   * @param providerId - Provider ID
   */
  static async updateProvider(sessionId: string, providerId: number): Promise<void> {
    const memoryClient = getMemoryClient();
    if (!memoryClient || memoryClient.status !== "ready") return;

    try {
      const now = Date.now();
      const pipeline = memoryClient.pipeline();

      // 更新全局集合时间戳
      pipeline.zadd("global:active_sessions", now, sessionId);

      // 添加到 provider 级集合（ZSET）
      pipeline.zadd(`provider:${providerId}:active_sessions`, now, sessionId);
      pipeline.expire(`provider:${providerId}:active_sessions`, 3600);

      const results = await pipeline.exec();

      // 检查执行结果
      if (results) {
        for (const [err] of results) {
          if (err) {
            logger.error("SessionTracker: Pipeline command failed", { error: err });
          }
        }
      }

      logger.trace("SessionTracker: Updated provider", { sessionId, providerId });
    } catch (error) {
      logger.error("SessionTracker: Failed to update provider", { error });
    }
  }

  /**
   * 刷新 session 时间戳（滑动窗口）
   *
   * 调用时机：响应完成时
   *
   * @param sessionId - Session ID
   * @param keyId - API Key ID
   * @param providerId - Provider ID
   */
  static async refreshSession(sessionId: string, keyId: number, providerId: number): Promise<void> {
    const memoryClient = getMemoryClient();
    if (!memoryClient || memoryClient.status !== "ready") return;

    try {
      const now = Date.now();
      const pipeline = memoryClient.pipeline();

      // 更新所有相关 ZSET 的时间戳（滑动窗口）
      pipeline.zadd("global:active_sessions", now, sessionId);
      pipeline.zadd(`key:${keyId}:active_sessions`, now, sessionId);
      pipeline.zadd(`provider:${providerId}:active_sessions`, now, sessionId);

      // 同步刷新 session 绑定信息的 TTL
      // 确保 ZSET 和绑定信息保持 5 分钟生命周期一致
      pipeline.expire(`session:${sessionId}:provider`, 300); // 5 分钟（秒）
      pipeline.expire(`session:${sessionId}:key`, 300);
      pipeline.setex(`session:${sessionId}:last_seen`, 300, now.toString());

      const results = await pipeline.exec();

      // 检查执行结果
      if (results) {
        for (const [err] of results) {
          if (err) {
            logger.error("SessionTracker: Pipeline command failed", { error: err });
          }
        }
      }

      logger.trace("SessionTracker: Refreshed session", { sessionId });
    } catch (error) {
      logger.error("SessionTracker: Failed to refresh session", { error });
    }
  }

  /**
   * 获取全局活跃 session 计数
   *
   * @returns 活跃 session 数量
   */
  static async getGlobalSessionCount(): Promise<number> {
    const memoryClient = getMemoryClient();
    if (!memoryClient || memoryClient.status !== "ready") return 0;

    try {
      const key = "global:active_sessions";
      return await this.countFromZSet(key);
    } catch (error) {
      logger.error("SessionTracker: Failed to get global session count", { error });
      return 0; // Fail Open
    }
  }

  /**
   * 获取 Key 级活跃 session 计数
   *
   * @param keyId - API Key ID
   * @returns 活跃 session 数量
   */
  static async getKeySessionCount(keyId: number): Promise<number> {
    const memoryClient = getMemoryClient();
    if (!memoryClient || memoryClient.status !== "ready") return 0;

    try {
      const key = `key:${keyId}:active_sessions`;
      return await this.countFromZSet(key);
    } catch (error) {
      logger.error("SessionTracker: Failed to get key session count", { error, keyId });
      return 0;
    }
  }

  /**
   * 获取 Provider 级活跃 session 计数
   *
   * @param providerId - Provider ID
   * @returns 活跃 session 数量
   */
  static async getProviderSessionCount(providerId: number): Promise<number> {
    const memoryClient = getMemoryClient();
    if (!memoryClient || memoryClient.status !== "ready") return 0;

    try {
      const key = `provider:${providerId}:active_sessions`;
      return await this.countFromZSet(key);
    } catch (error) {
      logger.error("SessionTracker: Failed to get provider session count", { error, providerId });
      return 0;
    }
  }

  /**
   * 获取活跃 session ID 列表（用于详情页）
   *
   * @returns Session ID 数组
   */
  static async getActiveSessions(): Promise<string[]> {
    const memoryClient = getMemoryClient();
    if (!memoryClient || memoryClient.status !== "ready") return [];

    try {
      const key = "global:active_sessions";
      const now = Date.now();
      const fiveMinutesAgo = now - this.SESSION_TTL;

      // 清理过期 session
      await memoryClient.zremrangebyscore(key, -Infinity, fiveMinutesAgo);

      // 获取剩余的 session ID
      return (await memoryClient.zrange(key, 0, -1)) as string[];
    } catch (error) {
      logger.error("SessionTracker: Failed to get active sessions", { error });
      return [];
    }
  }

  /**
   * 从 ZSET 计数
   *
   * 实现步骤：
   * 1. ZREMRANGEBYSCORE 清理过期 session（5 分钟前）
   * 2. ZRANGE 获取剩余 session ID
   * 3. 批量 EXISTS 验证 session:${sessionId}:info 是否存在
   * 4. 统计真实存在的 session
   *
   * @param key - Memory cache key
   * @returns 有效 session 数量
   */
  private static async countFromZSet(key: string): Promise<number> {
    const memoryClient = getMemoryClient();
    if (!memoryClient || memoryClient.status !== "ready") return 0;

    try {
      const now = Date.now();
      const fiveMinutesAgo = now - this.SESSION_TTL;

      // 1. 清理过期 session（5 分钟前）
      await memoryClient.zremrangebyscore(key, -Infinity, fiveMinutesAgo);

      // 2. 获取剩余的 session ID
      const sessionIds = (await memoryClient.zrange(key, 0, -1)) as string[];
      if (sessionIds.length === 0) return 0;

      // 3. 批量验证 info 是否存在
      const pipeline = memoryClient.pipeline();
      for (const sessionId of sessionIds) {
        pipeline.exists(`session:${sessionId}:info`);
      }
      const results = await pipeline.exec();
      if (!results) return 0;

      // 4. 统计有效 session
      let count = 0;
      for (const result of results) {
        if (result && result[0] === null && result[1] === 1) {
          count++;
        }
      }

      logger.trace("SessionTracker: ZSET count", {
        key,
        validSessions: count,
        total: sessionIds.length,
      });
      return count;
    } catch (error) {
      logger.error("SessionTracker: Failed to count from ZSET", { error, key });
      return 0;
    }
  }

  /**
   * 增加 session 并发计数
   *
   * 调用时机：请求开始时（在 proxy-handler.ts 中）
   *
   * @param sessionId - Session ID
   */
  static async incrementConcurrentCount(sessionId: string): Promise<void> {
    const memoryClient = getMemoryClient();
    if (!memoryClient || memoryClient.status !== "ready") return;

    try {
      const key = `session:${sessionId}:concurrent_count`;
      await memoryClient.incr(key);
      await memoryClient.expire(key, 600); // 10 分钟 TTL（比 session TTL 长一倍，防止计数泄漏）

      logger.trace("SessionTracker: Incremented concurrent count", { sessionId });
    } catch (error) {
      logger.error("SessionTracker: Failed to increment concurrent count", { error, sessionId });
    }
  }

  /**
   * 减少 session 并发计数
   *
   * 调用时机：请求结束时（在 proxy-handler.ts 的 finally 块中）
   *
   * @param sessionId - Session ID
   */
  static async decrementConcurrentCount(sessionId: string): Promise<void> {
    const memoryClient = getMemoryClient();
    if (!memoryClient || memoryClient.status !== "ready") return;

    try {
      const key = `session:${sessionId}:concurrent_count`;
      const newCount = await memoryClient.decr(key);

      // 如果计数降到 0 或负数，删除 key（避免无用 key 堆积）
      if (newCount <= 0) {
        await memoryClient.del(key);
      }

      logger.trace("SessionTracker: Decremented concurrent count", { sessionId, newCount });
    } catch (error) {
      logger.error("SessionTracker: Failed to decrement concurrent count", { error, sessionId });
    }
  }

  /**
   * 获取 session 当前并发计数
   *
   * 调用时机：SessionManager 分配 session ID 时
   *
   * @param sessionId - Session ID
   * @returns 并发请求数量
   */
  static async getConcurrentCount(sessionId: string): Promise<number> {
    const memoryClient = getMemoryClient();
    if (!memoryClient || memoryClient.status !== "ready") {
      logger.trace("SessionTracker: Memory store not ready, returning 0 for concurrent count");
      return 0;
    }

    try {
      const key = `session:${sessionId}:concurrent_count`;
      const count = await memoryClient.get(key);

      const result = count ? parseInt(count, 10) : 0;
      logger.trace("SessionTracker: Got concurrent count", { sessionId, count: result });
      return result;
    } catch (error) {
      logger.error("SessionTracker: Failed to get concurrent count", { error, sessionId });
      return 0; // Fail Open（降级策略）
    }
  }
}
