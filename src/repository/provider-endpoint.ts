"use server";

import { asc, eq } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { providerEndpoints } from "@/drizzle/schema";
import { logger } from "@/lib/logger";
import type {
  CreateProviderEndpointData,
  EndpointHealthStatus,
  ProviderEndpoint,
  UpdateProviderEndpointData,
} from "@/types/provider-endpoint";
import { toProviderEndpoint } from "./_shared/transformers";

/**
 * 查询指定供应商的所有端点
 * 按 priority ASC 排序
 */
export async function findEndpointsByProviderId(providerId: number): Promise<ProviderEndpoint[]> {
  const result = await db
    .select({
      id: providerEndpoints.id,
      providerId: providerEndpoints.providerId,
      name: providerEndpoints.name,
      url: providerEndpoints.url,
      apiKey: providerEndpoints.apiKey,
      priority: providerEndpoints.priority,
      weight: providerEndpoints.weight,
      isEnabled: providerEndpoints.isEnabled,
      healthStatus: providerEndpoints.healthStatus,
      consecutiveFailures: providerEndpoints.consecutiveFailures,
      lastFailureTime: providerEndpoints.lastFailureTime,
      lastSuccessTime: providerEndpoints.lastSuccessTime,
      createdAt: providerEndpoints.createdAt,
      updatedAt: providerEndpoints.updatedAt,
    })
    .from(providerEndpoints)
    .where(eq(providerEndpoints.providerId, providerId))
    .orderBy(asc(providerEndpoints.priority));

  logger.trace("findEndpointsByProviderId:query_result", {
    providerId,
    count: result.length,
    ids: result.map((r) => r.id),
  });

  return result.map(toProviderEndpoint);
}

/**
 * 查询单个端点
 */
export async function findEndpointById(id: number): Promise<ProviderEndpoint | null> {
  const [endpoint] = await db
    .select({
      id: providerEndpoints.id,
      providerId: providerEndpoints.providerId,
      name: providerEndpoints.name,
      url: providerEndpoints.url,
      apiKey: providerEndpoints.apiKey,
      priority: providerEndpoints.priority,
      weight: providerEndpoints.weight,
      isEnabled: providerEndpoints.isEnabled,
      healthStatus: providerEndpoints.healthStatus,
      consecutiveFailures: providerEndpoints.consecutiveFailures,
      lastFailureTime: providerEndpoints.lastFailureTime,
      lastSuccessTime: providerEndpoints.lastSuccessTime,
      createdAt: providerEndpoints.createdAt,
      updatedAt: providerEndpoints.updatedAt,
    })
    .from(providerEndpoints)
    .where(eq(providerEndpoints.id, id));

  if (!endpoint) return null;
  return toProviderEndpoint(endpoint);
}

/**
 * 创建新端点
 */
export async function createEndpoint(data: CreateProviderEndpointData): Promise<ProviderEndpoint> {
  const dbData = {
    providerId: data.provider_id,
    name: data.name,
    url: data.url,
    apiKey: data.api_key ?? null,
    priority: data.priority ?? 0,
    weight: data.weight ?? 1,
    isEnabled: data.is_enabled ?? true,
    healthStatus: (data.health_status ?? "unknown") as EndpointHealthStatus,
    consecutiveFailures: data.consecutive_failures ?? 0,
    lastFailureTime: data.last_failure_time ?? null,
    lastSuccessTime: data.last_success_time ?? null,
  };

  const [endpoint] = await db.insert(providerEndpoints).values(dbData).returning({
    id: providerEndpoints.id,
    providerId: providerEndpoints.providerId,
    name: providerEndpoints.name,
    url: providerEndpoints.url,
    apiKey: providerEndpoints.apiKey,
    priority: providerEndpoints.priority,
    weight: providerEndpoints.weight,
    isEnabled: providerEndpoints.isEnabled,
    healthStatus: providerEndpoints.healthStatus,
    consecutiveFailures: providerEndpoints.consecutiveFailures,
    lastFailureTime: providerEndpoints.lastFailureTime,
    lastSuccessTime: providerEndpoints.lastSuccessTime,
    createdAt: providerEndpoints.createdAt,
    updatedAt: providerEndpoints.updatedAt,
  });

  return toProviderEndpoint(endpoint);
}

