/**
 * Rolling Window Scripts - JavaScript equivalent of Redis Lua scripts
 *
 * Ports TRACK_COST_5H_ROLLING_WINDOW, GET_COST_5H_ROLLING_WINDOW,
 * TRACK_COST_DAILY_ROLLING_WINDOW, and GET_COST_DAILY_ROLLING_WINDOW
 * Lua scripts to in-memory JavaScript implementations.
 */
import { Mutex } from "async-mutex";
import type { InMemoryStore } from "../index";

const mutex = new Mutex();

/**
 * Parse cost from member format "timestamp:cost"
 *
 * @param member - Member string in format "timestamp:cost"
 * @returns Parsed cost value or 0
 */
function parseCostFromMember(member: string): number {
  const colonIndex = member.indexOf(":");
  if (colonIndex === -1) return 0;
  const costStr = member.substring(colonIndex + 1);
  const cost = parseFloat(costStr);
  return isNaN(cost) ? 0 : cost;
}

/**
 * Calculate total cost from ZSET members
 *
 * @param store - InMemoryStore instance
 * @param key - ZSET key
 * @returns Total cost
 */
async function calculateTotalCost(store: InMemoryStore, key: string): Promise<number> {
  const records = (await store.zrange(key, 0, -1)) as string[];
  let total = 0;
  for (const record of records) {
    total += parseCostFromMember(record);
  }
  return total;
}

/**
 * TRACK_COST_5H_ROLLING_WINDOW equivalent
 *
 * Track 5-hour rolling window consumption using ZSET.
 *
 * Operations:
 * 1. Clean up records older than window
 * 2. Add current consumption (member = timestamp:cost)
 * 3. Calculate total consumption in window
 *
 * @param store - InMemoryStore instance
 * @param key - ZSET key (e.g., key:${id}:cost_5h_rolling)
 * @param cost - Current consumption amount
 * @param nowMs - Current timestamp in milliseconds
 * @param windowMs - Window duration in milliseconds (default: 5 hours = 18000000)
 * @returns Total consumption in window as string
 */
export async function trackCost5hRollingWindow(
  store: InMemoryStore,
  key: string,
  cost: number,
  nowMs: number,
  windowMs: number = 18000000
): Promise<string> {
  return mutex.runExclusive(async () => {
    // 1. Clean up expired records
    await store.zremrangebyscore(key, -Infinity, nowMs - windowMs);

    // 2. Add current consumption (member = timestamp:cost)
    const member = `${nowMs}:${cost}`;
    await store.zadd(key, nowMs, member);

    // 3. Calculate total consumption in window
    const total = await calculateTotalCost(store, key);

    // Note: expire() for TTL is handled by memory store's cleanup mechanism
    return String(total);
  });
}

/**
 * GET_COST_5H_ROLLING_WINDOW equivalent
 *
 * Query current consumption in 5-hour rolling window.
 *
 * Operations:
 * 1. Clean up records older than window
 * 2. Calculate total consumption in window
 *
 * @param store - InMemoryStore instance
 * @param key - ZSET key
 * @param nowMs - Current timestamp in milliseconds
 * @param windowMs - Window duration in milliseconds (default: 5 hours)
 * @returns Total consumption in window as string
 */
export async function getCost5hRollingWindow(
  store: InMemoryStore,
  key: string,
  nowMs: number,
  windowMs: number = 18000000
): Promise<string> {
  return mutex.runExclusive(async () => {
    // 1. Clean up expired records
    await store.zremrangebyscore(key, -Infinity, nowMs - windowMs);

    // 2. Calculate total consumption in window
    const total = await calculateTotalCost(store, key);

    return String(total);
  });
}

/**
 * TRACK_COST_DAILY_ROLLING_WINDOW equivalent
 *
 * Track 24-hour rolling window consumption using ZSET.
 *
 * Operations:
 * 1. Clean up records older than 24 hours
 * 2. Add current consumption (member = timestamp:cost)
 * 3. Calculate total consumption in window
 *
 * @param store - InMemoryStore instance
 * @param key - ZSET key (e.g., key:${id}:cost_daily_rolling)
 * @param cost - Current consumption amount
 * @param nowMs - Current timestamp in milliseconds
 * @param windowMs - Window duration in milliseconds (default: 24 hours = 86400000)
 * @returns Total consumption in window as string
 */
export async function trackCostDailyRollingWindow(
  store: InMemoryStore,
  key: string,
  cost: number,
  nowMs: number,
  windowMs: number = 86400000
): Promise<string> {
  return mutex.runExclusive(async () => {
    // 1. Clean up expired records (24 hours old)
    await store.zremrangebyscore(key, -Infinity, nowMs - windowMs);

    // 2. Add current consumption (member = timestamp:cost)
    const member = `${nowMs}:${cost}`;
    await store.zadd(key, nowMs, member);

    // 3. Calculate total consumption in window
    const total = await calculateTotalCost(store, key);

    // Note: expire() for TTL is handled by memory store's cleanup mechanism
    return String(total);
  });
}

/**
 * GET_COST_DAILY_ROLLING_WINDOW equivalent
 *
 * Query current consumption in 24-hour rolling window.
 *
 * Operations:
 * 1. Clean up records older than 24 hours
 * 2. Calculate total consumption in window
 *
 * @param store - InMemoryStore instance
 * @param key - ZSET key
 * @param nowMs - Current timestamp in milliseconds
 * @param windowMs - Window duration in milliseconds (default: 24 hours)
 * @returns Total consumption in window as string
 */
export async function getCostDailyRollingWindow(
  store: InMemoryStore,
  key: string,
  nowMs: number,
  windowMs: number = 86400000
): Promise<string> {
  return mutex.runExclusive(async () => {
    // 1. Clean up expired records
    await store.zremrangebyscore(key, -Infinity, nowMs - windowMs);

    // 2. Calculate total consumption in window
    const total = await calculateTotalCost(store, key);

    return String(total);
  });
}
