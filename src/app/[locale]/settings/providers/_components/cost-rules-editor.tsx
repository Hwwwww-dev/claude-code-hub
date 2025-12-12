"use client";

import { Clock, Plus, Tag, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getCostRules, removeCostRule, toggleCostRule } from "@/actions/provider-cost-rules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { ProviderCostRule } from "@/types/cost-rules";

interface CostRulesEditorProps {
  providerId?: number;
}

export function CostRulesEditor({ providerId }: CostRulesEditorProps) {
  const _t = useTranslations("settings.providers.form");
  const [rules, setRules] = useState<ProviderCostRule[]>([]);
  const [loading, setLoading] = useState(false);

  const loadRules = useCallback(async () => {
    if (!providerId) return;
    setLoading(true);
    const result = await getCostRules(providerId);
    if (result.ok && result.data) {
      setRules(result.data);
    }
    setLoading(false);
  }, [providerId]);

  useEffect(() => {
    if (providerId) {
      loadRules();
    }
  }, [providerId, loadRules]);

  async function handleToggle(ruleId: number, isEnabled: boolean) {
    const result = await toggleCostRule(ruleId, isEnabled);
    if (result.ok) {
      setRules((prev) => prev.map((r) => (r.id === ruleId ? { ...r, isEnabled } : r)));
      toast.success(isEnabled ? "规则已启用" : "规则已禁用");
    } else {
      toast.error(result.error || "操作失败");
    }
  }

  async function handleDelete(ruleId: number) {
    if (!confirm("确定要删除此规则吗?")) return;
    const result = await removeCostRule(ruleId);
    if (result.ok) {
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
      toast.success("规则已删除");
    } else {
      toast.error(result.error || "删除失败");
    }
  }

  if (!providerId) {
    return <div className="text-sm text-muted-foreground">保存供应商后可管理成本规则</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {loading ? "加载中..." : `共 ${rules.length} 条规则`}
        </div>
        <Button size="sm" variant="outline" disabled>
          <Plus className="h-4 w-4 mr-1" />
          添加规则(开发中)
        </Button>
      </div>

      {rules.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground border rounded-md">暂无成本规则</div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <Card key={rule.id}>
              <CardHeader className="py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {rule.ruleType === "model" ? (
                      <Badge variant="secondary">
                        <Tag className="h-3 w-3 mr-1" />
                        模型
                      </Badge>
                    ) : (
                      <Badge variant="secondary">
                        <Clock className="h-3 w-3 mr-1" />
                        时段
                      </Badge>
                    )}
                    <span className="font-medium">{rule.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={rule.isEnabled}
                      onCheckedChange={(checked) => handleToggle(rule.id, checked)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(rule.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="py-2">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">倍率:</span>
                    <span className="ml-2 font-mono">{rule.multiplier}x</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">优先级:</span>
                    <span className="ml-2">{rule.priority}</span>
                  </div>
                  {rule.ruleType === "model" && rule.modelPattern && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">匹配模式:</span>
                      <code className="ml-2 bg-muted px-1 rounded">{rule.modelPattern}</code>
                    </div>
                  )}
                  {rule.ruleType === "time_period" && rule.timePeriods && (
                    <div className="col-span-2">
                      <span className="text-muted-foreground">时间段:</span>
                      <div className="ml-2 flex flex-wrap gap-1">
                        {rule.timePeriods.map((period, idx) => (
                          <Badge key={idx} variant="outline">
                            {period.startTime} - {period.endTime}
                            {period.weekdays?.length ? ` (周${period.weekdays.join(",")})` : ""}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
