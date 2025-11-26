/**
 * ============================================================================
 * Rate Limit Service - In-Memory Cache Key Naming Conventions
 * ============================================================================
 *
 * This service implements cost tracking using different in-memory data structures
 * based on the time window mode (fixed vs rolling). Understanding the key
 * naming patterns is crucial for debugging and maintenance.
 *
 * NOTE: This service has been migrated from Redis to InMemoryStore for
 * the Electron desktop app. All Lua scripts have been replaced with
 * JavaScript equivalents in src/lib/memory-cache/scripts/.
 *
 * ## Key Naming Patterns
 *
 * ### 1. Fixed Time Window Keys (STRING type)
 *    Format: `{type}:{id}:cost_daily_{suffix}`
 *    Example: `key:123:cost_daily_1800` (resets at 18:00)
 *             `provider:456:cost_daily_0000` (resets at 00:00)
 *
 *    - Uses STRING type with incrbyfloat
 *    - Suffix is the reset time without colon (HH:mm -> HHmm)
 *    - TTL: Dynamic, calculated to the next reset time
 *    - Use case: Custom daily reset times (e.g., 18:00, 09:30)
 *
 * ### 2. Rolling Window Keys (ZSET type)
 *    Format: `{type}:{id}:cost_daily_rolling`
 *    Example: `key:123:cost_daily_rolling`
 *             `provider:456:cost_daily_rolling`
 *
 *    - Uses ZSET type with atomic scripts
 *    - No time suffix - always "rolling"
 *    - TTL: Fixed 24 hours (86400 seconds)
 *    - Use case: True rolling 24-hour window (past 24 hours from now)
 *
 * ### 3. Other Period Keys (STRING type)
 *    Format: `{type}:{id}:cost_{period}`
 *    Example: `key:123:cost_weekly` (Monday 00:00 reset)
 *             `key:123:cost_monthly` (1st day 00:00 reset)
 *             `key:123:cost_5h_rolling` (5-hour rolling, ZSET)
 *
 * ## Why Different Patterns?
 *
 * ### Fixed Mode (`cost_daily_{suffix}`)
 * - **Problem**: Multiple users may have different daily reset times
 * - **Solution**: Include reset time in key name to avoid conflicts
 * - **Example**: User A resets at 18:00, User B resets at 00:00
 *   - Key A: `key:1:cost_daily_1800` (TTL to next 18:00)
 *   - Key B: `key:2:cost_daily_0000` (TTL to next 00:00)
 *
 * ### Rolling Mode (`cost_daily_rolling`)
 * - **Problem**: Rolling windows don't have a fixed reset time
 * - **Solution**: Use generic "rolling" suffix, no time needed
 * - **Advantage**: Simpler key naming, consistent TTL (24h)
 * - **Trade-off**: Requires ZSET + atomic script (more complex but precise)
 *
 * ## Data Structure Comparison
 *
 * | Mode    | Type   | Operations      | TTL Strategy        | Precision |
 * |---------|--------|-----------------|---------------------|-----------|
 * | Fixed   | STRING | incrbyfloat     | Dynamic (to reset)  | Minute    |
 * | Rolling | ZSET   | Script + zadd   | Fixed (24h)         | Millisec  |
 *
 * ## Related Files
 * - Scripts: src/lib/memory-cache/scripts/
 * - Time Utils: src/lib/rate-limit/time-utils.ts
 * - Memory Store: src/lib/memory-cache/
 *
 * ============================================================================
 */

import {
  getMemoryClient,
  checkAndTrackSession,
  trackCost5hRollingWindow,
  getCost5hRollingWindow,
  trackCostDailyRollingWindow,
  getCostDailyRollingWindow,
  type InMemoryStore,
} from "@/lib/memory-cache";
import { logger } from "@/lib/logger";
import { SessionTracker } from "@/lib/session-tracker";
import { sumUserCostToday } from "@/repository/statistics";
import {
  getTimeRangeForPeriodWithMode,
  getTTLForPeriod,
  getTTLForPeriodWithMode,
  getSecondsUntilMidnight,
  normalizeResetTime,
  type DailyResetMode,
} from "./time-utils";

