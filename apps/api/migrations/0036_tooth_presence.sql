CREATE TYPE "public"."tooth_effect" AS ENUM('none', 'removes', 'implant');--> statement-breakpoint
CREATE TYPE "public"."tooth_presence_state" AS ENUM('present', 'missing', 'not_erupted', 'implant');--> statement-breakpoint
CREATE TABLE "tooth_presences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "tooth_presences_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"patient_id" uuid NOT NULL,
	"tooth_code" text NOT NULL,
	"presence" "tooth_presence_state" NOT NULL,
	"occurred_on" date,
	"reason" text,
	"dentist_id" uuid NOT NULL,
	"recorded_in_visit_id" uuid,
	"service_id" uuid,
	"recorded_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tooth_presences_tooth_code_format" CHECK ("tooth_presences"."tooth_code" ~ '^([1-4][1-8]|[5-8][1-5])$'),
	CONSTRAINT "tooth_presences_service_in_visit" CHECK ("tooth_presences"."service_id" is null or "tooth_presences"."recorded_in_visit_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "tooth_presences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "procedures" ADD COLUMN "tooth_effect" "tooth_effect" DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "tooth_presences" ADD CONSTRAINT "tooth_presences_recorded_visit_fk" FOREIGN KEY ("tenant_id","recorded_in_visit_id") REFERENCES "public"."visits"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tooth_presences_tenant_idx" ON "tooth_presences" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tooth_presences_patient_tooth_idx" ON "tooth_presences" USING btree ("tenant_id","patient_id","tooth_code");--> statement-breakpoint
CREATE INDEX "tooth_presences_service_idx" ON "tooth_presences" USING btree ("tenant_id","service_id") WHERE "tooth_presences"."service_id" is not null;--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_tooth_effect_per_tooth" CHECK ("procedures"."tooth_effect"::text = 'none' or "procedures"."charge_unit" = 'per_tooth');--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tooth_presences" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- The default template's extraction takes the tooth off the chart (feature 7, H2, D7). Clinics
-- that renamed or re-coded it, and implant placement, are set by the owner in the Catalog.
UPDATE "procedures" SET "tooth_effect" = 'removes'
WHERE lower("code") = 'ext' AND "charge_unit" = 'per_tooth' AND "deleted_at" IS NULL;
