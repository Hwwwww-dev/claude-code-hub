/**
 * In-Memory Cache Store
 *
 * Provides a Redis-compatible interface using in-memory data structures
 * for the Electron desktop app. Replaces Redis for session tracking,
 * rate limiting, and caching.
 *
 * Features:
 * - ZSET operations for sorted sets (session tracking, rolling windows)
 * - STRING/HASH operations for key-value caching
 * - Pipeline support for batched operations
 * - Thread-safe via async-mutex
 * - TTL-based expiration with automatic cleanup
 *
 * Usage:
 * ```typescript
 * import { getMemoryClient } from '@/lib/memory-cache';
 *
 * const client = getMemoryClient();
 * await client.zadd('key', Date.now(), 'member');
 * await client.setex('cache:key', 300, 'value');
 * ```
 */
import { InMemoryZSet } from "./zset";
import { InMemoryMap } from "./map";
import { InMemoryPipeline } from "./pipeline";

export class InMemoryStore {
  private static instance: InMemoryStore;
  private zsetStore = new InMemoryZSet();
  private mapStore = new InMemoryMap();

  /**
   * Connection status (always "ready" for in-memory store)
   */
  status: "ready" | "connecting" | "end" = "ready";

  private constructor() {
    // Private constructor for singleton
  }

  /**
   * Get singleton instance
   */
  static getInstance(): InMemoryStore {
    if (!InMemoryStore.instance) {
      InMemoryStore.instance = new InMemoryStore();
    }
    return InMemoryStore.instance;
  }

  // ==================== ZSET Operations ====================

  /**
   * Add member to sorted set with score
   */
  zadd(key: string, score: number, member: string): Promise<number> {
    return this.zsetStore.zadd(key, score, member);
  }

  /**
   * Get range of members by index
   */
  zrange(
    key: string,
    start: number,
    stop: number,
    options?: { withScores?: boolean }
  ): Promise<string[] | (string | number)[]> {
    return this.zsetStore.zrange(key, start, stop, options);
  }

  /**
   * Get members by score range
   */
  zrangebyscore(key: string, min: number, max: number): Promise<string[]> {
    return this.zsetStore.zrangebyscore(key, min, max);
  }

  /**
   * Remove members by score range
   */
  zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    return this.zsetStore.zremrangebyscore(key, min, max);
  }

  /**
   * Get cardinality of sorted set
   */
  zcard(key: string): Promise<number> {
    return this.zsetStore.zcard(key);
  }

  /**
   * Get score of member
   */
  zscore(key: string, member: string): Promise<number | null> {
    return this.zsetStore.zscore(key, member);
  }

  /**
   * Remove members from sorted set
   */
  zrem(key: string, ...members: string[]): Promise<number> {
    return this.zsetStore.zrem(key, ...members);
  }

  // ==================== String/Map Operations ====================

  /**
   * Get value by key
   */
  get(key: string): Promise<string | null> {
    return this.mapStore.get(key);
  }

  /**
   * Set value with optional expiry and NX flag
   * Supports: set(key, value) or set(key, value, "EX", seconds, "NX")
   */
  set(
    key: string,
    value: string,
    exFlag?: "EX",
    seconds?: number,
    nxFlag?: "NX"
  ): Promise<"OK" | null> {
    if (exFlag || nxFlag) {
      return this.mapStore.setWithOptions(key, value, exFlag, seconds, nxFlag);
    }
    return this.mapStore.set(key, value);
  }

  /**
   * Set value with expiry (seconds)
   */
  setex(key: string, seconds: number, value: string): Promise<"OK"> {
    return this.mapStore.setex(key, seconds, value);
  }

  /**
   * Delete keys
   */
  del(...keys: string[]): Promise<number> {
    return this.mapStore.del(...keys);
  }

  /**
   * Check if keys exist
   */
  exists(...keys: string[]): Promise<number> {
    return this.mapStore.exists(...keys);
  }

  /**
   * Increment integer value
   */
  incr(key: string): Promise<number> {
    return this.mapStore.incr(key);
  }

  /**
   * Decrement integer value
   */
  decr(key: string): Promise<number> {
    return this.mapStore.decr(key);
  }

  /**
   * Increment float value
   */
  incrbyfloat(key: string, increment: number): Promise<string> {
    return this.mapStore.incrbyfloat(key, increment);
  }

  /**
   * Set hash field(s)
   * Supports both single field and object signatures
   */
  hset(key: string, fieldOrMap: string | Record<string, string>, value?: string): Promise<number> {
    return this.mapStore.hset(key, fieldOrMap, value);
  }

  /**
   * Get all hash fields and values
   */
  hgetall(key: string): Promise<Record<string, string>> {
    return this.mapStore.hgetall(key);
  }

  /**
   * Scan keys matching pattern
   */
  scan(
    cursor: string,
    match: "MATCH",
    pattern: string,
    count?: "COUNT",
    countVal?: number
  ): Promise<[string, string[]]> {
    return this.mapStore.scan(cursor, match, pattern, count, countVal);
  }

  /**
   * Get hash field
   */
  hget(key: string, field: string): Promise<string | null> {
    return this.mapStore.hget(key, field);
  }

  /**
   * Set expiry on key (seconds)
   */
  expire(key: string, seconds: number): Promise<number> {
    return this.mapStore.expire(key, seconds);
  }

  /**
   * Get key type
   */
  type(key: string): Promise<string> {
    // Check ZSET first, then Map
    // For simplicity, we return "zset" for known ZSET patterns
    // This is a simplified implementation
    return this.mapStore.type(key);
  }

  // ==================== Pipeline ====================

  /**
   * Create a new pipeline for batched operations
   */
  pipeline(): InMemoryPipeline {
    return new InMemoryPipeline(this);
  }

  // ==================== Lifecycle ====================

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    this.zsetStore.clear();
    this.mapStore.clear();
  }

  /**
   * Destroy the store and clean up resources
   */
  destroy(): void {
    this.mapStore.destroy();
    this.zsetStore.clear();
    this.status = "end";
  }
}

/**
 * Get the memory cache client singleton
 *
 * @returns InMemoryStore instance
 */
export function getMemoryClient(): InMemoryStore {
  return InMemoryStore.getInstance();
}

// Re-export classes for direct use
export { InMemoryZSet } from "./zset";
export { InMemoryMap } from "./map";
export { InMemoryPipeline } from "./pipeline";

// Re-export script functions
export {
  checkAndTrackSession,
  batchCheckSessionLimits,
  trackCost5hRollingWindow,
  getCost5hRollingWindow,
  trackCostDailyRollingWindow,
  getCostDailyRollingWindow,
  type SessionTrackResult,
  type BatchCheckResult,
} from "./scripts";
