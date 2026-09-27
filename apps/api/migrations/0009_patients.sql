CREATE TYPE "public"."patient_sex" AS ENUM('female', 'male', 'other', 'unknown');--> statement-breakpoint
CREATE TABLE "patient_counters" (
	"tenant_id" uuid PRIMARY KEY DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"last_value" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "patient_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"display_number" text NOT NULL,
	"full_name" text NOT NULL,
	"name_key" text NOT NULL,
	"phone" text NOT NULL,
	"phone_search" text NOT NULL,
	"date_of_birth" date,
	"sex" "patient_sex" DEFAULT 'unknown' NOT NULL,
	"email" text,
	"address" text,
	"insurance" text,
	"emergency_contact" text,
	"notes" text,
	"medical_alerts" text[] DEFAULT '{}'::text[] NOT NULL,
	"primary_dentist_user_id" uuid,
	"guardian_name" text,
	"guardian_phone" text,
	"external_id" text,
	"merged_into_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "patients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "patients_tenant_idx" ON "patients" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_display_number_unique" ON "patients" USING btree ("tenant_id","display_number");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_external_id_unique" ON "patients" USING btree ("tenant_id","external_id") WHERE "patients"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "patients_name_key_dob_idx" ON "patients" USING btree ("tenant_id","name_key","date_of_birth") WHERE "patients"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "patients_tenant_updated_idx" ON "patients" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "patient_counters" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "patients" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);