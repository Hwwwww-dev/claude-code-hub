/**
 * Session Tracker Script - JavaScript equivalent of Redis Lua scripts
 *
 * Ports CHECK_AND_TRACK_SESSION and BATCH_CHECK_SESSION_LIMITS Lua scripts
 * to in-memory JavaScript implementations with atomic guarantees.
 */
import { Mutex } from "async-mutex";
import type { InMemoryStore } from "../index";

const mutex = new Mutex();

/**
 * Session tracking result
 */
export interface SessionTrackResult {
  allowed: boolean;
  currentCount: number;
  tracked: boolean;
}

/**
 * CHECK_AND_TRACK_SESSION equivalent
 *
 * Atomic operation that:
 * 1. Cleans up expired sessions (5 minutes old)
 * 2. Checks if session is already tracked
 * 3. Checks if concurrent limit is exceeded
 * 4. Tracks new session if not exceeded
 *
 * @param store - InMemoryStore instance
 * @param providerKey - Redis key: provider:${providerId}:active_sessions
 * @param sessionId - Session ID to track
 * @param limit - Concurrent session limit (0 = unlimited)
 * @param now - Current timestamp in milliseconds
 * @returns {allowed, currentCount, tracked}
 */
export async function checkAndTrackSession(
  store: InMemoryStore,
  providerKey: string,
  sessionId: string,
  limit: number,
  now: number
): Promise<SessionTrackResult> {
  return mutex.runExclusive(async () => {
    const ttl = 300000; // 5 minutes in milliseconds
    const fiveMinutesAgo = now - ttl;

    // 1. Clean up expired sessions (5 minutes old)
    await store.zremrangebyscore(providerKey, -Infinity, fiveMinutesAgo);

    // 2. Check if session is already tracked
    const existingScore = await store.zscore(providerKey, sessionId);
    const isTracked = existingScore !== null;

    // 3. Get current concurrent count
    const currentCount = await store.zcard(providerKey);

    // 4. Check limit (exclude already tracked sessions)
    if (limit > 0 && !isTracked && currentCount >= limit) {
      return {
        allowed: false,
        currentCount,
        tracked: false,
      };
    }

    // 5. Track session (ZADD updates timestamp for existing members)
    await store.zadd(providerKey, now, sessionId);
    // Note: expire() is handled differently in memory store - no action needed
    // as cleanup is handled by the periodic cleanup mechanism

    // 6. Return success
    if (isTracked) {
      // Already tracked, count unchanged
      return {
        allowed: true,
        currentCount,
        tracked: false,
      };
    } else {
      // Newly tracked, count +1
      return {
        allowed: true,
        currentCount: currentCount + 1,
        tracked: true,
      };
    }
  });
}

/**
 * Batch session limit check result
 */
export interface BatchCheckResult {
  allowed: boolean;
  currentCount: number;
}

/**
 * BATCH_CHECK_SESSION_LIMITS equivalent
 *
 * Batch check multiple providers' concurrent limits.
 * Does NOT track the session, only checks limits.
 *
 * @param store - InMemoryStore instance
 * @param providerKeys - Array of provider keys
 * @param sessionId - Session ID to check (used for cleanup context)
 * @param limits - Array of limits corresponding to each provider
 * @param now - Current timestamp in milliseconds
 * @returns Array of {allowed, currentCount} for each provider
 */
export async function batchCheckSessionLimits(
  store: InMemoryStore,
  providerKeys: string[],
  _sessionId: string,
  limits: number[],
  now: number
): Promise<BatchCheckResult[]> {
  return mutex.runExclusive(async () => {
    const ttl = 300000; // 5 minutes in milliseconds
    const fiveMinutesAgo = now - ttl;
    const results: BatchCheckResult[] = [];

    for (let i = 0; i < providerKeys.length; i++) {
      const providerKey = providerKeys[i];
      const limit = limits[i];

      // Clean up expired sessions
      await store.zremrangebyscore(providerKey, -Infinity, fiveMinutesAgo);

      // Get current concurrent count
      const currentCount = await store.zcard(providerKey);

      // Check limit
      if (limit > 0 && currentCount >= limit) {
        results.push({ allowed: false, currentCount });
      } else {
        results.push({ allowed: true, currentCount });
      }
    }

    return results;
  });
}
