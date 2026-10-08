CREATE TABLE "files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"visit_id" uuid,
	"tooth_code" text,
	"kind" text NOT NULL,
	"category" text,
	"sub_category" text,
	"taken_at" timestamp with time zone,
	"note" text DEFAULT '' NOT NULL,
	"original_filename" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"mime_type" text NOT NULL,
	"storage_key" text NOT NULL,
	"has_preview" boolean DEFAULT false NOT NULL,
	"orientation" smallint DEFAULT 0 NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"saved_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"archive_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "files_tooth_code_format" CHECK ("files"."tooth_code" is null or "files"."tooth_code" ~ '^([1-4][1-8]|[5-8][1-5])$'),
	CONSTRAINT "files_orientation" CHECK ("files"."orientation" in (0, 90, 180, 270)),
	CONSTRAINT "files_saved_fields" CHECK ("files"."saved_at" is null or ("files"."category" is not null and "files"."taken_at" is not null)),
	CONSTRAINT "files_archived_fields" CHECK (("files"."archived_at" is null) = ("files"."archived_by" is null))
);
--> statement-breakpoint
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "files_tenant_idx" ON "files" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "files_patient_taken_idx" ON "files" USING btree ("tenant_id","patient_id","taken_at" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "files" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- file:read / file:write / file:archive (feature 8, F13): the system roles seeded before them get
-- the grants. Runs as the schema owner: every tenant's rows.
INSERT INTO "role_permissions" ("tenant_id", "role_id", "permission")
SELECT "roles"."tenant_id", "roles"."id", "grants"."permission"
FROM "roles"
JOIN (VALUES
  ('owner', 'file:read'), ('owner', 'file:write'), ('owner', 'file:archive'),
  ('dentist', 'file:read'), ('dentist', 'file:write'), ('dentist', 'file:archive'),
  ('assistant', 'file:read'), ('assistant', 'file:write'),
  ('frontdesk', 'file:read'), ('frontdesk', 'file:write')
) AS "grants" ("key", "permission") ON "grants"."key" = "roles"."key"
WHERE "roles"."system"
ON CONFLICT DO NOTHING;
