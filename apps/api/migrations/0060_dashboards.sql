CREATE INDEX "treatment_plans_recorded_idx" ON "treatment_plans" USING btree ("tenant_id","recorded_at");--> statement-breakpoint
CREATE INDEX "visits_local_date_idx" ON "visits" USING btree ("tenant_id","local_date");--> statement-breakpoint
CREATE INDEX "appointments_starts_idx" ON "appointments" USING btree ("tenant_id","starts_at");--> statement-breakpoint
-- The two dashboard permissions (ADR-0092): only added, to the owner and the admin of every
-- clinic and to their templates. No other role or grant changes.
INSERT INTO "role_permissions" ("tenant_id", "role_id", "permission")
SELECT "roles"."tenant_id", "roles"."id", "grants"."permission"
FROM "roles"
JOIN (VALUES
  ('owner', 'dashboard:financial'), ('owner', 'dashboard:operational'),
  ('admin', 'dashboard:financial'), ('admin', 'dashboard:operational')
) AS "grants" ("role_key", "permission") ON "grants"."role_key" = "roles"."key"
WHERE "roles"."system"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_template_permissions" ("template_id", "permission")
SELECT "role_templates"."id", "grants"."permission"
FROM "role_templates"
JOIN (VALUES
  ('owner', 'dashboard:financial'), ('owner', 'dashboard:operational'),
  ('admin', 'dashboard:financial'), ('admin', 'dashboard:operational')
) AS "grants" ("role_key", "permission") ON "grants"."role_key" = "role_templates"."key"
ON CONFLICT DO NOTHING;
