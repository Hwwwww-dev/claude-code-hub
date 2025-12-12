import { and, desc, eq } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { providerCostRules } from "@/drizzle/schema";
import { calculateFinalMultiplier } from "@/lib/utils/cost-multiplier";
import type {
  CostMultiplierResult,
  CostMultiplierStrategy,
  CreateCostRuleParams,
  ProviderCostRule,
  UpdateCostRuleParams,
} from "@/types/cost-rules";

/**
 * 根据供应商 ID 查询所有成本规则
 */
export async function findCostRulesByProviderId(providerId: number): Promise<ProviderCostRule[]> {
  const results = await db
    .select()
    .from(providerCostRules)
    .where(eq(providerCostRules.providerId, providerId))
    .orderBy(desc(providerCostRules.priority));

  return results as ProviderCostRule[];
}

/**
 * 根据供应商 ID 查询已启用的成本规则
 */
export async function findEnabledCostRulesByProviderId(
  providerId: number
): Promise<ProviderCostRule[]> {
  const results = await db
    .select()
    .from(providerCostRules)
    .where(and(eq(providerCostRules.providerId, providerId), eq(providerCostRules.isEnabled, true)))
    .orderBy(desc(providerCostRules.priority));

  return results as ProviderCostRule[];
}

/**
 * 根据 ID 查询单个成本规则
 */
export async function findCostRuleById(ruleId: number): Promise<ProviderCostRule | null> {
  const results = await db
    .select()
    .from(providerCostRules)
    .where(eq(providerCostRules.id, ruleId))
    .limit(1);

  return (results[0] as ProviderCostRule) || null;
}

/**
 * 创建成本规则
 */
export async function createCostRule(params: CreateCostRuleParams): Promise<ProviderCostRule> {
  const [result] = await db
    .insert(providerCostRules)
    .values({
      providerId: params.providerId,
      ruleType: params.ruleType,
      name: params.name,
      multiplier: params.multiplier,
      priority: params.priority ?? 0,
      modelPattern: params.modelPattern ?? null,
      timePeriods: params.timePeriods ?? null,
      isEnabled: params.isEnabled ?? true,
      description: params.description ?? null,
    })
    .returning();

  return result as ProviderCostRule;
}

/**
 * 更新成本规则
 */
export async function updateCostRule(
  ruleId: number,
  params: UpdateCostRuleParams
): Promise<ProviderCostRule | null> {
  const updateData: Record<string, unknown> = {
    updatedAt: new Date(),
  };

  if (params.name !== undefined) updateData.name = params.name;
  if (params.multiplier !== undefined) updateData.multiplier = params.multiplier;
  if (params.priority !== undefined) updateData.priority = params.priority;
  if (params.modelPattern !== undefined) updateData.modelPattern = params.modelPattern;
  if (params.timePeriods !== undefined) updateData.timePeriods = params.timePeriods;
  if (params.isEnabled !== undefined) updateData.isEnabled = params.isEnabled;
  if (params.description !== undefined) updateData.description = params.description;

  const [result] = await db
    .update(providerCostRules)
    .set(updateData)
    .where(eq(providerCostRules.id, ruleId))
    .returning();

  return (result as ProviderCostRule) || null;
}

/**
 * 删除成本规则
 */
export async function deleteCostRule(ruleId: number): Promise<boolean> {
  const result = await db
    .delete(providerCostRules)
    .where(eq(providerCostRules.id, ruleId))
    .returning({ id: providerCostRules.id });

  return result.length > 0;
}

/**
 * 批量删除供应商的所有成本规则
 */
export async function deleteCostRulesByProviderId(providerId: number): Promise<number> {
  const result = await db
    .delete(providerCostRules)
    .where(eq(providerCostRules.providerId, providerId))
    .returning({ id: providerCostRules.id });

  return result.length;
}

/**
 * 计算供应商的有效成本倍率（封装规则查询和计算逻辑）
 */
export async function calculateEffectiveCostMultiplier(
  providerId: number,
  baseMultiplier: number,
  strategy: CostMultiplierStrategy,
  timezone: string,
  model: string
): Promise<CostMultiplierResult> {
  const rules = await findEnabledCostRulesByProviderId(providerId);
  return calculateFinalMultiplier(
    baseMultiplier,
    rules,
    {
      model,
      requestTime: new Date(),
      timezone,
    },
    strategy
  );
}