interface CostLimit {
  amount: number | null;
  period: "5h" | "daily" | "weekly" | "monthly";
  name: string;
  resetTime?: string; // 自定义重置时间（仅 daily + fixed 模式使用，格式 "HH:mm"）
  resetMode?: DailyResetMode; // 日限额重置模式（仅 daily 使用）
}

export class RateLimitService {
  // 使用 getter 实现懒加载
  private static get memoryClient(): InMemoryStore {
    return getMemoryClient();
  }

  private static resolveDailyReset(resetTime?: string): { normalized: string; suffix: string } {
    const normalized = normalizeResetTime(resetTime);
    return { normalized, suffix: normalized.replace(":", "") };
  }

  /**
   * 检查金额限制（Key 或 Provider）
   * 优先使用 Redis，失败时降级到数据库查询（防止 Redis 清空后超支）
   */
  static async checkCostLimits(
    id: number,
    type: "key" | "provider",
    limits: {
      limit_5h_usd: number | null;
      limit_daily_usd: number | null;
      daily_reset_time?: string;
      daily_reset_mode?: DailyResetMode;
      limit_weekly_usd: number | null;
      limit_monthly_usd: number | null;
    }
  ): Promise<{ allowed: boolean; reason?: string }> {
    const normalizedDailyReset = normalizeResetTime(limits.daily_reset_time);
    const dailyResetMode = limits.daily_reset_mode ?? "fixed";
    const costLimits: CostLimit[] = [
      { amount: limits.limit_5h_usd, period: "5h", name: "5小时" },
      {
        amount: limits.limit_daily_usd,
        period: "daily",
        name: "每日",
        resetTime: normalizedDailyReset,
        resetMode: dailyResetMode,
      },
      { amount: limits.limit_weekly_usd, period: "weekly", name: "周" },
      { amount: limits.limit_monthly_usd, period: "monthly", name: "月" },
    ];

    try {
      // Fast Path: In-memory cache query
      const client = this.memoryClient;
      if (client && client.status === "ready") {
        const now = Date.now();
        const window5h = 5 * 60 * 60 * 1000; // 5 hours in ms

        for (const limit of costLimits) {
          if (!limit.amount || limit.amount <= 0) continue;

          let current = 0;

          // 5h uses rolling window script
          if (limit.period === "5h") {
            try {
              const key = `${type}:${id}:cost_5h_rolling`;
              const result = await getCost5hRollingWindow(client, key, now, window5h);

              current = parseFloat(result || "0");

              // Cache Miss detection: if returns 0 but key doesn't exist, fallback to database
              if (current === 0) {
                const exists = await client.exists(key);
                if (!exists) {
                  logger.info(
                    `[RateLimit] Cache miss for ${type}:${id}:cost_5h, querying database`
                  );
                  return await this.checkCostLimitsFromDatabase(id, type, costLimits);
                }
              }
            } catch (error) {
              logger.error(
                "[RateLimit] 5h rolling window query failed, fallback to database:",
                error
              );
              return await this.checkCostLimitsFromDatabase(id, type, costLimits);
            }
          } else if (limit.period === "daily" && limit.resetMode === "rolling") {
            // daily rolling window: uses ZSET script
            try {
              const key = `${type}:${id}:cost_daily_rolling`;
              const window24h = 24 * 60 * 60 * 1000;
              const result = await getCostDailyRollingWindow(client, key, now, window24h);

              current = parseFloat(result || "0");

              // Cache Miss detection
              if (current === 0) {
                const exists = await client.exists(key);
                if (!exists) {
                  logger.info(
                    `[RateLimit] Cache miss for ${type}:${id}:cost_daily_rolling, querying database`
                  );
                  return await this.checkCostLimitsFromDatabase(id, type, costLimits);
                }
              }
            } catch (error) {
              logger.error(
                "[RateLimit] Daily rolling window query failed, fallback to database:",
                error
              );
              return await this.checkCostLimitsFromDatabase(id, type, costLimits);
            }
          } else {
            // daily fixed/weekly/monthly use simple GET
            const { suffix } = this.resolveDailyReset(limit.resetTime);
            const periodKey = limit.period === "daily" ? `${limit.period}_${suffix}` : limit.period;
            const value = await client.get(`${type}:${id}:cost_${periodKey}`);

            // Cache Miss detection
            if (value === null && limit.amount > 0) {
              logger.info(
                `[RateLimit] Cache miss for ${type}:${id}:cost_${periodKey}, querying database`
              );
              return await this.checkCostLimitsFromDatabase(id, type, costLimits);
            }

            current = parseFloat((value as string) || "0");
          }

          if (current >= limit.amount) {
            return {
              allowed: false,
              reason: `${type === "key" ? "Key" : "供应商"} ${limit.name}消费上限已达到（${current.toFixed(4)}/${limit.amount}）`,
            };
          }
        }

        return { allowed: true };
      }

      // Slow Path: Cache unavailable, fallback to database
      logger.warn(`[RateLimit] Cache unavailable, checking ${type} cost limits from database`);
      return await this.checkCostLimitsFromDatabase(id, type, costLimits);
    } catch (error) {
      logger.error("[RateLimit] Check failed, fallback to database:", error);
      return await this.checkCostLimitsFromDatabase(id, type, costLimits);
    }
  }

