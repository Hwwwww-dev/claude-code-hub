"use client";

import { GripVertical, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { EndpointSelectionStrategy, ProviderEndpoint } from "@/types/provider-endpoint";
import { UrlPreview } from "./url-preview";

interface EndpointEditorProps {
  endpoints: ProviderEndpoint[];
  strategy: EndpointSelectionStrategy;
  onEndpointsChange: (endpoints: ProviderEndpoint[]) => void;
  onStrategyChange: (strategy: EndpointSelectionStrategy) => void;
  providerType?: string;
}

// 健康状态徽章颜色映射
const healthStatusColors: Record<
  ProviderEndpoint["healthStatus"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  healthy: "secondary",
  degraded: "outline",
  unhealthy: "destructive",
  unknown: "outline",
};

export function EndpointEditor({
  endpoints,
  strategy,
  onEndpointsChange,
  onStrategyChange,
  providerType,
}: EndpointEditorProps) {
  const t = useTranslations("settings.providers.endpoints");

  // 添加新端点
  const handleAddEndpoint = () => {
    const newEndpoint: ProviderEndpoint = {
      id: Date.now(), // 临时ID，保存时会替换
      providerId: 0,
      name: "",
      url: "",
      apiKey: null,
      priority: endpoints.length,
      weight: 1,
      isEnabled: true,
      healthStatus: "healthy",
      consecutiveFailures: 0,
      lastFailureTime: null,
      lastSuccessTime: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    onEndpointsChange([...endpoints, newEndpoint]);
  };

  // 删除端点
  const handleDeleteEndpoint = (index: number) => {
    const newEndpoints = endpoints.filter((_, i) => i !== index);
    onEndpointsChange(newEndpoints);
  };

  // 更新端点字段
  const handleUpdateEndpoint = (
    index: number,
    field: keyof ProviderEndpoint,
    value: string | number | boolean | null
  ) => {
    const newEndpoints = [...endpoints];
    // @ts-expect-error - 动态字段赋值
    newEndpoints[index][field] = value;
    onEndpointsChange(newEndpoints);
  };

  // 上移端点
  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const newEndpoints = [...endpoints];
    [newEndpoints[index - 1], newEndpoints[index]] = [newEndpoints[index], newEndpoints[index - 1]];
    // 更新优先级
    newEndpoints.forEach((ep, i) => {
      ep.priority = i;
    });
    onEndpointsChange(newEndpoints);
  };

  // 下移端点
  const handleMoveDown = (index: number) => {
    if (index === endpoints.length - 1) return;
    const newEndpoints = [...endpoints];
    [newEndpoints[index], newEndpoints[index + 1]] = [newEndpoints[index + 1], newEndpoints[index]];
    // 更新优先级
    newEndpoints.forEach((ep, i) => {
      ep.priority = i;
    });
    onEndpointsChange(newEndpoints);
  };

  return (
    <div className="space-y-4">
      {/* 策略选择器 */}
      <div className="space-y-2">
        <Label htmlFor="endpoint-strategy">{t("strategy.label")}</Label>
        <Select value={strategy} onValueChange={onStrategyChange}>
          <SelectTrigger id="endpoint-strategy" className="w-full">
            <SelectValue placeholder={t("strategy.placeholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="failover">
              <div className="space-y-1">
                <div className="font-medium">{t("strategy.failover.label")}</div>
                <div className="text-xs text-muted-foreground max-w-xs">
                  {t("strategy.failover.desc")}
                </div>
              </div>
            </SelectItem>
            <SelectItem value="round_robin">
              <div className="space-y-1">
                <div className="font-medium">{t("strategy.roundRobin.label")}</div>
                <div className="text-xs text-muted-foreground max-w-xs">
                  {t("strategy.roundRobin.desc")}
                </div>
              </div>
            </SelectItem>
            <SelectItem value="random">
              <div className="space-y-1">
                <div className="font-medium">{t("strategy.random.label")}</div>
                <div className="text-xs text-muted-foreground max-w-xs">
                  {t("strategy.random.desc")}
                </div>
              </div>
            </SelectItem>
            <SelectItem value="weighted">
              <div className="space-y-1">
                <div className="font-medium">{t("strategy.weighted.label")}</div>
                <div className="text-xs text-muted-foreground max-w-xs">
                  {t("strategy.weighted.desc")}
                </div>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t("strategy.hint")}</p>
      </div>

      {/* 端点列表 */}
      <div className="space-y-3">
        {endpoints.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">{t("empty")}</div>
        ) : (
          endpoints.map((endpoint, index) => (
            <Card key={endpoint.id} className="py-4">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <GripVertical className="h-5 w-5 text-muted-foreground cursor-grab" />
                    <CardTitle className="text-base">
                      {endpoint.name || t("untitled", { index: index + 1 })}
                    </CardTitle>
                    <Badge variant={healthStatusColors[endpoint.healthStatus]}>
                      {t(`healthStatus.${endpoint.healthStatus}`)}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleMoveUp(index)}
                      disabled={index === 0}
                    >
                      ↑
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleMoveDown(index)}
                      disabled={index === endpoints.length - 1}
                    >
                      ↓
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteEndpoint(index)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-3">
                {/* 名称 */}
                <div className="space-y-1">
                  <Label htmlFor={`endpoint-name-${index}`}>{t("fields.name.label")}</Label>
                  <Input
                    id={`endpoint-name-${index}`}
                    value={endpoint.name}
                    onChange={(e) => handleUpdateEndpoint(index, "name", e.target.value)}
                    placeholder={t("fields.name.placeholder")}
                  />
                </div>

                {/* URL */}
                <div className="space-y-1">
                  <Label htmlFor={`endpoint-url-${index}`}>{t("fields.url.label")}</Label>
                  <Input
                    id={`endpoint-url-${index}`}
                    value={endpoint.url}
                    onChange={(e) => handleUpdateEndpoint(index, "url", e.target.value)}
                    placeholder={t("fields.url.placeholder")}
                  />
                  {endpoint.url && providerType && (
                    <UrlPreview baseUrl={endpoint.url} providerType={providerType} />
                  )}
                </div>

                {/* API Key (可选) */}
                <div className="space-y-1">
                  <Label htmlFor={`endpoint-key-${index}`}>
                    {t("fields.apiKey.label")}
                    <span className="text-xs text-muted-foreground ml-1">
                      {t("fields.apiKey.optional")}
                    </span>
                  </Label>
                  <Input
                    id={`endpoint-key-${index}`}
                    type="password"
                    value={endpoint.apiKey || ""}
                    onChange={(e) => handleUpdateEndpoint(index, "apiKey", e.target.value || null)}
                    placeholder={t("fields.apiKey.placeholder")}
                  />
                  <p className="text-xs text-muted-foreground">{t("fields.apiKey.hint")}</p>
                </div>

                {/* 优先级 / 权重 / 启用状态 */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor={`endpoint-priority-${index}`}>
                      {t("fields.priority.label")}
                    </Label>
                    <Input
                      id={`endpoint-priority-${index}`}
                      type="number"
                      value={endpoint.priority}
                      onChange={(e) =>
                        handleUpdateEndpoint(index, "priority", parseInt(e.target.value, 10) || 0)
                      }
                      min="0"
                      step="1"
                    />
                    <p className="text-xs text-muted-foreground">{t("fields.priority.hint")}</p>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor={`endpoint-weight-${index}`}>{t("fields.weight.label")}</Label>
                    <Input
                      id={`endpoint-weight-${index}`}
                      type="number"
                      value={endpoint.weight}
                      onChange={(e) =>
                        handleUpdateEndpoint(index, "weight", parseInt(e.target.value, 10) || 1)
                      }
                      min="1"
                      step="1"
                    />
                    <p className="text-xs text-muted-foreground">{t("fields.weight.hint")}</p>
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor={`endpoint-enabled-${index}`}>{t("fields.enabled.label")}</Label>
                    <div className="flex items-center h-9">
                      <Switch
                        id={`endpoint-enabled-${index}`}
                        checked={endpoint.isEnabled}
                        onCheckedChange={(checked) =>
                          handleUpdateEndpoint(index, "isEnabled", checked)
                        }
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* 添加端点按钮 */}
      <Button type="button" variant="outline" onClick={handleAddEndpoint} className="w-full">
        <Plus className="h-4 w-4 mr-2" />
        {t("addEndpoint")}
      </Button>
    </div>
  );
}
