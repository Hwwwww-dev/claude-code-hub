/**
 * In-Memory Pipeline Implementation
 *
 * Provides Redis pipeline-compatible interface for batched operations.
 * Commands are queued and executed sequentially on exec().
 *
 * Note: Unlike Redis, this implementation executes commands sequentially
 * rather than atomically, but provides the same interface for compatibility.
 */

import type { InMemoryStore } from "./index";

type CommandArgs = (string | number | boolean | undefined | { withScores?: boolean } | Record<string, string>)[];

interface Command {
  method: string;
  args: CommandArgs;
}

export class InMemoryPipeline {
  private commands: Command[] = [];
  private store: InMemoryStore;

  constructor(store: InMemoryStore) {
    this.store = store;
  }

  // ZSET operations
  zadd(key: string, score: number, member: string): this {
    this.commands.push({ method: "zadd", args: [key, score, member] });
    return this;
  }

  zrange(key: string, start: number, stop: number, options?: { withScores?: boolean }): this {
    this.commands.push({ method: "zrange", args: [key, start, stop, options] });
    return this;
  }

  zrangebyscore(key: string, min: number, max: number): this {
    this.commands.push({ method: "zrangebyscore", args: [key, min, max] });
    return this;
  }

  zremrangebyscore(key: string, min: number, max: number): this {
    this.commands.push({ method: "zremrangebyscore", args: [key, min, max] });
    return this;
  }

  zcard(key: string): this {
    this.commands.push({ method: "zcard", args: [key] });
    return this;
  }

  zscore(key: string, member: string): this {
    this.commands.push({ method: "zscore", args: [key, member] });
    return this;
  }

  zrem(key: string, ...members: string[]): this {
    this.commands.push({ method: "zrem", args: [key, ...members] });
    return this;
  }

  // Map operations
  get(key: string): this {
    this.commands.push({ method: "get", args: [key] });
    return this;
  }

  set(key: string, value: string): this {
    this.commands.push({ method: "set", args: [key, value] });
    return this;
  }

  setex(key: string, seconds: number, value: string): this {
    this.commands.push({ method: "setex", args: [key, seconds, value] });
    return this;
  }

  del(...keys: string[]): this {
    this.commands.push({ method: "del", args: keys });
    return this;
  }

  exists(...keys: string[]): this {
    this.commands.push({ method: "exists", args: keys });
    return this;
  }

  incr(key: string): this {
    this.commands.push({ method: "incr", args: [key] });
    return this;
  }

  decr(key: string): this {
    this.commands.push({ method: "decr", args: [key] });
    return this;
  }

  incrbyfloat(key: string, increment: number): this {
    this.commands.push({ method: "incrbyfloat", args: [key, increment] });
    return this;
  }

  hset(key: string, fieldOrMap: string | Record<string, string>, value?: string): this {
    this.commands.push({ method: "hset", args: [key, fieldOrMap, value] });
    return this;
  }

  hget(key: string, field: string): this {
    this.commands.push({ method: "hget", args: [key, field] });
    return this;
  }

  hgetall(key: string): this {
    this.commands.push({ method: "hgetall", args: [key] });
    return this;
  }

  expire(key: string, seconds: number): this {
    this.commands.push({ method: "expire", args: [key, seconds] });
    return this;
  }

  type(key: string): this {
    this.commands.push({ method: "type", args: [key] });
    return this;
  }

  /**
   * Execute all queued commands
   *
   * @returns Array of [error, result] tuples (Redis pipeline format)
   */
  async exec(): Promise<[Error | null, unknown][]> {
    const results: [Error | null, unknown][] = [];

    for (const cmd of this.commands) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fn = (this.store as any)[cmd.method];
        if (typeof fn === "function") {
          const result = await fn.apply(this.store, cmd.args);
          results.push([null, result]);
        } else {
          results.push([new Error(`Unknown command: ${cmd.method}`), null]);
        }
      } catch (error) {
        results.push([error instanceof Error ? error : new Error(String(error)), null]);
      }
    }

    // Clear commands after execution
    this.commands = [];
    return results;
  }
}