  /**
   * 从数据库检查金额限制（降级路径）
   */
  private static async checkCostLimitsFromDatabase(
    id: number,
    type: "key" | "provider",
    costLimits: CostLimit[]
  ): Promise<{ allowed: boolean; reason?: string }> {
    const { sumKeyCostInTimeRange, sumProviderCostInTimeRange } = await import(
      "@/repository/statistics"
    );

    for (const limit of costLimits) {
      if (!limit.amount || limit.amount <= 0) continue;

      // 计算时间范围（使用支持模式的时间工具函数）
      const { startTime, endTime } = getTimeRangeForPeriodWithMode(
        limit.period,
        limit.resetTime,
        limit.resetMode
      );

      // 查询数据库
      const current =
        type === "key"
          ? await sumKeyCostInTimeRange(id, startTime, endTime)
          : await sumProviderCostInTimeRange(id, startTime, endTime);

      // Cache Warming: write back to memory cache
      const client = this.memoryClient;
      if (client && client.status === "ready") {
        try {
          if (limit.period === "5h") {
            // 5h rolling window: uses ZSET script
            if (current > 0) {
              const now = Date.now();
              const window5h = 5 * 60 * 60 * 1000;
              const key = `${type}:${id}:cost_5h_rolling`;

              await trackCost5hRollingWindow(client, key, current, now, window5h);

              logger.info(`[RateLimit] Cache warmed for ${key}, value=${current} (rolling window)`);
            }
          } else if (limit.period === "daily" && limit.resetMode === "rolling") {
            // daily rolling window: uses ZSET script
            if (current > 0) {
              const now = Date.now();
              const window24h = 24 * 60 * 60 * 1000;
              const key = `${type}:${id}:cost_daily_rolling`;

              await trackCostDailyRollingWindow(client, key, current, now, window24h);

              logger.info(
                `[RateLimit] Cache warmed for ${key}, value=${current} (daily rolling window)`
              );
            }
          } else {
            // daily fixed/weekly/monthly: uses STRING + dynamic TTL
            const { normalized, suffix } = this.resolveDailyReset(limit.resetTime);
            const ttl = getTTLForPeriodWithMode(limit.period, normalized, limit.resetMode);
            const periodKey = limit.period === "daily" ? `${limit.period}_${suffix}` : limit.period;
            await client.setex(`${type}:${id}:cost_${periodKey}`, ttl, current.toString());
            logger.info(
              `[RateLimit] Cache warmed for ${type}:${id}:cost_${periodKey}, value=${current}, ttl=${ttl}s`
            );
          }
        } catch (error) {
          logger.error("[RateLimit] Failed to warm cache:", error);
        }
      }

      if (current >= limit.amount) {
        return {
          allowed: false,
          reason: `${type === "key" ? "Key" : "供应商"} ${limit.name}消费上限已达到（${current.toFixed(4)}/${limit.amount}）`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * 检查并发 Session 限制（仅检查，不追踪）
   *
   * 注意：此方法仅用于非供应商级别的限流检查（如 key 级）
   * 供应商级别请使用 checkAndTrackProviderSession 保证原子性
   */
  static async checkSessionLimit(
    id: number,
    type: "key" | "provider",
    limit: number
  ): Promise<{ allowed: boolean; reason?: string }> {
    if (limit <= 0) {
      return { allowed: true };
    }

    try {
      // 使用 SessionTracker 的统一计数逻辑
      const count =
        type === "key"
          ? await SessionTracker.getKeySessionCount(id)
          : await SessionTracker.getProviderSessionCount(id);

      if (count >= limit) {
        return {
          allowed: false,
          reason: `${type === "key" ? "Key" : "供应商"}并发 Session 上限已达到（${count}/${limit}）`,
        };
      }

      return { allowed: true };
    } catch (error) {
      logger.error("[RateLimit] Session check failed:", error);
      return { allowed: true }; // Fail Open
    }
  }

  /**
   * Atomic check and track provider session (solve race condition)
   *
   * Uses atomic script to guarantee "check + track" atomicity, preventing concurrent requests from passing limit check
   *
   * @param providerId - Provider ID
   * @param sessionId - Session ID
   * @param limit - Concurrent limit
   * @returns { allowed, count, tracked } - Whether allowed, current count, whether tracked
   */
  static async checkAndTrackProviderSession(
    providerId: number,
    sessionId: string,
    limit: number
  ): Promise<{ allowed: boolean; count: number; tracked: boolean; reason?: string }> {
    if (limit <= 0) {
      return { allowed: true, count: 0, tracked: false };
    }

    const client = this.memoryClient;
    if (!client || client.status !== "ready") {
      logger.warn("[RateLimit] Cache not ready, Fail Open");
      return { allowed: true, count: 0, tracked: false };
    }

    try {
      const key = `provider:${providerId}:active_sessions`;
      const now = Date.now();

      // Execute atomic check + track script
      const result = await checkAndTrackSession(client, key, sessionId, limit, now);

      if (!result.allowed) {
        return {
          allowed: false,
          count: result.currentCount,
          tracked: false,
          reason: `供应商并发 Session 上限已达到（${result.currentCount}/${limit}）`,
        };
      }

      return {
        allowed: true,
        count: result.currentCount,
        tracked: result.tracked,
      };
    } catch (error) {
      logger.error("[RateLimit] Atomic check-and-track failed:", error);
      return { allowed: true, count: 0, tracked: false }; // Fail Open
    }
  }

  /**
   * Track cost (called after request completes)
   * 5h uses rolling window (ZSET), daily uses rolling/fixed based on mode, weekly/monthly use fixed window (STRING)
   */
  static async trackCost(
    keyId: number,
    providerId: number,
    _sessionId: string,
    cost: number,
    options?: {
      keyResetTime?: string;
      keyResetMode?: DailyResetMode;
      providerResetTime?: string;
      providerResetMode?: DailyResetMode;
    }
  ): Promise<void> {
    const client = this.memoryClient;
    if (!client || cost <= 0) return;

    try {
      const keyDailyReset = this.resolveDailyReset(options?.keyResetTime);
      const providerDailyReset = this.resolveDailyReset(options?.providerResetTime);
      const keyDailyMode = options?.keyResetMode ?? "fixed";
      const providerDailyMode = options?.providerResetMode ?? "fixed";
      const now = Date.now();
      const window5h = 5 * 60 * 60 * 1000; // 5 hours in ms
      const window24h = 24 * 60 * 60 * 1000; // 24 hours in ms

      // Calculate dynamic TTL (daily/weekly/monthly)
      const ttlDailyKey = getTTLForPeriodWithMode("daily", keyDailyReset.normalized, keyDailyMode);
      const ttlDailyProvider =
        keyDailyReset.normalized === providerDailyReset.normalized &&
        keyDailyMode === providerDailyMode
          ? ttlDailyKey
          : getTTLForPeriodWithMode("daily", providerDailyReset.normalized, providerDailyMode);
      const ttlWeekly = getTTLForPeriod("weekly");
      const ttlMonthly = getTTLForPeriod("monthly");

      // 1. 5h rolling window: uses script (ZSET)
      // Key's 5h rolling window
      await trackCost5hRollingWindow(client, `key:${keyId}:cost_5h_rolling`, cost, now, window5h);

      // Provider's 5h rolling window
      await trackCost5hRollingWindow(
        client,
        `provider:${providerId}:cost_5h_rolling`,
        cost,
        now,
        window5h
      );

      // 2. daily rolling window: uses script (ZSET)
      if (keyDailyMode === "rolling") {
        await trackCostDailyRollingWindow(
          client,
          `key:${keyId}:cost_daily_rolling`,
          cost,
          now,
          window24h
        );
      }

      if (providerDailyMode === "rolling") {
        await trackCostDailyRollingWindow(
          client,
          `provider:${providerId}:cost_daily_rolling`,
          cost,
          now,
          window24h
        );
      }

      // 3. daily fixed/weekly/monthly: uses STRING + dynamic TTL
      const pipeline = client.pipeline();

      // Key's daily fixed/weekly/monthly cost
      if (keyDailyMode === "fixed") {
        const keyDailyKey = `key:${keyId}:cost_daily_${keyDailyReset.suffix}`;
        pipeline.incrbyfloat(keyDailyKey, cost);
        pipeline.expire(keyDailyKey, ttlDailyKey);
      }

      pipeline.incrbyfloat(`key:${keyId}:cost_weekly`, cost);
      pipeline.expire(`key:${keyId}:cost_weekly`, ttlWeekly);

      pipeline.incrbyfloat(`key:${keyId}:cost_monthly`, cost);
      pipeline.expire(`key:${keyId}:cost_monthly`, ttlMonthly);

      // Provider's daily fixed/weekly/monthly cost
      if (providerDailyMode === "fixed") {
        const providerDailyKey = `provider:${providerId}:cost_daily_${providerDailyReset.suffix}`;
        pipeline.incrbyfloat(providerDailyKey, cost);
        pipeline.expire(providerDailyKey, ttlDailyProvider);
      }

      pipeline.incrbyfloat(`provider:${providerId}:cost_weekly`, cost);
      pipeline.expire(`provider:${providerId}:cost_weekly`, ttlWeekly);

      pipeline.incrbyfloat(`provider:${providerId}:cost_monthly`, cost);
      pipeline.expire(`provider:${providerId}:cost_monthly`, ttlMonthly);

      await pipeline.exec();

      logger.debug(`[RateLimit] Tracked cost: key=${keyId}, provider=${providerId}, cost=${cost}`);
    } catch (error) {
      logger.error("[RateLimit] Track cost failed:", error);
      // Don't throw error, fail silently
    }
  }

  /**
   * Get current cost (for response headers and frontend display)
   * Uses cache first, fallback to database query
   */
  static async getCurrentCost(
    id: number,
    type: "key" | "provider",
    period: "5h" | "daily" | "weekly" | "monthly",
    resetTime = "00:00",
    resetMode: DailyResetMode = "fixed"
  ): Promise<number> {
    try {
      const dailyResetInfo = this.resolveDailyReset(resetTime);
      const client = this.memoryClient;

      // Fast Path: Cache query
      if (client && client.status === "ready") {
        let current = 0;

        // 5h uses rolling window script
        if (period === "5h") {
          const now = Date.now();
          const window5h = 5 * 60 * 60 * 1000;
          const key = `${type}:${id}:cost_5h_rolling`;

          const result = await getCost5hRollingWindow(client, key, now, window5h);

          current = parseFloat(result || "0");

          // Cache Hit
          if (current > 0) {
            return current;
          }

          // Cache Miss detection: if returns 0 but key doesn't exist, recover from database
          const exists = await client.exists(key);
          if (!exists) {
            logger.info(`[RateLimit] Cache miss for ${type}:${id}:cost_5h, querying database`);
          } else {
            // Key exists but value is 0, it's really 0
            return 0;
          }
        } else if (period === "daily" && resetMode === "rolling") {
          // daily rolling window: uses ZSET script
          const now = Date.now();
          const window24h = 24 * 60 * 60 * 1000;
          const key = `${type}:${id}:cost_daily_rolling`;

          const result = await getCostDailyRollingWindow(client, key, now, window24h);

          current = parseFloat(result || "0");

          // Cache Hit
          if (current > 0) {
            return current;
          }

          // Cache Miss detection
          const exists = await client.exists(key);
          if (!exists) {
            logger.info(
              `[RateLimit] Cache miss for ${type}:${id}:cost_daily_rolling, querying database`
            );
          } else {
            return 0;
          }
        } else {
          // daily fixed/weekly/monthly use simple GET
          const cacheKey = period === "daily" ? `${period}_${dailyResetInfo.suffix}` : period;
          const value = await client.get(`${type}:${id}:cost_${cacheKey}`);

          // Cache Hit
          if (value !== null) {
            return parseFloat(value || "0");
          }

          // Cache Miss: recover from database
          logger.info(
            `[RateLimit] Cache miss for ${type}:${id}:cost_${cacheKey}, querying database`
          );
        }
      } else {
        logger.warn(`[RateLimit] Cache unavailable, querying database for ${type} cost`);
      }

      // Slow Path: Database query
      const { sumKeyCostInTimeRange, sumProviderCostInTimeRange } = await import(
        "@/repository/statistics"
      );

      const { startTime, endTime } = getTimeRangeForPeriodWithMode(
        period,
        dailyResetInfo.normalized,
        resetMode
      );
      const current =
        type === "key"
          ? await sumKeyCostInTimeRange(id, startTime, endTime)
          : await sumProviderCostInTimeRange(id, startTime, endTime);

      // Cache Warming: write back to cache
      if (client && client.status === "ready") {
        try {
          if (period === "5h") {
            // 5h rolling window: need to convert historical data to ZSET format
            // Since we can't know exact timestamp of each cost, use current time as approximation
            if (current > 0) {
              const now = Date.now();
              const window5h = 5 * 60 * 60 * 1000;
              const key = `${type}:${id}:cost_5h_rolling`;

              // Write database total as a single record
              await trackCost5hRollingWindow(client, key, current, now, window5h);

              logger.info(`[RateLimit] Cache warmed for ${key}, value=${current} (rolling window)`);
            }
          } else if (period === "daily" && resetMode === "rolling") {
            // daily rolling window: uses ZSET script
            if (current > 0) {
              const now = Date.now();
              const window24h = 24 * 60 * 60 * 1000;
              const key = `${type}:${id}:cost_daily_rolling`;

              await trackCostDailyRollingWindow(client, key, current, now, window24h);

              logger.info(
                `[RateLimit] Cache warmed for ${key}, value=${current} (daily rolling window)`
              );
            }
          } else {
            // daily fixed/weekly/monthly: uses STRING + dynamic TTL
            const cacheKey = period === "daily" ? `${period}_${dailyResetInfo.suffix}` : period;
            const ttl = getTTLForPeriodWithMode(period, dailyResetInfo.normalized, resetMode);
            await client.setex(`${type}:${id}:cost_${cacheKey}`, ttl, current.toString());
            logger.info(
              `[RateLimit] Cache warmed for ${type}:${id}:cost_${cacheKey}, value=${current}, ttl=${ttl}s`
            );
          }
        } catch (error) {
          logger.error("[RateLimit] Failed to warm cache:", error);
        }
      }

      return current;
    } catch (error) {
      logger.error("[RateLimit] Get cost failed:", error);
      return 0;
    }
  }

  /**
   * Check user RPM (requests per minute) limit
   * Uses ZSET sliding window
   */
  static async checkUserRPM(
    userId: number,
    rpmLimit: number
  ): Promise<{ allowed: boolean; reason?: string; current?: number }> {
    if (!rpmLimit || rpmLimit <= 0) {
      return { allowed: true }; // No limit set
    }

    const client = this.memoryClient;
    if (!client) {
      logger.warn("[RateLimit] Cache unavailable, skipping user RPM check");
      return { allowed: true }; // Fail Open
    }

    const key = `user:${userId}:rpm_window`;
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    try {
      // Use Pipeline for performance
      const pipeline = client.pipeline();

      // 1. Clean up requests older than 1 minute
      pipeline.zremrangebyscore(key, -Infinity, oneMinuteAgo);

      // 2. Count current requests
      pipeline.zcard(key);

      const results = await pipeline.exec();
      const count = (results?.[1]?.[1] as number) || 0;

      if (count >= rpmLimit) {
        return {
          allowed: false,
          reason: `用户每分钟请求数上限已达到（${count}/${rpmLimit}）`,
          current: count,
        };
      }

      // 3. Record this request
      await client
        .pipeline()
        .zadd(key, now, `${now}:${Math.random()}`)
        .expire(key, 120) // 2 minute TTL
        .exec();

      return { allowed: true, current: count + 1 };
    } catch (error) {
      logger.error(`[RateLimit] User RPM check failed for user ${userId}:`, error);
      return { allowed: true }; // Fail Open
    }
  }

  /**
   * Check user daily cost limit
   * Uses cache first, fallback to database query
   */
  static async checkUserDailyCost(
    userId: number,
    dailyLimitUsd: number
  ): Promise<{ allowed: boolean; reason?: string; current?: number }> {
    if (!dailyLimitUsd || dailyLimitUsd <= 0) {
      return { allowed: true }; // No limit set
    }

    const key = `user:${userId}:daily_cost`;
    let currentCost = 0;
    const client = this.memoryClient;

    try {
      // Fast Path: Cache query
      if (client) {
        const cached = await client.get(key);
        if (cached !== null) {
          currentCost = parseFloat(cached);
        } else {
          // Cache Miss: recover from database
          logger.info(`[RateLimit] Cache miss for ${key}, querying database`);
          currentCost = await sumUserCostToday(userId);

          // Cache Warming: write back to cache
          const secondsUntilMidnight = getSecondsUntilMidnight();
          await client.setex(key, secondsUntilMidnight, currentCost.toString());
        }
      } else {
        // Slow Path: Database query (cache unavailable)
        logger.warn("[RateLimit] Cache unavailable, querying database for user daily cost");
        currentCost = await sumUserCostToday(userId);
      }

      if (currentCost >= dailyLimitUsd) {
        return {
          allowed: false,
          reason: `用户每日消费上限已达到（$${currentCost.toFixed(4)}/$${dailyLimitUsd}）`,
          current: currentCost,
        };
      }

      return { allowed: true, current: currentCost };
    } catch (error) {
      logger.error(`[RateLimit] User daily cost check failed for user ${userId}:`, error);
      return { allowed: true }; // Fail Open
    }
  }

  /**
   * Track user daily cost (called after trackCost)
   */
  static async trackUserDailyCost(userId: number, cost: number): Promise<void> {
    const client = this.memoryClient;
    if (!client || cost <= 0) return;

    const key = `user:${userId}:daily_cost`;

    try {
      const secondsUntilMidnight = getSecondsUntilMidnight();

      await client.pipeline().incrbyfloat(key, cost).expire(key, secondsUntilMidnight).exec();

      logger.debug(`[RateLimit] Tracked user daily cost: user=${userId}, cost=${cost}`);
    } catch (error) {
      logger.error(`[RateLimit] Failed to track user daily cost:`, error);
    }
  }
}
