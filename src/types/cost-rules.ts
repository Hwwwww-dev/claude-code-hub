/**
 * 成本规则类型定义
 */

/**
 * 时段配置
 */
export interface TimePeriodConfig {
  /** 开始时间 (HH:mm 格式) */
  startTime: string;
  /** 结束时间 (HH:mm 格式，支持跨天) */
  endTime: string;
  /** 生效的星期几 (1=周一, 7=周日)，null/空数组表示每天 */
  weekdays?: number[] | null;
}

/** 成本规则类型 */
export type CostRuleType = "model" | "time_period";

/** 倍率叠加策略 */
export type CostMultiplierStrategy = "highest_priority" | "multiply";

/** 成本规则（数据库实体） */
export interface ProviderCostRule {
  id: number;
  providerId: number;
  ruleType: CostRuleType;
  name: string;
  multiplier: string; // numeric 类型在 JS 中是 string
  priority: number;
  modelPattern: string | null;
  timePeriods: TimePeriodConfig[] | null;
  isEnabled: boolean;
  description: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** 创建成本规则参数 */
export interface CreateCostRuleParams {
  providerId: number;
  ruleType: CostRuleType;
  name: string;
  multiplier: string;
  priority?: number;
  modelPattern?: string | null;
  timePeriods?: TimePeriodConfig[] | null;
  isEnabled?: boolean;
  description?: string | null;
}

/** 更新成本规则参数 */
export interface UpdateCostRuleParams {
  name?: string;
  multiplier?: string;
  priority?: number;
  modelPattern?: string | null;
  timePeriods?: TimePeriodConfig[] | null;
  isEnabled?: boolean;
  description?: string | null;
}

/** 倍率计算上下文 */
export interface CostMultiplierContext {
  model: string;
  requestTime: Date;
  timezone: string;
}

/** 倍率计算结果 */
export interface CostMultiplierResult {
  finalMultiplier: number;
  appliedRules: Array<{
    ruleId: number;
    ruleName: string;
    ruleType: CostRuleType;
    multiplier: number;
    priority: number;
  }>;
  baseMultiplier: number;
}
