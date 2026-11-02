CREATE TYPE "public"."appointment_status" AS ENUM('booked', 'confirmed', 'checked_in', 'in_room', 'completed', 'cancelled', 'no_show', 'rescheduled');--> statement-breakpoint
CREATE TYPE "public"."follow_up_status" AS ENUM('awaiting', 'booked', 'declined', 'done');--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"dentist_id" uuid NOT NULL,
	"room_id" uuid,
	"room_auto" boolean DEFAULT false NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "appointment_status" DEFAULT 'booked' NOT NULL,
	"reason" text NOT NULL,
	"visit_type" text,
	"plan_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"follow_up_id" uuid,
	"source_visit_id" uuid,
	"lineage_id" uuid NOT NULL,
	"overridden" text[] DEFAULT '{}'::text[] NOT NULL,
	"booked_by" uuid NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"checked_in_by" uuid,
	"checked_in_at" timestamp with time zone,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"cancel_reason" text,
	"idempotency_key" uuid,
	"idempotency_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_range" CHECK ("appointments"."ends_at" > "appointments"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "branch_opening_hours" (
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"is_open" boolean NOT NULL,
	"from_time" time NOT NULL,
	"to_time" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_opening_hours_branch_id_weekday_pk" PRIMARY KEY("branch_id","weekday"),
	CONSTRAINT "branch_opening_hours_weekday" CHECK ("branch_opening_hours"."weekday" between 0 and 6),
	CONSTRAINT "branch_opening_hours_range" CHECK (not "branch_opening_hours"."is_open" or "branch_opening_hours"."from_time" < "branch_opening_hours"."to_time")
);
--> statement-breakpoint
ALTER TABLE "branch_opening_hours" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "follow_ups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"source_visit_id" uuid NOT NULL,
	"source_visit_number" integer NOT NULL,
	"recommended_by" uuid NOT NULL,
	"preferred_dentist_id" uuid,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"plan_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"priority" text,
	"session_number" smallint,
	"session_total" smallint,
	"duration_min" integer NOT NULL,
	"timing" text NOT NULL,
	"custom_date" date,
	"visit_date" date NOT NULL,
	"due_on" date,
	"window_from" date NOT NULL,
	"note" text,
	"clinical_prep" text,
	"status" "follow_up_status" DEFAULT 'awaiting' NOT NULL,
	"will_call_by" uuid,
	"will_call_at" timestamp with time zone,
	"declined_by" uuid,
	"declined_at" timestamp with time zone,
	"declined_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "follow_ups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "scheduling_settings" (
	"tenant_id" uuid PRIMARY KEY DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"follow_up_window_days" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduling_settings_window" CHECK ("scheduling_settings"."follow_up_window_days" between 1 and 365)
);
--> statement-breakpoint
ALTER TABLE "scheduling_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "appointment_id" uuid;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "registration_incomplete" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "appointments_tenant_idx" ON "appointments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "appointments_branch_starts_idx" ON "appointments" USING btree ("tenant_id","branch_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_dentist_starts_idx" ON "appointments" USING btree ("tenant_id","dentist_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_patient_starts_idx" ON "appointments" USING btree ("tenant_id","patient_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_lineage_idx" ON "appointments" USING btree ("tenant_id","lineage_id");--> statement-breakpoint
CREATE INDEX "appointments_source_visit_idx" ON "appointments" USING btree ("tenant_id","source_visit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_idempotency_key_unique" ON "appointments" USING btree ("tenant_id","idempotency_key") WHERE "appointments"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_follow_up_active_unique" ON "appointments" USING btree ("tenant_id","follow_up_id") WHERE "appointments"."follow_up_id" is not null and "appointments"."status" in ('booked', 'confirmed', 'checked_in', 'in_room');--> statement-breakpoint
CREATE INDEX "branch_opening_hours_tenant_idx" ON "branch_opening_hours" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "follow_ups_tenant_idx" ON "follow_ups" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "follow_ups_status_due_idx" ON "follow_ups" USING btree ("tenant_id","status","due_on");--> statement-breakpoint
CREATE INDEX "follow_ups_patient_idx" ON "follow_ups" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "follow_ups_source_visit_unique" ON "follow_ups" USING btree ("tenant_id","source_visit_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "appointments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "branch_opening_hours" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "follow_ups" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "scheduling_settings" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
-- A room and a patient are never in two places: refused by the database, so a race answers like any
-- other conflict (ADR-0067). A dentist's overlap and the opening hours are warnings, checked in code.
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_room_no_overlap" EXCLUDE USING gist ("tenant_id" WITH =, "room_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&) WHERE ("status" IN ('booked', 'confirmed', 'checked_in', 'in_room') AND "room_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_no_overlap" EXCLUDE USING gist ("tenant_id" WITH =, "patient_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&) WHERE ("status" IN ('booked', 'confirmed', 'checked_in', 'in_room'));--> statement-breakpoint
-- Every branch opens Monday to Saturday, 08:00 to 18:00 (ADR-0068). Runs as the schema owner: every
-- tenant's rows. A branch created later is seeded on `BranchCreated`.
INSERT INTO "branch_opening_hours" ("tenant_id", "branch_id", "weekday", "is_open", "from_time", "to_time")
SELECT "branches"."tenant_id", "branches"."id", "days"."weekday", "days"."weekday" <> 0, '08:00', '18:00'
FROM "branches"
CROSS JOIN generate_series(0, 6) AS "days" ("weekday")
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- The appointment permissions (A3, G5): only adds, to every clinic's system roles and to the platform
-- defaults. Stored rows are the closure of `implies`, which applies at write time only.
INSERT INTO "role_template_permissions" ("template_id", "permission")
SELECT "role_templates"."id", "grants"."permission"
FROM "role_templates"
JOIN (VALUES
  ('owner', 'appointment:read'),
  ('owner', 'appointment:write'),
  ('owner', 'appointment:write_all'),
  ('owner', 'appointment:override'),
  ('admin', 'appointment:read'),
  ('admin', 'appointment:write'),
  ('admin', 'appointment:write_all'),
  ('admin', 'appointment:override'),
  ('dentist', 'appointment:read'),
  ('dentist', 'appointment:write'),
  ('assistant', 'appointment:read'),
  ('assistant', 'appointment:write'),
  ('assistant', 'appointment:write_all'),
  ('frontdesk', 'appointment:read'),
  ('frontdesk', 'appointment:write'),
  ('frontdesk', 'appointment:write_all'),
  ('frontdesk', 'appointment:override')
) AS "grants" ("key", "permission") ON "grants"."key" = "role_templates"."key"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("tenant_id", "role_id", "permission")
SELECT "roles"."tenant_id", "roles"."id", "grants"."permission"
FROM "roles"
JOIN (VALUES
  ('owner', 'appointment:read'),
  ('owner', 'appointment:write'),
  ('owner', 'appointment:write_all'),
  ('owner', 'appointment:override'),
  ('admin', 'appointment:read'),
  ('admin', 'appointment:write'),
  ('admin', 'appointment:write_all'),
  ('admin', 'appointment:override'),
  ('dentist', 'appointment:read'),
  ('dentist', 'appointment:write'),
  ('assistant', 'appointment:read'),
  ('assistant', 'appointment:write'),
  ('assistant', 'appointment:write_all'),
  ('frontdesk', 'appointment:read'),
  ('frontdesk', 'appointment:write'),
  ('frontdesk', 'appointment:write_all'),
  ('frontdesk', 'appointment:override')
) AS "grants" ("key", "permission") ON "grants"."key" = "roles"."key"
ON CONFLICT DO NOTHING;
