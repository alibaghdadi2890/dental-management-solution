-- The Admin system role (ADR-0061): every clinic has it, held by nobody until the clinic assigns
-- it, and it starts with every grantable permission (as data the clinic may narrow; it stays
-- below the owner). Its platform default too (role_templates, ADR-0056). Runs as the schema
-- owner: every tenant's rows. Only adds; idempotent.
-- From now on a migration that adds a permission adds it to the admin role and template as well.
INSERT INTO "role_templates" ("id", "key", "name", "system")
VALUES (gen_random_uuid(), 'admin', 'Admin', true)
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_template_permissions" ("template_id", "permission")
SELECT "role_templates"."id", "grants"."permission"
FROM "role_templates"
CROSS JOIN (VALUES
  ('tenant:read'),
  ('tenant:write'),
  ('user:read'),
  ('user:write'),
  ('role:read'),
  ('role:write'),
  ('patient:read'),
  ('patient:write'),
  ('visit:read'),
  ('visit:read_all'),
  ('visit:write'),
  ('visit:void'),
  ('visit:amend'),
  ('visit:discount'),
  ('chart:write'),
  ('catalog:read'),
  ('catalog:write'),
  ('payment:read'),
  ('payment:write'),
  ('payment:refund'),
  ('finance:read'),
  ('import:run'),
  ('file:read'),
  ('file:write'),
  ('file:archive'),
  ('audit:read'),
  ('compensation:read'),
  ('compensation:manage')
) AS "grants" ("permission")
WHERE "role_templates"."key" = 'admin'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "roles" ("id", "tenant_id", "key", "name", "system")
SELECT gen_random_uuid(), "tenants"."id", 'admin', 'Admin', true
FROM "tenants"
ON CONFLICT ("tenant_id", "key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("tenant_id", "role_id", "permission")
SELECT "roles"."tenant_id", "roles"."id", "grants"."permission"
FROM "roles"
CROSS JOIN (VALUES
  ('tenant:read'),
  ('tenant:write'),
  ('user:read'),
  ('user:write'),
  ('role:read'),
  ('role:write'),
  ('patient:read'),
  ('patient:write'),
  ('visit:read'),
  ('visit:read_all'),
  ('visit:write'),
  ('visit:void'),
  ('visit:amend'),
  ('visit:discount'),
  ('chart:write'),
  ('catalog:read'),
  ('catalog:write'),
  ('payment:read'),
  ('payment:write'),
  ('payment:refund'),
  ('finance:read'),
  ('import:run'),
  ('file:read'),
  ('file:write'),
  ('file:archive'),
  ('audit:read'),
  ('compensation:read'),
  ('compensation:manage')
) AS "grants" ("permission")
WHERE "roles"."key" = 'admin' AND "roles"."system"
ON CONFLICT DO NOTHING;
