"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import {
  createEndpoint,
  deleteEndpoint,
  findEndpointById,
  updateEndpoint,
} from "@/repository/provider-endpoint";
import type {
  CreateProviderEndpointData,
  ProviderEndpoint,
  UpdateProviderEndpointData,
} from "@/types/provider-endpoint";
import type { ActionResult } from "./types";

/**
 * 创建新端点
 */
export async function addEndpoint(
  data: CreateProviderEndpointData
): Promise<ActionResult<ProviderEndpoint>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    logger.trace("addEndpoint:input", {
      providerId: data.provider_id,
      name: data.name,
      url: data.url,
    });

    // 验证必填字段
    if (!data.provider_id || !data.name || !data.url) {
      return { ok: false, error: "缺少必填字段：provider_id, name, url" };
    }

    const endpoint = await createEndpoint(data);
    logger.trace("addEndpoint:created_success", {
      endpointId: endpoint.id,
      providerId: data.provider_id,
      name: data.name,
    });

    revalidatePath("/[locale]/settings/providers", "page");
    logger.trace("addEndpoint:revalidated", { path: "/[locale]/settings/providers" });

    return { ok: true, data: endpoint };
  } catch (error) {
    logger.trace("addEndpoint:error", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    logger.error("创建端点失败:", error);
    const message = error instanceof Error ? error.message : "创建端点失败";
    return { ok: false, error: message };
  }
}

/**
 * 更新端点
 */
export async function editEndpoint(
  endpointId: number,
  data: UpdateProviderEndpointData
): Promise<ActionResult<ProviderEndpoint>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    logger.trace("editEndpoint:input", {
      endpointId,
      dataKeys: Object.keys(data),
    });

    // 验证端点是否存在
    const existingEndpoint = await findEndpointById(endpointId);
    if (!existingEndpoint) {
      return { ok: false, error: "端点不存在" };
    }

    const updatedEndpoint = await updateEndpoint(endpointId, data);
    logger.trace("editEndpoint:updated_success", {
      endpointId,
      providerId: existingEndpoint.providerId,
    });

    revalidatePath("/[locale]/settings/providers", "page");
    logger.trace("editEndpoint:revalidated", { path: "/[locale]/settings/providers" });

    return { ok: true, data: updatedEndpoint };
  } catch (error) {
    logger.trace("editEndpoint:error", {
      endpointId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    logger.error("更新端点失败:", error);
    const message = error instanceof Error ? error.message : "更新端点失败";
    return { ok: false, error: message };
  }
}

/**
 * 删除端点
 */
export async function removeEndpoint(endpointId: number): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    logger.trace("removeEndpoint:input", { endpointId });

    // 验证端点是否存在
    const existingEndpoint = await findEndpointById(endpointId);
    if (!existingEndpoint) {
      return { ok: false, error: "端点不存在" };
    }

    await deleteEndpoint(endpointId);
    logger.trace("removeEndpoint:deleted_success", {
      endpointId,
      providerId: existingEndpoint.providerId,
    });

    revalidatePath("/[locale]/settings/providers", "page");
    logger.trace("removeEndpoint:revalidated", { path: "/[locale]/settings/providers" });

    return { ok: true };
  } catch (error) {
    logger.trace("removeEndpoint:error", {
      endpointId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    logger.error("删除端点失败:", error);
    const message = error instanceof Error ? error.message : "删除端点失败";
    return { ok: false, error: message };
  }
}

/**
 * 重新排序端点
 * 按照 orderedIds 的顺序更新端点的 priority
 */
export async function reorderEndpoints(
  providerId: number,
  orderedIds: number[]
): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    logger.trace("reorderEndpoints:input", {
      providerId,
      orderedIds,
      count: orderedIds.length,
    });

    // 验证输入
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return { ok: false, error: "无效的端点顺序列表" };
    }

    // 批量更新端点的 priority
    const updatePromises = orderedIds.map((endpointId, index) => {
      return updateEndpoint(endpointId, { priority: index });
    });

    await Promise.all(updatePromises);

    logger.trace("reorderEndpoints:success", {
      providerId,
      updatedCount: orderedIds.length,
    });

    revalidatePath("/[locale]/settings/providers", "page");
    logger.trace("reorderEndpoints:revalidated", { path: "/[locale]/settings/providers" });

    return { ok: true };
  } catch (error) {
    logger.trace("reorderEndpoints:error", {
      providerId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    logger.error("重新排序端点失败:", error);
    const message = error instanceof Error ? error.message : "重新排序端点失败";
    return { ok: false, error: message };
  }
}
