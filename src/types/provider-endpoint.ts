// 端点健康状态枚举
export type EndpointHealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

// 端点选择策略枚举
export type EndpointSelectionStrategy = "failover" | "round_robin" | "random" | "weighted";

// 端点基础数据类型
export interface ProviderEndpoint {
  id: number;
  providerId: number;
  name: string;
  url: string;
  apiKey: string | null;
  priority: number;
  weight: number;
  isEnabled: boolean;
  healthStatus: EndpointHealthStatus;
  consecutiveFailures: number;
  lastFailureTime: Date | null;
  lastSuccessTime: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// 创建端点数据类型
export interface CreateProviderEndpointData {
  provider_id: number;
  name: string;
  url: string;
  api_key?: string | null;
  priority?: number;
  weight?: number;
  is_enabled?: boolean;
  health_status?: EndpointHealthStatus;
  consecutive_failures?: number;
  last_failure_time?: Date | null;
  last_success_time?: Date | null;
}

// 更新端点数据类型
export interface UpdateProviderEndpointData {
  name?: string;
  url?: string;
  api_key?: string | null;
  priority?: number;
  weight?: number;
  is_enabled?: boolean;
  health_status?: EndpointHealthStatus;
  consecutive_failures?: number;
  last_failure_time?: Date | null;
  last_success_time?: Date | null;
}

// 运行时使用的有效端点（包含解析后的 API Key）
export interface ResolvedEndpoint {
  id: number;
  name: string;
  url: string;
  apiKey: string; // 已解析（优先使用端点级别，否则继承供应商）
  priority: number;
  weight: number;
  healthStatus: EndpointHealthStatus;
  consecutiveFailures: number;
}
