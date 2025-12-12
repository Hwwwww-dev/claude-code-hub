"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import {
  createCostRule,
  deleteCostRule,
  findCostRuleById,
  findCostRulesByProviderId,
  updateCostRule,
} from "@/repository/provider-cost-rules";
import type {
  CreateCostRuleParams,
  ProviderCostRule,
  UpdateCostRuleParams,
} from "@/types/cost-rules";
import type { ActionResult } from "./types";

/**
 * 获取供应商的所有成本规则
 */
export async function getCostRules(providerId: number): Promise<ActionResult<ProviderCostRule[]>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    const rules = await findCostRulesByProviderId(providerId);
    return { ok: true, data: rules };
  } catch (error) {
    logger.error("获取成本规则失败:", error);
    const message = error instanceof Error ? error.message : "获取成本规则失败";
    return { ok: false, error: message };
  }
}

/**
 * 创建成本规则
 */
export async function addCostRule(
  params: CreateCostRuleParams
): Promise<ActionResult<ProviderCostRule>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    // 验证参数
    if (params.ruleType === "model" && !params.modelPattern) {
      return { ok: false, error: "模型级倍率必须指定模型匹配模式" };
    }
    if (
      params.ruleType === "time_period" &&
      (!params.timePeriods || params.timePeriods.length === 0)
    ) {
      return { ok: false, error: "时段级倍率必须指定至少一个时间段" };
    }

    const rule = await createCostRule(params);

    revalidatePath("/settings/providers");
    return { ok: true, data: rule };
  } catch (error) {
    logger.error("创建成本规则失败:", error);
    const message = error instanceof Error ? error.message : "创建成本规则失败";
    return { ok: false, error: message };
  }
}

/**
 * 更新成本规则
 */
export async function editCostRule(
  ruleId: number,
  params: UpdateCostRuleParams
): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    // 先获取现有规则以验证
    const existingRule = await findCostRuleById(ruleId);
    if (!existingRule) {
      return { ok: false, error: "规则不存在" };
    }

    await updateCostRule(ruleId, params);

    revalidatePath("/settings/providers");
    return { ok: true };
  } catch (error) {
    logger.error("更新成本规则失败:", error);
    const message = error instanceof Error ? error.message : "更新成本规则失败";
    return { ok: false, error: message };
  }
}

/**
 * 删除成本规则
 */
export async function removeCostRule(ruleId: number): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    const success = await deleteCostRule(ruleId);
    if (!success) {
      return { ok: false, error: "规则不存在" };
    }

    revalidatePath("/settings/providers");
    return { ok: true };
  } catch (error) {
    logger.error("删除成本规则失败:", error);
    const message = error instanceof Error ? error.message : "删除成本规则失败";
    return { ok: false, error: message };
  }
}

/**
 * 切换规则启用状态
 */
export async function toggleCostRule(ruleId: number, isEnabled: boolean): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    const existingRule = await findCostRuleById(ruleId);
    if (!existingRule) {
      return { ok: false, error: "规则不存在" };
    }

    await updateCostRule(ruleId, { isEnabled });

    revalidatePath("/settings/providers");
    return { ok: true };
  } catch (error) {
    logger.error("切换规则状态失败:", error);
    const message = error instanceof Error ? error.message : "切换规则状态失败";
    return { ok: false, error: message };
  }
}
