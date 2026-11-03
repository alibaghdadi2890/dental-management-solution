CREATE TABLE "alert_follows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"dentist_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_follows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "alert_follows_tenant_idx" ON "alert_follows" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_follows_user_dentist_key" ON "alert_follows" USING btree ("tenant_id","user_id","dentist_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "alert_follows" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- `visit:start` (feature 15, ADR-0074): only adds. Everyone who runs visits keeps starting them, as
-- `visit:write` now implies it (stored rows are the closure of `implies`): every role, template and
-- personal grant set that holds `visit:write`. The front desk and the admin get it by default.
INSERT INTO "role_permissions" ("tenant_id", "role_id", "permission")
SELECT "role_permissions"."tenant_id", "role_permissions"."role_id", 'visit:start'
FROM "role_permissions"
WHERE "role_permissions"."permission" = 'visit:write'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("tenant_id", "role_id", "permission")
SELECT "roles"."tenant_id", "roles"."id", 'visit:start'
FROM "roles"
WHERE "roles"."system" AND "roles"."key" IN ('owner', 'admin', 'frontdesk')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_template_permissions" ("template_id", "permission")
SELECT "role_template_permissions"."template_id", 'visit:start'
FROM "role_template_permissions"
WHERE "role_template_permissions"."permission" = 'visit:write'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_template_permissions" ("template_id", "permission")
SELECT "role_templates"."id", 'visit:start'
FROM "role_templates"
WHERE "role_templates"."key" IN ('owner', 'admin', 'frontdesk')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "user_permission_grants" ("tenant_id", "user_id", "permission", "granted_by", "reason")
SELECT "tenant_id", "user_id", 'visit:start', "granted_by", "reason"
FROM "user_permission_grants"
WHERE "permission" = 'visit:write'
ON CONFLICT DO NOTHING;
