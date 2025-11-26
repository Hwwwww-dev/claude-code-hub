/**
 * In-Memory Map Implementation
 *
 * Provides Redis STRING/HASH-compatible interface for the Electron desktop app.
 * Supports TTL-based expiration with automatic cleanup.
 *
 * Thread-safety: Uses async-mutex for atomic numeric operations.
 */
import { Mutex } from "async-mutex";

interface CacheEntry {
  value: string;
  expiry?: number; // Unix timestamp in milliseconds
}

export class InMemoryMap {
  private data: Map<string, CacheEntry> = new Map();
  private mutex = new Mutex();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Cleanup expired entries every 60 seconds
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Remove expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.data.entries()) {
      if (entry.expiry && entry.expiry <= now) {
        this.data.delete(key);
      }
    }
  }

  /**
   * Check if entry is expired
   */
  private isExpired(entry: CacheEntry): boolean {
    return entry.expiry !== undefined && entry.expiry <= Date.now();
  }

  /**
   * Get value by key
   *
   * @param key - Cache key
   * @returns Value or null if not exists or expired
   */
  async get(key: string): Promise<string | null> {
    const entry = this.data.get(key);
    if (!entry) return null;
    if (this.isExpired(entry)) {
      this.data.delete(key);
      return null;
    }
    return entry.value;
  }

  /**
   * Set value without expiry
   *
   * @param key - Cache key
   * @param value - Value to set
   * @returns "OK"
   */
  async set(key: string, value: string): Promise<"OK"> {
    this.data.set(key, { value });
    return "OK";
  }

  /**
   * Set value with expiry (seconds)
   *
   * @param key - Cache key
   * @param seconds - TTL in seconds
   * @param value - Value to set
   * @returns "OK"
   */
  async setex(key: string, seconds: number, value: string): Promise<"OK"> {
    this.data.set(key, {
      value,
      expiry: Date.now() + seconds * 1000,
    });
    return "OK";
  }

  /**
   * Set value with optional expiry and NX flag (SET ... EX ... NX)
   *
   * @param key - Cache key
   * @param value - Value to set
   * @param exFlag - "EX" keyword
   * @param seconds - TTL in seconds
   * @param nxFlag - "NX" keyword (only set if not exists)
   * @returns "OK" if set, null if key exists (when NX)
   */
  async setWithOptions(
    key: string,
    value: string,
    exFlag?: "EX",
    seconds?: number,
    nxFlag?: "NX"
  ): Promise<"OK" | null> {
    return this.mutex.runExclusive(() => {
      // Check NX condition
      if (nxFlag === "NX") {
        const existing = this.data.get(key);
        if (existing && !this.isExpired(existing)) {
          return null; // Key exists, don't set
        }
      }

      const entry: CacheEntry = { value };
      if (exFlag === "EX" && seconds !== undefined) {
        entry.expiry = Date.now() + seconds * 1000;
      }

      this.data.set(key, entry);
      return "OK";
    });
  }

  /**
   * Delete one or more keys
   *
   * @param keys - Keys to delete
   * @returns Number of keys deleted
   */
  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (this.data.delete(key)) deleted++;
    }
    return deleted;
  }

  /**
   * Check if keys exist
   *
   * @param keys - Keys to check
   * @returns Number of keys that exist
   */
  async exists(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      const entry = this.data.get(key);
      if (entry && !this.isExpired(entry)) count++;
    }
    return count;
  }

  /**
   * Increment integer value by 1
   *
   * @param key - Cache key
   * @returns New value after increment
   */
  async incr(key: string): Promise<number> {
    return this.mutex.runExclusive(() => {
      const entry = this.data.get(key);
      let current = 0;
      let expiry: number | undefined;

      if (entry && !this.isExpired(entry)) {
        current = parseInt(entry.value, 10);
        if (isNaN(current)) current = 0;
        expiry = entry.expiry;
      }

      const newValue = current + 1;
      this.data.set(key, { value: String(newValue), expiry });
      return newValue;
    });
  }

  /**
   * Decrement integer value by 1
   *
   * @param key - Cache key
   * @returns New value after decrement
   */
  async decr(key: string): Promise<number> {
    return this.mutex.runExclusive(() => {
      const entry = this.data.get(key);
      let current = 0;
      let expiry: number | undefined;

      if (entry && !this.isExpired(entry)) {
        current = parseInt(entry.value, 10);
        if (isNaN(current)) current = 0;
        expiry = entry.expiry;
      }

      const newValue = current - 1;
      this.data.set(key, { value: String(newValue), expiry });
      return newValue;
    });
  }

  /**
   * Increment float value
   *
   * @param key - Cache key
   * @param increment - Value to add
   * @returns New value as string
   */
  async incrbyfloat(key: string, increment: number): Promise<string> {
    return this.mutex.runExclusive(() => {
      const entry = this.data.get(key);
      let current = 0;
      let expiry: number | undefined;

      if (entry && !this.isExpired(entry)) {
        current = parseFloat(entry.value);
        if (isNaN(current)) current = 0;
        expiry = entry.expiry;
      }

      const newValue = current + increment;
      this.data.set(key, { value: String(newValue), expiry });
      return String(newValue);
    });
  }

  /**
   * Set hash field(s)
   *
   * Supports two signatures:
   * - hset(key, field, value) - single field
   * - hset(key, fieldValueMap) - multiple fields
   *
   * @param key - Hash key
   * @param fieldOrMap - Field name or object with field-value pairs
   * @param value - Field value (when using single field signature)
   * @returns Number of new fields added
   */
  async hset(
    key: string,
    fieldOrMap: string | Record<string, string>,
    value?: string
  ): Promise<number> {
    return this.mutex.runExclusive(() => {
      let newCount = 0;

      if (typeof fieldOrMap === "string" && value !== undefined) {
        // Single field signature: hset(key, field, value)
        const hashKey = `${key}:${fieldOrMap}`;
        if (!this.data.has(hashKey)) newCount = 1;
        this.data.set(hashKey, { value });
      } else if (typeof fieldOrMap === "object") {
        // Object signature: hset(key, { field1: value1, field2: value2 })
        for (const [field, val] of Object.entries(fieldOrMap)) {
          const hashKey = `${key}:${field}`;
          if (!this.data.has(hashKey)) newCount++;
          this.data.set(hashKey, { value: val });
        }
      }

      return newCount;
    });
  }

  /**
   * Get hash field value
   *
   * @param key - Hash key
   * @param field - Field name
   * @returns Field value or null
   */
  async hget(key: string, field: string): Promise<string | null> {
    const entry = this.data.get(`${key}:${field}`);
    if (!entry) return null;
    if (this.isExpired(entry)) {
      this.data.delete(`${key}:${field}`);
      return null;
    }
    return entry.value;
  }

  /**
   * Get all hash fields and values
   *
   * @param key - Hash key
   * @returns Object with all field-value pairs
   */
  async hgetall(key: string): Promise<Record<string, string>> {
    const result: Record<string, string> = {};
    const prefix = `${key}:`;

    for (const [hashKey, entry] of this.data.entries()) {
      if (hashKey.startsWith(prefix)) {
        if (this.isExpired(entry)) {
          this.data.delete(hashKey);
          continue;
        }
        const field = hashKey.substring(prefix.length);
        result[field] = entry.value;
      }
    }

    return result;
  }

  /**
   * Scan keys matching pattern (simplified implementation)
   *
   * @param cursor - Cursor position (ignored, always scans all)
   * @param _match - "MATCH" keyword (ignored)
   * @param pattern - Pattern to match (supports * wildcard)
   * @param _count - "COUNT" keyword (ignored)
   * @param _countVal - Count value (ignored)
   * @returns [nextCursor, matchingKeys] - cursor is always "0" (done)
   */
  async scan(
    cursor: string,
    _match: "MATCH",
    pattern: string,
    _count?: "COUNT",
    _countVal?: number
  ): Promise<[string, string[]]> {
    // Convert Redis glob pattern to regex
    // Simple implementation: only supports * wildcard
    const regexPattern = pattern.replace(/\*/g, ".*").replace(/\?/g, ".");
    const regex = new RegExp(`^${regexPattern}$`);

    const matchingKeys: string[] = [];
    const seenBaseKeys = new Set<string>();

    for (const [key, entry] of this.data.entries()) {
      if (this.isExpired(entry)) {
        this.data.delete(key);
        continue;
      }

      // For hash keys (key:field format), we need to extract base key
      // Check if this could be a hash entry by looking for the pattern
      if (pattern.includes(":info") || pattern.includes(":*:")) {
        // This is a hash pattern, match the base key
        const baseKey = key.split(":").slice(0, -1).join(":");
        if (baseKey && regex.test(baseKey) && !seenBaseKeys.has(baseKey)) {
          seenBaseKeys.add(baseKey);
          matchingKeys.push(baseKey);
        }
      } else if (regex.test(key)) {
        matchingKeys.push(key);
      }
    }

    // Always return "0" as cursor (indicating scan complete)
    // This is a simplified implementation that scans all keys at once
    return ["0", matchingKeys];
  }

  /**
   * Set expiry on key (seconds)
   *
   * @param key - Cache key
   * @param seconds - TTL in seconds
   * @returns 1 if key exists and timeout set, 0 otherwise
   */
  async expire(key: string, seconds: number): Promise<number> {
    const entry = this.data.get(key);
    if (!entry) return 0;
    if (this.isExpired(entry)) {
      this.data.delete(key);
      return 0;
    }
    entry.expiry = Date.now() + seconds * 1000;
    return 1;
  }

  /**
   * Get key type (for compatibility)
   *
   * @param key - Cache key
   * @returns "string" or "none"
   */
  async type(key: string): Promise<string> {
    const entry = this.data.get(key);
    if (!entry) return "none";
    if (this.isExpired(entry)) {
      this.data.delete(key);
      return "none";
    }
    return "string";
  }

  /**
   * Clear all data and stop cleanup interval
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.data.clear();
  }

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    this.data.clear();
  }
}
