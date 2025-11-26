/**
 * In-Memory Sorted Set (ZSET) Implementation
 *
 * Provides Redis ZSET-compatible interface for the Electron desktop app.
 * Uses Map<string, Map<string, number>> for efficient member-score storage.
 *
 * Thread-safety: Uses async-mutex for atomic operations.
 */
import { Mutex } from "async-mutex";

export class InMemoryZSet {
  private data: Map<string, Map<string, number>> = new Map();
  private mutex = new Mutex();

  /**
   * Add a member with score to sorted set
   *
   * @param key - ZSET key
   * @param score - Score value (typically timestamp)
   * @param member - Member to add
   * @returns 1 if new member added, 0 if updated
   */
  async zadd(key: string, score: number, member: string): Promise<number> {
    return this.mutex.runExclusive(() => {
      let zset = this.data.get(key);
      if (!zset) {
        zset = new Map();
        this.data.set(key, zset);
      }
      const isNew = !zset.has(member);
      zset.set(member, score);
      return isNew ? 1 : 0;
    });
  }

  /**
   * Get range of members by index (sorted by score ascending)
   *
   * @param key - ZSET key
   * @param start - Start index (0-based, supports negative)
   * @param stop - Stop index (inclusive, supports negative)
   * @param options - Optional: withScores to return scores
   * @returns Array of members or [member, score] pairs
   */
  async zrange(
    key: string,
    start: number,
    stop: number,
    options?: { withScores?: boolean }
  ): Promise<string[] | (string | number)[]> {
    return this.mutex.runExclusive(() => {
      const zset = this.data.get(key);
      if (!zset || zset.size === 0) return [];

      const entries = Array.from(zset.entries())
        .map(([member, score]) => ({ member, score }))
        .sort((a, b) => a.score - b.score);

      const len = entries.length;
      // Handle negative indices
      const startIdx = start < 0 ? Math.max(0, len + start) : start;
      const stopIdx = stop < 0 ? len + stop : stop;
      const endIdx = Math.min(stopIdx + 1, len);

      const slice = entries.slice(startIdx, endIdx);

      if (options?.withScores) {
        // Return flat array: [member1, score1, member2, score2, ...]
        return slice.flatMap((e) => [e.member, e.score]);
      }
      return slice.map((e) => e.member);
    });
  }

  /**
   * Get members with scores in score range
   *
   * @param key - ZSET key
   * @param min - Minimum score (use -Infinity for "-inf")
   * @param max - Maximum score (use Infinity for "+inf")
   * @returns Array of members
   */
  async zrangebyscore(key: string, min: number, max: number): Promise<string[]> {
    return this.mutex.runExclusive(() => {
      const zset = this.data.get(key);
      if (!zset || zset.size === 0) return [];

      return Array.from(zset.entries())
        .filter(([, score]) => score >= min && score <= max)
        .sort((a, b) => a[1] - b[1])
        .map(([member]) => member);
    });
  }

  /**
   * Remove members with scores in range
   *
   * @param key - ZSET key
   * @param min - Minimum score (use -Infinity for "-inf")
   * @param max - Maximum score
   * @returns Number of members removed
   */
  async zremrangebyscore(key: string, min: number, max: number): Promise<number> {
    return this.mutex.runExclusive(() => {
      const zset = this.data.get(key);
      if (!zset || zset.size === 0) return 0;

      let removed = 0;
      for (const [member, score] of zset.entries()) {
        if (score >= min && score <= max) {
          zset.delete(member);
          removed++;
        }
      }

      // Clean up empty zsets
      if (zset.size === 0) {
        this.data.delete(key);
      }

      return removed;
    });
  }

  /**
   * Get cardinality (number of members)
   *
   * @param key - ZSET key
   * @returns Number of members
   */
  async zcard(key: string): Promise<number> {
    const zset = this.data.get(key);
    return zset?.size ?? 0;
  }

  /**
   * Get score of a member
   *
   * @param key - ZSET key
   * @param member - Member to get score for
   * @returns Score or null if not exists
   */
  async zscore(key: string, member: string): Promise<number | null> {
    const zset = this.data.get(key);
    const score = zset?.get(member);
    return score !== undefined ? score : null;
  }

  /**
   * Remove one or more members
   *
   * @param key - ZSET key
   * @param members - Members to remove
   * @returns Number of members removed
   */
  async zrem(key: string, ...members: string[]): Promise<number> {
    return this.mutex.runExclusive(() => {
      const zset = this.data.get(key);
      if (!zset) return 0;

      let removed = 0;
      for (const member of members) {
        if (zset.delete(member)) removed++;
      }

      // Clean up empty zsets
      if (zset.size === 0) {
        this.data.delete(key);
      }

      return removed;
    });
  }

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    this.data.clear();
  }
}
