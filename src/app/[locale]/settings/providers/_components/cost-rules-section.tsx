"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CostMultiplierStrategy } from "@/types/cost-rules";
import { CostRulesEditor } from "./cost-rules-editor";

interface CostRulesSectionProps {
  providerId?: number;
  costMultiplierStrategy: CostMultiplierStrategy;
  onStrategyChange: (strategy: CostMultiplierStrategy) => void;
  timezone: string;
  onTimezoneChange: (tz: string) => void;
}

export function CostRulesSection({
  providerId,
  costMultiplierStrategy,
  onStrategyChange,
  timezone,
  onTimezoneChange,
}: CostRulesSectionProps) {
  return (
    <div className="space-y-4">
      {/* 倍率叠加策略 */}
      <div className="space-y-2">
        <Label>倍率叠加策略</Label>
        <Select
          value={costMultiplierStrategy}
          onValueChange={(val) => onStrategyChange(val as CostMultiplierStrategy)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="highest_priority">
              <div className="space-y-0.5">
                <div className="font-medium">单选最高优先级</div>
                <div className="text-xs text-muted-foreground">仅应用优先级最高的规则</div>
              </div>
            </SelectItem>
            <SelectItem value="multiply">
              <div className="space-y-0.5">
                <div className="font-medium">多倍率相乘</div>
                <div className="text-xs text-muted-foreground">所有匹配规则的倍率相乘</div>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 时区配置 */}
      <div className="space-y-2">
        <Label>时区配置</Label>
        <Select value={timezone} onValueChange={onTimezoneChange}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="UTC">UTC (协调世界时)</SelectItem>
            <SelectItem value="Asia/Shanghai">Asia/Shanghai (北京时间)</SelectItem>
            <SelectItem value="America/New_York">America/New_York (美东时间)</SelectItem>
            <SelectItem value="Europe/London">Europe/London (伦敦时间)</SelectItem>
            <SelectItem value="Asia/Tokyo">Asia/Tokyo (东京时间)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">用于计算时段级倍率的生效时间</p>
      </div>

      {/* 规则管理 */}
      <div className="space-y-2">
        <Label>成本规则</Label>
        <CostRulesEditor providerId={providerId} />
      </div>

      {/* 提示信息 */}
      {!providerId && (
        <div className="rounded-md bg-muted p-3 text-sm">
          <p className="text-muted-foreground">💡 保存供应商后可管理成本规则</p>
        </div>
      )}
    </div>
  );
}
