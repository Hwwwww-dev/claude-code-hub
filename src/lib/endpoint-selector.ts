"use server";

import { logger } from "@/lib/logger";
import { findEndpointsByProviderId } from "@/repository/provider-endpoint";
import type { Provider } from "@/types/provider";
import type { ResolvedEndpoint } from "@/types/provider-endpoint";

/**
 * 端点选择器 - 根据供应商配置和策略选择最佳端点
 */
export class EndpointSelector {
  /**
   * 轮询索引存储 (providerId => currentIndex)
   */
  private static roundRobinIndex = new Map<number, number>();

  /**
   * 选择端点
   * @param provider 供应商配置
   * @param excludeEndpointIds 需要排除的端点ID列表
   * @returns 解析后的端点对象,无可用端点时返回null
   */
  static async selectEndpoint(
    provider: Provider,
    excludeEndpointIds?: number[]
  ): Promise<ResolvedEndpoint | null> {
    // 向后兼容：未启用多端点时使用默认端点
    if (!provider.useMultipleEndpoints) {
      return {
        id: 0,
        name: "default",
        url: provider.url,
        apiKey: provider.key,
        priority: 0,
        weight: 1,
        healthStatus: "healthy",
        consecutiveFailures: 0,
      };
    }

    // 获取所有端点
    const allEndpoints = await findEndpointsByProviderId(provider.id);

    // 过滤可用端点
    const availableEndpoints = allEndpoints
      .filter((ep) => {
        return (
          ep.isEnabled && ep.healthStatus !== "unhealthy" && !excludeEndpointIds?.includes(ep.id)
        );
      })
      .map((ep) => ({
        ...ep,
        // 解析 apiKey: 优先使用端点自己的 key, 否则使用供应商 key
        apiKey: ep.apiKey || provider.key,
      }));

    // 无可用端点
    if (availableEndpoints.length === 0) {
      logger.warn(
        `[EndpointSelector] No available endpoints for provider ${provider.id} (${provider.name})`
      );
      return null;
    }

    // 根据策略选择端点
    const strategy = provider.endpointSelectionStrategy || "failover";
    switch (strategy) {
      case "failover":
        return EndpointSelector.selectFailover(availableEndpoints);
      case "round_robin":
        return EndpointSelector.selectRoundRobin(provider.id, availableEndpoints);
      case "random":
        return EndpointSelector.selectRandom(availableEndpoints);
      case "weighted":
        return EndpointSelector.selectWeighted(availableEndpoints);
      default:
        logger.warn(`[EndpointSelector] Unknown strategy "${strategy}", fallback to failover`);
        return EndpointSelector.selectFailover(availableEndpoints);
    }
  }

  /**
   * Failover 策略: 按优先级排序,返回第一个
   */
  private static selectFailover(endpoints: ResolvedEndpoint[]): ResolvedEndpoint {
    // 按 priority 升序排序 (数值越小优先级越高)
    const sorted = [...endpoints].sort((a, b) => a.priority - b.priority);
    return sorted[0];
  }

  /**
   * Round Robin 策略: 轮询选择
   */
  private static selectRoundRobin(
    providerId: number,
    endpoints: ResolvedEndpoint[]
  ): ResolvedEndpoint {
    const currentIndex = EndpointSelector.roundRobinIndex.get(providerId) || 0;
    const selected = endpoints[currentIndex % endpoints.length];

    // 更新索引
    EndpointSelector.roundRobinIndex.set(providerId, currentIndex + 1);

    return selected;
  }

  /**
   * Random 策略: 随机选择
   */
  private static selectRandom(endpoints: ResolvedEndpoint[]): ResolvedEndpoint {
    const randomIndex = Math.floor(Math.random() * endpoints.length);
    return endpoints[randomIndex];
  }

  /**
   * Weighted 策略: 按权重随机选择
   */
  private static selectWeighted(endpoints: ResolvedEndpoint[]): ResolvedEndpoint {
    // 计算总权重
    const totalWeight = endpoints.reduce((sum, ep) => sum + ep.weight, 0);

    // 生成随机数
    let random = Math.random() * totalWeight;

    // 根据权重选择
    for (const endpoint of endpoints) {
      random -= endpoint.weight;
      if (random <= 0) {
        return endpoint;
      }
    }

    // 兜底: 返回最后一个 (理论上不会到这里)
    return endpoints[endpoints.length - 1];
  }
}
