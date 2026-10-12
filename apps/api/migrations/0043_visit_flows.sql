CREATE TYPE "public"."pain_since" AS ENUM('today', 'days_1_3', 'about_a_week', 'longer');--> statement-breakpoint
CREATE TYPE "public"."plan_priority" AS ENUM('urgent', 'high', 'elective');--> statement-breakpoint
CREATE TYPE "public"."visit_type" AS ENUM('examination', 'emergency', 'treatment', 'hygiene', 'consultation');--> statement-breakpoint
CREATE TYPE "public"."visit_view_mode" AS ENUM('steps', 'all');--> statement-breakpoint
CREATE TABLE "visit_plan_items" (
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"skipped_at" timestamp with time zone,
	"added_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visit_plan_items_pk" PRIMARY KEY("visit_id","plan_id")
);
--> statement-breakpoint
ALTER TABLE "visit_plan_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "patient_diagnoses" ADD COLUMN "seen_on" text;--> statement-breakpoint
ALTER TABLE "patient_diagnoses" ADD COLUMN "seen_on_file_id" uuid;--> statement-breakpoint
ALTER TABLE "procedures" ADD COLUMN "added_on_visit_type" text;--> statement-breakpoint
ALTER TABLE "procedures" ADD COLUMN "typical_sessions" smallint;--> statement-breakpoint
-- Plans made before priorities existed join the last phase (spec D33); new ones always say.
ALTER TABLE "treatment_plans" ADD COLUMN "priority" "plan_priority" DEFAULT 'elective' NOT NULL;--> statement-breakpoint
ALTER TABLE "treatment_plans" ALTER COLUMN "priority" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD COLUMN "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD COLUMN "accepted_by" uuid;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD COLUMN "estimated_sessions" smallint;--> statement-breakpoint
ALTER TABLE "visit_services" ADD COLUMN "auto_added" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Visits from before the flows are treatment visits (spec D33): finished ones on Complete, live
-- ones on their first step.
ALTER TABLE "visits" ADD COLUMN "type" "visit_type" DEFAULT 'treatment' NOT NULL;--> statement-breakpoint
ALTER TABLE "visits" ALTER COLUMN "type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "current_step" text DEFAULT 'complete' NOT NULL;--> statement-breakpoint
UPDATE "visits" SET "current_step" = 'today' WHERE "status"::text IN ('in_progress', 'paused');--> statement-breakpoint
ALTER TABLE "visits" ALTER COLUMN "current_step" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "view_mode" "visit_view_mode" DEFAULT 'steps' NOT NULL;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "pain_score" smallint;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "pain_since" "pain_since";--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "history_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "history_confirmed_by" uuid;--> statement-breakpoint
ALTER TABLE "visit_plan_items" ADD CONSTRAINT "visit_plan_items_visit_fk" FOREIGN KEY ("tenant_id","visit_id") REFERENCES "public"."visits"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_plan_items" ADD CONSTRAINT "visit_plan_items_plan_fk" FOREIGN KEY ("tenant_id","plan_id") REFERENCES "public"."treatment_plans"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visit_plan_items_tenant_idx" ON "visit_plan_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "visit_plan_items_plan_idx" ON "visit_plan_items" USING btree ("tenant_id","plan_id");--> statement-breakpoint
CREATE INDEX "patient_diagnoses_seen_on_file_idx" ON "patient_diagnoses" USING btree ("tenant_id","patient_id","seen_on_file_id") WHERE "patient_diagnoses"."seen_on_file_id" is not null;--> statement-breakpoint
ALTER TABLE "patient_diagnoses" ADD CONSTRAINT "patient_diagnoses_seen_on_known" CHECK ("patient_diagnoses"."seen_on" in ('clinical_exam', 'image'));--> statement-breakpoint
ALTER TABLE "patient_diagnoses" ADD CONSTRAINT "patient_diagnoses_seen_on_file" CHECK (("patient_diagnoses"."seen_on_file_id" is not null) = ("patient_diagnoses"."seen_on" is not distinct from 'image'));--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_added_on_known" CHECK ("procedures"."added_on_visit_type" in ('examination', 'emergency', 'hygiene', 'consultation'));--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_added_on_per_mouth" CHECK ("procedures"."added_on_visit_type" is null or "procedures"."charge_unit"::text = 'per_mouth');--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_typical_sessions_range" CHECK ("procedures"."typical_sessions" between 2 and 20);--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_accepted_fields" CHECK (("treatment_plans"."accepted_at" is null) = ("treatment_plans"."accepted_by" is null));--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_estimated_sessions_positive" CHECK ("treatment_plans"."estimated_sessions" >= 1);--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_current_step_known" CHECK ("visits"."current_step" in ('intake', 'complaint', 'examine', 'findings', 'plan', 'today', 'perform', 'complete'));--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_reason_length" CHECK (char_length("visits"."reason") between 1 and 500);--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_pain_score_range" CHECK ("visits"."pain_score" between 0 and 10);--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_pain_emergency_only" CHECK (("visits"."pain_score" is null and "visits"."pain_since" is null) or "visits"."type"::text = 'emergency');--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_history_confirmed_fields" CHECK (("visits"."history_confirmed_at" is null) = ("visits"."history_confirmed_by" is null));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "visit_plan_items" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);