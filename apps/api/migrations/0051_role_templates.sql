CREATE TABLE "role_template_permissions" (
	"template_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_template_permissions_pk" PRIMARY KEY("template_id","permission")
);
--> statement-breakpoint
CREATE TABLE "role_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"system" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_templates_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "role_template_permissions" ADD CONSTRAINT "role_template_permissions_template_id_role_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."role_templates"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- The platform's default roles (ADR-0056), seeded from the default matrix of ADR-0055. `owner` is
-- no template: it holds every permission by rule.
INSERT INTO "role_templates" ("id", "key", "name", "system")
SELECT gen_random_uuid(), "seed"."key", "seed"."name", true
FROM (VALUES
  ('dentist', 'Dentist'),
  ('assistant', 'Assistant'),
  ('frontdesk', 'Front desk')
) AS "seed" ("key", "name")
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_template_permissions" ("template_id", "permission")
SELECT "role_templates"."id", "grants"."permission"
FROM "role_templates"
JOIN (VALUES
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
) AS "grants" ("key", "permission") ON "grants"."key" = "role_templates"."key"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- Global, so no RLS: every tenant transaction reads them; only withoutTenant() (dcm_admin)
-- writes them.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "role_templates", "role_template_permissions" FROM dcm_app;
