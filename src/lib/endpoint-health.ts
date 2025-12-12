"use server";

import { updateEndpointHealth } from "@/repository/provider-endpoint";
import type { EndpointHealthStatus } from "@/types/provider-endpoint";

/**
 * 端点健康追踪器
 *
 * 核心功能：
 * 1. 记录端点请求成功/失败
 * 2. 根据连续失败次数自动更新健康状态
 * 3. 支持熔断器集成（失败阈值触发状态切换）
 */
export class EndpointHealthTracker {
  private static readonly FAILURE_THRESHOLD = 3; // 连续失败阈值
  private static readonly DEGRADED_THRESHOLD = 1; // 降级阈值

  /**
   * 记录端点请求成功
   * - 重置连续失败计数
   * - 更新最后成功时间
   * - 设置健康状态为 healthy
   *
   * @param endpointId 端点 ID（0 表示默认端点，跳过记录）
   */
  static async recordSuccess(endpointId: number): Promise<void> {
    // 跳过默认端点（endpointId === 0）
    if (endpointId === 0) {
      return;
    }

    await updateEndpointHealth(endpointId, {
      consecutiveFailures: 0,
      lastSuccessTime: new Date(),
      healthStatus: "healthy",
    });
  }

  /**
   * 记录端点请求失败
   * - 增加连续失败计数
   * - 更新最后失败时间
   * - 根据失败次数自动设置健康状态
   *
   * @param endpointId 端点 ID（0 表示默认端点，跳过记录）
   * @param currentFailures 当前连续失败次数
   * @returns 新的健康状态
   */
  static async recordFailure(
    endpointId: number,
    currentFailures: number
  ): Promise<EndpointHealthStatus> {
    // 跳过默认端点（endpointId === 0）
    if (endpointId === 0) {
      return "healthy";
    }

    const newFailures = currentFailures + 1;
    let healthStatus: EndpointHealthStatus;

    // 根据失败次数设置健康状态
    if (newFailures >= EndpointHealthTracker.FAILURE_THRESHOLD) {
      healthStatus = "unhealthy";
    } else if (newFailures >= EndpointHealthTracker.DEGRADED_THRESHOLD) {
      healthStatus = "degraded";
    } else {
      healthStatus = "healthy";
    }

    await updateEndpointHealth(endpointId, {
      consecutiveFailures: newFailures,
      lastFailureTime: new Date(),
      healthStatus,
    });

    return healthStatus;
  }
}
