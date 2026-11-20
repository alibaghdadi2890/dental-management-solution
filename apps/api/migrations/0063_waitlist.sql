CREATE TYPE "public"."waitlist_status" AS ENUM('waiting', 'booked', 'removed');--> statement-breakpoint
CREATE TABLE "waitlist_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"dentist_id" uuid,
	"reason" text NOT NULL,
	"visit_type" text,
	"duration_min" integer NOT NULL,
	"plan_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"follow_up_id" uuid,
	"until_on" date,
	"weekdays" smallint[] DEFAULT '{}'::smallint[] NOT NULL,
	"between_from" time,
	"between_to" time,
	"not_before" date,
	"same_day" boolean DEFAULT false NOT NULL,
	"urgent" boolean DEFAULT false NOT NULL,
	"note" text,
	"status" "waitlist_status" DEFAULT 'waiting' NOT NULL,
	"attempt_at" timestamp with time zone,
	"attempt_by" uuid,
	"attempt_outcome" text,
	"cancelled_appointment_id" uuid,
	"cancel_created" boolean DEFAULT false NOT NULL,
	"booked_appointment_id" uuid,
	"remove_reason" text,
	"created_by" uuid NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_entries_kind" CHECK (("waitlist_entries"."appointment_id" is null) = ("waitlist_entries"."until_on" is not null)),
	CONSTRAINT "waitlist_entries_between" CHECK (("waitlist_entries"."between_from" is null) = ("waitlist_entries"."between_to" is null) and ("waitlist_entries"."between_from" is null or "waitlist_entries"."between_from" < "waitlist_entries"."between_to")),
	CONSTRAINT "waitlist_entries_duration" CHECK ("waitlist_entries"."duration_min" between 5 and 480)
);
--> statement-breakpoint
ALTER TABLE "waitlist_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "waitlist_left_open" (
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"appointment_id" uuid PRIMARY KEY NOT NULL,
	"left_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "waitlist_left_open" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "waitlist_entry_id" uuid;--> statement-breakpoint
CREATE INDEX "waitlist_entries_tenant_idx" ON "waitlist_entries" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "waitlist_entries_branch_status_idx" ON "waitlist_entries" USING btree ("tenant_id","branch_id","status");--> statement-breakpoint
CREATE INDEX "waitlist_entries_patient_idx" ON "waitlist_entries" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "waitlist_entries_appointment_idx" ON "waitlist_entries" USING btree ("tenant_id","appointment_id");--> statement-breakpoint
CREATE INDEX "waitlist_entries_follow_up_idx" ON "waitlist_entries" USING btree ("tenant_id","follow_up_id");--> statement-breakpoint
CREATE INDEX "waitlist_entries_cancelled_idx" ON "waitlist_entries" USING btree ("tenant_id","cancelled_appointment_id");--> statement-breakpoint
CREATE INDEX "waitlist_left_open_tenant_idx" ON "waitlist_left_open" USING btree ("tenant_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "waitlist_entries" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "waitlist_left_open" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- An entry is never deleted (decision 9): it ends booked or removed, or expires when read.
-- An opening left open stays left open.
REVOKE DELETE, TRUNCATE ON "waitlist_entries" FROM dcm_app, dcm_admin;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "waitlist_left_open" FROM dcm_app, dcm_admin;
