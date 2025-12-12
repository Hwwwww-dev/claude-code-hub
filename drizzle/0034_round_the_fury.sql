CREATE TYPE "public"."endpoint_selection_strategy" AS ENUM('failover', 'round_robin', 'random', 'weighted');--> statement-breakpoint
CREATE TABLE "provider_endpoints" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"url" varchar(512) NOT NULL,
	"api_key" varchar(512),
	"priority" integer DEFAULT 0 NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"health_status" varchar(20) DEFAULT 'healthy',
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_failure_time" timestamp with time zone,
	"last_success_time" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "endpoint_selection_strategy" "endpoint_selection_strategy" DEFAULT 'failover' NOT NULL;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "use_multiple_endpoints" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "provider_endpoints" ADD CONSTRAINT "provider_endpoints_provider_id_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_provider_endpoints_provider_priority" ON "provider_endpoints" USING btree ("provider_id","is_enabled","priority");--> statement-breakpoint
CREATE INDEX "idx_provider_endpoints_health" ON "provider_endpoints" USING btree ("provider_id","health_status");--> statement-breakpoint
CREATE INDEX "idx_provider_endpoints_provider_id" ON "provider_endpoints" USING btree ("provider_id");