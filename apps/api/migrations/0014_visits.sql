CREATE TYPE "public"."diagnosis_status" AS ENUM('active', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."discount_mode" AS ENUM('percent', 'amount');--> statement-breakpoint
CREATE TYPE "public"."plan_status" AS ENUM('planned', 'performed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."tooth_presence" AS ENUM('primary', 'permanent');--> statement-breakpoint
CREATE TYPE "public"."visit_status" AS ENUM('in_progress', 'paused', 'completed', 'discarded');--> statement-breakpoint
CREATE TABLE "patient_diagnoses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"tooth_code" text NOT NULL,
	"surfaces" text[] DEFAULT '{}'::text[] NOT NULL,
	"diagnosis_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"status" "diagnosis_status" DEFAULT 'active' NOT NULL,
	"note" text,
	"dentist_id" uuid NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_in_visit_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"resolved_in_visit_id" uuid,
	"resolved_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_diagnoses_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "patient_diagnoses_tooth_code_format" CHECK ("patient_diagnoses"."tooth_code" ~ '^([1-4][1-8]|[5-8][1-5])$'),
	CONSTRAINT "patient_diagnoses_surfaces_valid" CHECK ("patient_diagnoses"."surfaces" <@ ARRAY['M', 'D', 'B', 'L', 'O', 'I']::text[]),
	CONSTRAINT "patient_diagnoses_resolved_fields" CHECK (case when "patient_diagnoses"."status" = 'resolved' then "patient_diagnoses"."resolved_in_visit_id" is not null and "patient_diagnoses"."resolved_at" is not null else "patient_diagnoses"."resolved_in_visit_id" is null and "patient_diagnoses"."resolved_at" is null end)
);
--> statement-breakpoint
ALTER TABLE "patient_diagnoses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tooth_status" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"position" text NOT NULL,
	"present" "tooth_presence" NOT NULL,
	"changed_in_visit_id" uuid NOT NULL,
	"changed_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tooth_status_position_format" CHECK ("tooth_status"."position" ~ '^[1-4][1-5]$')
);
--> statement-breakpoint
ALTER TABLE "tooth_status" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "treatment_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"tooth_code" text,
	"surfaces" text[] DEFAULT '{}'::text[] NOT NULL,
	"procedure_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"charge_unit" charge_unit NOT NULL,
	"price_amount" numeric(12, 2) NOT NULL,
	"price_currency" char(3) NOT NULL,
	"diagnosis_record_id" uuid,
	"status" "plan_status" DEFAULT 'planned' NOT NULL,
	"note" text,
	"dentist_id" uuid NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_in_visit_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"performed_in_visit_id" uuid,
	"performed_at" timestamp with time zone,
	"cancelled_in_visit_id" uuid,
	"cancelled_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treatment_plans_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "treatment_plans_tooth_code_format" CHECK ("treatment_plans"."tooth_code" ~ '^([1-4][1-8]|[5-8][1-5])$'),
	CONSTRAINT "treatment_plans_surfaces_valid" CHECK ("treatment_plans"."surfaces" <@ ARRAY['M', 'D', 'B', 'L', 'O', 'I']::text[]),
	CONSTRAINT "treatment_plans_tooth_matches_unit" CHECK (("treatment_plans"."tooth_code" is not null) = ("treatment_plans"."charge_unit" = 'per_tooth')),
	CONSTRAINT "treatment_plans_price_non_negative" CHECK ("treatment_plans"."price_amount" >= 0),
	CONSTRAINT "treatment_plans_performed_fields" CHECK (case when "treatment_plans"."status" = 'performed' then "treatment_plans"."performed_in_visit_id" is not null and "treatment_plans"."performed_at" is not null else "treatment_plans"."performed_in_visit_id" is null and "treatment_plans"."performed_at" is null end),
	CONSTRAINT "treatment_plans_cancelled_fields" CHECK (case when "treatment_plans"."status" = 'cancelled' then "treatment_plans"."cancelled_in_visit_id" is not null and "treatment_plans"."cancelled_at" is not null else "treatment_plans"."cancelled_in_visit_id" is null and "treatment_plans"."cancelled_at" is null end)
);
--> statement-breakpoint
ALTER TABLE "treatment_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "visit_services" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"procedure_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"charge_unit" charge_unit NOT NULL,
	"tooth_code" text,
	"surfaces" text[] DEFAULT '{}'::text[] NOT NULL,
	"base_amount" numeric(12, 2) NOT NULL,
	"discount_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"plan_id" uuid,
	"recorded_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visit_services_tooth_code_format" CHECK ("visit_services"."tooth_code" ~ '^([1-4][1-8]|[5-8][1-5])$'),
	CONSTRAINT "visit_services_surfaces_valid" CHECK ("visit_services"."surfaces" <@ ARRAY['M', 'D', 'B', 'L', 'O', 'I']::text[]),
	CONSTRAINT "visit_services_tooth_matches_unit" CHECK (("visit_services"."tooth_code" is not null) = ("visit_services"."charge_unit" = 'per_tooth')),
	CONSTRAINT "visit_services_discount_within_base" CHECK ("visit_services"."discount_amount" >= 0 and "visit_services"."discount_amount" <= "visit_services"."base_amount")
);
--> statement-breakpoint
ALTER TABLE "visit_services" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"room_id" uuid,
	"dentist_id" uuid NOT NULL,
	"started_by" uuid NOT NULL,
	"status" "visit_status" DEFAULT 'in_progress' NOT NULL,
	"local_date" date NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"paused_at" timestamp with time zone,
	"paused_seconds" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"discarded_at" timestamp with time zone,
	"discarded_by" uuid,
	"duration_minutes" integer,
	"notes" text DEFAULT '' NOT NULL,
	"discount_mode" "discount_mode" DEFAULT 'percent' NOT NULL,
	"discount_value" numeric(12, 2) DEFAULT '0' NOT NULL,
	"currency" char(3) NOT NULL,
	"subtotal" numeric(12, 2),
	"discount_amount" numeric(12, 2),
	"total" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visits_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "visits_paused_seconds_non_negative" CHECK ("visits"."paused_seconds" >= 0),
	CONSTRAINT "visits_discount_value_non_negative" CHECK ("visits"."discount_value" >= 0),
	CONSTRAINT "visits_paused_consistent" CHECK (("visits"."paused_at" is not null) = ("visits"."status" = 'paused')),
	CONSTRAINT "visits_completed_fields" CHECK ("visits"."status" <> 'completed' or ("visits"."completed_at" is not null and "visits"."completed_by" is not null and "visits"."duration_minutes" is not null and "visits"."subtotal" is not null and "visits"."discount_amount" is not null and "visits"."total" is not null)),
	CONSTRAINT "visits_discarded_fields" CHECK ("visits"."status" <> 'discarded' or ("visits"."discarded_at" is not null and "visits"."discarded_by" is not null)),
	CONSTRAINT "visits_duration_positive" CHECK ("visits"."duration_minutes" is null or "visits"."duration_minutes" >= 1),
	CONSTRAINT "visits_money_consistent" CHECK ("visits"."total" is null or ("visits"."subtotal" >= 0 and "visits"."discount_amount" >= 0 and "visits"."discount_amount" <= "visits"."subtotal" and "visits"."total" = "visits"."subtotal" - "visits"."discount_amount"))
);
--> statement-breakpoint
ALTER TABLE "visits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Hand-moved above the composite foreign keys that need them (drizzle-kit emits them last).
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_tenant_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_tenant_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "patient_diagnoses" ADD CONSTRAINT "patient_diagnoses_diagnosis_fk" FOREIGN KEY ("tenant_id","diagnosis_id") REFERENCES "public"."diagnoses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_diagnoses" ADD CONSTRAINT "patient_diagnoses_recorded_visit_fk" FOREIGN KEY ("tenant_id","recorded_in_visit_id") REFERENCES "public"."visits"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_diagnoses" ADD CONSTRAINT "patient_diagnoses_resolved_visit_fk" FOREIGN KEY ("tenant_id","resolved_in_visit_id") REFERENCES "public"."visits"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tooth_status" ADD CONSTRAINT "tooth_status_changed_visit_fk" FOREIGN KEY ("tenant_id","changed_in_visit_id") REFERENCES "public"."visits"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_procedure_fk" FOREIGN KEY ("tenant_id","procedure_id") REFERENCES "public"."procedures"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_diagnosis_record_fk" FOREIGN KEY ("tenant_id","diagnosis_record_id") REFERENCES "public"."patient_diagnoses"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_recorded_visit_fk" FOREIGN KEY ("tenant_id","recorded_in_visit_id") REFERENCES "public"."visits"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_performed_visit_fk" FOREIGN KEY ("tenant_id","performed_in_visit_id") REFERENCES "public"."visits"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_cancelled_visit_fk" FOREIGN KEY ("tenant_id","cancelled_in_visit_id") REFERENCES "public"."visits"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_services" ADD CONSTRAINT "visit_services_visit_fk" FOREIGN KEY ("tenant_id","visit_id") REFERENCES "public"."visits"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_services" ADD CONSTRAINT "visit_services_procedure_fk" FOREIGN KEY ("tenant_id","procedure_id") REFERENCES "public"."procedures"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_services" ADD CONSTRAINT "visit_services_plan_fk" FOREIGN KEY ("tenant_id","plan_id") REFERENCES "public"."treatment_plans"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "patient_diagnoses_tenant_idx" ON "patient_diagnoses" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "patient_diagnoses_patient_tooth_idx" ON "patient_diagnoses" USING btree ("tenant_id","patient_id","tooth_code");--> statement-breakpoint
CREATE INDEX "tooth_status_tenant_idx" ON "tooth_status" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tooth_status_position_unique" ON "tooth_status" USING btree ("tenant_id","patient_id","position");--> statement-breakpoint
CREATE INDEX "treatment_plans_tenant_idx" ON "treatment_plans" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "treatment_plans_patient_tooth_idx" ON "treatment_plans" USING btree ("tenant_id","patient_id","tooth_code");--> statement-breakpoint
CREATE INDEX "visit_services_tenant_idx" ON "visit_services" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "visit_services_visit_idx" ON "visit_services" USING btree ("tenant_id","visit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "visit_services_plan_unique" ON "visit_services" USING btree ("tenant_id","plan_id") WHERE "visit_services"."deleted_at" is null and "visit_services"."plan_id" is not null;--> statement-breakpoint
CREATE INDEX "visits_tenant_idx" ON "visits" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "visits_room_live_unique" ON "visits" USING btree ("tenant_id","room_id") WHERE "visits"."status" in ('in_progress', 'paused') and "visits"."room_id" is not null;--> statement-breakpoint
CREATE INDEX "visits_patient_started_idx" ON "visits" USING btree ("tenant_id","patient_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "visits_live_idx" ON "visits" USING btree ("tenant_id","status") WHERE "visits"."status" in ('in_progress', 'paused');--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "patient_diagnoses" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tooth_status" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "treatment_plans" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "visit_services" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "visits" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);