/**
 * Memory Cache Scripts - JavaScript equivalents of Redis Lua scripts
 *
 * These scripts provide atomic operations for session tracking and
 * rolling window rate limiting, replacing Redis Lua scripts for
 * the Electron desktop app.
 */

export {
  checkAndTrackSession,
  batchCheckSessionLimits,
  type SessionTrackResult,
  type BatchCheckResult,
} from "./session-tracker";

export {
  trackCost5hRollingWindow,
  getCost5hRollingWindow,
  trackCostDailyRollingWindow,
  getCostDailyRollingWindow,
} from "./rolling-window";
