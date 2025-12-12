/**
 * 成本倍率计算模块
 * 支持模型级倍率(通配符匹配)和时段级倍率(时间判断)
 */

import type {
  CostMultiplierContext,
  CostMultiplierResult,
  CostMultiplierStrategy,
  ProviderCostRule,
  TimePeriodConfig,
} from "@/types/cost-rules";

/**
 * 验证时间字符串格式 (HH:mm)
 */
function validateTimeFormat(timeStr: string): boolean {
  const timeRegex = /^([0-1]\d|2[0-3]):([0-5]\d)$/;
  return timeRegex.test(timeStr);
}

/**
 * 验证时区字符串
 */
function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * 通配符模式匹配
 * 支持 * 匹配任意字符，? 匹配单个字符
 *
 * @example
 * matchWildcard("claude-3-5-*", "claude-3-5-sonnet") // true
 * matchWildcard("claude-*-sonnet", "claude-3-5-sonnet") // true
 * matchWildcard("gpt-4?", "gpt-4o") // true
 */
export function matchWildcard(pattern: string, text: string): boolean {
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");

  const regex = new RegExp(`^${regexPattern}$`, "i");
  return regex.test(text);
}

/**
 * 检查当前时间是否在指定时段内
 */
export function isWithinTimePeriod(
  timePeriods: TimePeriodConfig[],
  currentTime: Date,
  timezone: string
): boolean {
  if (!timePeriods || timePeriods.length === 0) {
    return false;
  }

  // 验证时区
  if (!isValidTimezone(timezone)) {
    console.warn("[CostMultiplier] Invalid timezone, using UTC", { timezone });
    timezone = "UTC";
  }

  // 转换为供应商时区的本地时间
  let localTime: Date;
  try {
    localTime = new Date(currentTime.toLocaleString("en-US", { timeZone: timezone }));
  } catch (error) {
    console.warn("[CostMultiplier] Timezone conversion failed, using UTC", { timezone, error });
    localTime = currentTime;
  }

  const currentHour = localTime.getHours();
  const currentMinute = localTime.getMinutes();
  const currentWeekday = localTime.getDay() === 0 ? 7 : localTime.getDay();
  const currentMinutes = currentHour * 60 + currentMinute;

  for (const period of timePeriods) {
    // 验证时间格式
    if (!validateTimeFormat(period.startTime) || !validateTimeFormat(period.endTime)) {
      console.warn("[CostMultiplier] Invalid time format", {
        startTime: period.startTime,
        endTime: period.endTime,
      });
      continue;
    }

    // 检查星期几是否匹配
    if (period.weekdays && period.weekdays.length > 0) {
      if (!period.weekdays.includes(currentWeekday)) {
        continue;
      }
    }

    const [startHour, startMin] = period.startTime.split(":").map(Number);
    const [endHour, endMin] = period.endTime.split(":").map(Number);
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    if (startMinutes <= endMinutes) {
      // 不跨天
      if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
        return true;
      }
    } else {
      // 跨天
      if (currentMinutes >= startMinutes || currentMinutes < endMinutes) {
        return true;
      }
    }
  }

  return false;
}

/**
 * 计算最终倍率
 */
export function calculateFinalMultiplier(
  baseMultiplier: number,
  rules: ProviderCostRule[],
  context: CostMultiplierContext,
  strategy: CostMultiplierStrategy
): CostMultiplierResult {
  const appliedRules: CostMultiplierResult["appliedRules"] = [];
  const enabledRules = rules.filter((rule) => rule.isEnabled);
  const matchedRules: ProviderCostRule[] = [];

  for (const rule of enabledRules) {
    if (rule.ruleType === "model") {
      if (rule.modelPattern && matchWildcard(rule.modelPattern, context.model)) {
        matchedRules.push(rule);
      }
    } else if (rule.ruleType === "time_period") {
      if (
        rule.timePeriods &&
        isWithinTimePeriod(rule.timePeriods, context.requestTime, context.timezone)
      ) {
        matchedRules.push(rule);
      }
    }
  }

  if (matchedRules.length === 0) {
    return {
      finalMultiplier: baseMultiplier,
      appliedRules: [],
      baseMultiplier,
    };
  }

  let finalMultiplier: number;

  if (strategy === "highest_priority") {
    const sortedRules = [...matchedRules].sort((a, b) => b.priority - a.priority);
    const highestPriorityRule = sortedRules[0];
    const ruleMultiplier = parseFloat(highestPriorityRule.multiplier);

    appliedRules.push({
      ruleId: highestPriorityRule.id,
      ruleName: highestPriorityRule.name,
      ruleType: highestPriorityRule.ruleType,
      multiplier: ruleMultiplier,
      priority: highestPriorityRule.priority,
    });

    finalMultiplier = baseMultiplier * ruleMultiplier;
  } else {
    let combinedMultiplier = 1;

    for (const rule of matchedRules) {
      const ruleMultiplier = parseFloat(rule.multiplier);
      combinedMultiplier *= ruleMultiplier;
      appliedRules.push({
        ruleId: rule.id,
        ruleName: rule.name,
        ruleType: rule.ruleType,
        multiplier: ruleMultiplier,
        priority: rule.priority,
      });
    }

    finalMultiplier = baseMultiplier * combinedMultiplier;
  }

  return {
    finalMultiplier,
    appliedRules,
    baseMultiplier,
  };
}
