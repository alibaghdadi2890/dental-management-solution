CREATE TYPE "public"."medical_option_kind" AS ENUM('allergy', 'condition');--> statement-breakpoint
CREATE TABLE "medical_history_options" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"kind" "medical_option_kind" NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "medical_history_options_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "medical_history_options_name_length" CHECK (char_length("medical_history_options"."name") between 1 and 60)
);
--> statement-breakpoint
ALTER TABLE "medical_history_options" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "patient_medical_items" (
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"option_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_medical_items_pk" PRIMARY KEY("patient_id","option_id")
);
--> statement-breakpoint
ALTER TABLE "patient_medical_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "no_known_allergies" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "no_conditions" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "medication" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "first_visit_type" text;--> statement-breakpoint
ALTER TABLE "patient_medical_items" ADD CONSTRAINT "patient_medical_items_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_medical_items" ADD CONSTRAINT "patient_medical_items_option_fk" FOREIGN KEY ("tenant_id","option_id") REFERENCES "public"."medical_history_options"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "medical_history_options_tenant_idx" ON "medical_history_options" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "medical_history_options_name_unique" ON "medical_history_options" USING btree ("tenant_id","kind",lower("name")) WHERE "medical_history_options"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "patient_medical_items_tenant_idx" ON "patient_medical_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "patient_medical_items_option_idx" ON "patient_medical_items" USING btree ("option_id");--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_first_visit_type_known" CHECK ("patients"."first_visit_type" in ('examination', 'emergency', 'hygiene', 'consultation'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "medical_history_options" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "patient_medical_items" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);