-- 创建成本规则类型枚举
DO $$ BEGIN
  CREATE TYPE "cost_rule_type" AS ENUM ('model', 'time_period');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 创建倍率叠加策略枚举
DO $$ BEGIN
  CREATE TYPE "cost_multiplier_strategy" AS ENUM ('highest_priority', 'multiply');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 为 providers 表添加新字段
ALTER TABLE "providers"
  ADD COLUMN IF NOT EXISTS "cost_multiplier_strategy" "cost_multiplier_strategy" NOT NULL DEFAULT 'highest_priority',
  ADD COLUMN IF NOT EXISTS "timezone" VARCHAR(50) DEFAULT 'UTC';

-- 创建供应商成本规则表
CREATE TABLE IF NOT EXISTS "provider_cost_rules" (
  "id" SERIAL PRIMARY KEY,
  "provider_id" INTEGER NOT NULL REFERENCES "providers"("id") ON DELETE CASCADE,
  "rule_type" "cost_rule_type" NOT NULL,
  "name" VARCHAR(100) NOT NULL,
  "multiplier" NUMERIC(10, 4) NOT NULL CHECK (multiplier > 0 AND multiplier <= 100),
  "priority" INTEGER NOT NULL DEFAULT 0,
  "model_pattern" VARCHAR(200),
  "time_periods" JSONB,
  "is_enabled" BOOLEAN NOT NULL DEFAULT true,
  "description" TEXT,
  "created_at" TIMESTAMPTZ DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ DEFAULT NOW()
);

-- 创建索引
CREATE INDEX IF NOT EXISTS "idx_provider_cost_rules_provider_type"
  ON "provider_cost_rules" ("provider_id", "rule_type");
CREATE INDEX IF NOT EXISTS "idx_provider_cost_rules_enabled"
  ON "provider_cost_rules" ("is_enabled");
