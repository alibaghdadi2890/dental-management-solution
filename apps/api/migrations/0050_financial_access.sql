CREATE TABLE "user_permission_grants" (
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"granted_by" uuid NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_permission_grants_pk" PRIMARY KEY("tenant_id","user_id","permission")
);
--> statement-breakpoint
ALTER TABLE "user_permission_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
CREATE INDEX "user_permission_grants_tenant_idx" ON "user_permission_grants" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "visits_dentist_idx" ON "visits" USING btree ("tenant_id","dentist_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "user_permission_grants" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
-- The default permission matrix of feature 13a (ADR-0055): dentists lose payments, discounts and
-- other dentists' visits; front desk loses discounts; the assistant loses payment:read. Runs as
-- the schema owner: every tenant's rows. Only the system roles' grants are rewritten; custom
-- roles and user roles are untouched. Idempotent.
-- THE LAST FULL REWRITE: from now on clinics edit their system roles, so a migration only adds
-- new permissions to them (ON CONFLICT DO NOTHING), never removes one.
DELETE FROM "role_permissions"
USING "roles"
WHERE "role_permissions"."role_id" = "roles"."id" AND "roles"."system";
--> statement-breakpoint
INSERT INTO "role_permissions" ("tenant_id", "role_id", "permission")
SELECT "roles"."tenant_id", "roles"."id", "grants"."permission"
FROM "roles"
JOIN (VALUES
  ('owner', 'tenant:read'),
  ('owner', 'tenant:write'),
  ('owner', 'user:read'),
  ('owner', 'user:write'),
  ('owner', 'role:read'),
  ('owner', 'role:write'),
  ('owner', 'patient:read'),
  ('owner', 'patient:write'),
  ('owner', 'visit:read'),
  ('owner', 'visit:read_all'),
  ('owner', 'visit:write'),
  ('owner', 'visit:void'),
  ('owner', 'visit:amend'),
  ('owner', 'visit:discount'),
  ('owner', 'chart:write'),
  ('owner', 'catalog:read'),
  ('owner', 'catalog:write'),
  ('owner', 'payment:read'),
  ('owner', 'payment:write'),
  ('owner', 'payment:refund'),
  ('owner', 'finance:read'),
  ('owner', 'import:run'),
  ('owner', 'file:read'),
  ('owner', 'file:write'),
  ('owner', 'file:archive'),
  ('owner', 'audit:read'),
  ('owner', 'compensation:read'),
  ('owner', 'compensation:manage'),
  ('dentist', 'tenant:read'),
  ('dentist', 'user:read'),
  ('dentist', 'catalog:read'),
  ('dentist', 'patient:read'),
  ('dentist', 'patient:write'),
  ('dentist', 'visit:read'),
  ('dentist', 'file:read'),
  ('dentist', 'file:write'),
  ('dentist', 'visit:write'),
  ('dentist', 'visit:void'),
  ('dentist', 'visit:amend'),
  ('dentist', 'chart:write'),
  ('dentist', 'file:archive'),
  ('dentist', 'audit:read'),
  ('dentist', 'compensation:read'),
  ('assistant', 'tenant:read'),
  ('assistant', 'user:read'),
  ('assistant', 'catalog:read'),
  ('assistant', 'patient:read'),
  ('assistant', 'patient:write'),
  ('assistant', 'visit:read'),
  ('assistant', 'file:read'),
  ('assistant', 'file:write'),
  ('assistant', 'visit:read_all'),
  ('assistant', 'visit:write'),
  ('frontdesk', 'tenant:read'),
  ('frontdesk', 'user:read'),
  ('frontdesk', 'catalog:read'),
  ('frontdesk', 'patient:read'),
  ('frontdesk', 'patient:write'),
  ('frontdesk', 'visit:read'),
  ('frontdesk', 'file:read'),
  ('frontdesk', 'file:write'),
  ('frontdesk', 'visit:read_all'),
  ('frontdesk', 'payment:read'),
  ('frontdesk', 'payment:write')
) AS "grants" ("key", "permission") ON "grants"."key" = "roles"."key"
WHERE "roles"."system"
ON CONFLICT DO NOTHING;
