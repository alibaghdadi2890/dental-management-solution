CREATE TYPE "public"."actor_kind" AS ENUM('user', 'agent', 'system', 'job');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"actor_user_id" uuid,
	"actor_kind" "actor_kind" NOT NULL,
	"actor_platform_admin" boolean DEFAULT false NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"request_id" text,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "audit_log_tenant_occurred_idx" ON "audit_log" USING btree ("tenant_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_tenant_resource_idx" ON "audit_log" USING btree ("tenant_id","resource_type","resource_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "audit_log" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- Append-only (CLAUDE.md §10): the runtime roles keep INSERT and SELECT only.
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_log" FROM dcm_app, dcm_admin;