/**
 * 更新端点
 * 自动更新 updatedAt
 */
export async function updateEndpoint(
  id: number,
  data: UpdateProviderEndpointData
): Promise<ProviderEndpoint> {
  if (Object.keys(data).length === 0) {
    const existing = await findEndpointById(id);
    if (!existing) {
      throw new Error(`Endpoint with id ${id} not found`);
    }
    return existing;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbData: any = {
    updatedAt: new Date(),
  };

  if (data.name !== undefined) dbData.name = data.name;
  if (data.url !== undefined) dbData.url = data.url;
  if (data.api_key !== undefined) dbData.apiKey = data.api_key;
  if (data.priority !== undefined) dbData.priority = data.priority;
  if (data.weight !== undefined) dbData.weight = data.weight;
  if (data.is_enabled !== undefined) dbData.isEnabled = data.is_enabled;
  if (data.health_status !== undefined) dbData.healthStatus = data.health_status;
  if (data.consecutive_failures !== undefined)
    dbData.consecutiveFailures = data.consecutive_failures;
  if (data.last_failure_time !== undefined) dbData.lastFailureTime = data.last_failure_time;
  if (data.last_success_time !== undefined) dbData.lastSuccessTime = data.last_success_time;

  const [endpoint] = await db
    .update(providerEndpoints)
    .set(dbData)
    .where(eq(providerEndpoints.id, id))
    .returning({
      id: providerEndpoints.id,
      providerId: providerEndpoints.providerId,
      name: providerEndpoints.name,
      url: providerEndpoints.url,
      apiKey: providerEndpoints.apiKey,
      priority: providerEndpoints.priority,
      weight: providerEndpoints.weight,
      isEnabled: providerEndpoints.isEnabled,
      healthStatus: providerEndpoints.healthStatus,
      consecutiveFailures: providerEndpoints.consecutiveFailures,
      lastFailureTime: providerEndpoints.lastFailureTime,
      lastSuccessTime: providerEndpoints.lastSuccessTime,
      createdAt: providerEndpoints.createdAt,
      updatedAt: providerEndpoints.updatedAt,
    });

  if (!endpoint) {
    throw new Error(`Endpoint with id ${id} not found`);
  }

  return toProviderEndpoint(endpoint);
}

/**
 * 删除端点（真删除，不是软删除）
 */
export async function deleteEndpoint(id: number): Promise<void> {
  const result = await db
    .delete(providerEndpoints)
    .where(eq(providerEndpoints.id, id))
    .returning({ id: providerEndpoints.id });

  if (result.length === 0) {
    throw new Error(`Endpoint with id ${id} not found`);
  }
}

/**
 * 更新端点健康状态
 * 用于健康追踪
 */
export async function updateEndpointHealth(
  id: number,
  health: {
    consecutiveFailures?: number;
    lastFailureTime?: Date;
    lastSuccessTime?: Date;
    healthStatus?: EndpointHealthStatus;
  }
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbData: any = {
    updatedAt: new Date(),
  };

  if (health.consecutiveFailures !== undefined)
    dbData.consecutiveFailures = health.consecutiveFailures;
  if (health.lastFailureTime !== undefined) dbData.lastFailureTime = health.lastFailureTime;
  if (health.lastSuccessTime !== undefined) dbData.lastSuccessTime = health.lastSuccessTime;
  if (health.healthStatus !== undefined) dbData.healthStatus = health.healthStatus;

  const result = await db
    .update(providerEndpoints)
    .set(dbData)
    .where(eq(providerEndpoints.id, id))
    .returning({ id: providerEndpoints.id });

  if (result.length === 0) {
    throw new Error(`Endpoint with id ${id} not found`);
  }
}
