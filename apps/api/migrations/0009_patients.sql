CREATE TYPE "public"."contact_relationship" AS ENUM('parent', 'spouse', 'child', 'sibling', 'caregiver', 'other');--> statement-breakpoint
CREATE TYPE "public"."patient_sex" AS ENUM('female', 'male', 'other', 'unknown');--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"full_name" text,
	"phone" text,
	"phone_search" text,
	"email" text,
	"linked_patient_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "contacts_linked_or_named" CHECK ("contacts"."linked_patient_id" is not null or "contacts"."full_name" is not null)
);
--> statement-breakpoint
ALTER TABLE "contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "patient_contacts" (
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"relationship" "contact_relationship" NOT NULL,
	"is_guardian" boolean DEFAULT false NOT NULL,
	"is_billing_contact" boolean DEFAULT false NOT NULL,
	"is_emergency_contact" boolean DEFAULT false NOT NULL,
	"is_primary_guardian" boolean DEFAULT false NOT NULL,
	"is_primary_billing" boolean DEFAULT false NOT NULL,
	"is_primary_emergency" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patient_contacts_pk" PRIMARY KEY("patient_id","contact_id"),
	CONSTRAINT "patient_contacts_has_role" CHECK ("patient_contacts"."is_guardian" or "patient_contacts"."is_billing_contact" or "patient_contacts"."is_emergency_contact"),
	CONSTRAINT "patient_contacts_primary_guardian_role" CHECK (not "patient_contacts"."is_primary_guardian" or "patient_contacts"."is_guardian"),
	CONSTRAINT "patient_contacts_primary_billing_role" CHECK (not "patient_contacts"."is_primary_billing" or "patient_contacts"."is_billing_contact"),
	CONSTRAINT "patient_contacts_primary_emergency_role" CHECK (not "patient_contacts"."is_primary_emergency" or "patient_contacts"."is_emergency_contact")
);
--> statement-breakpoint
ALTER TABLE "patient_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
	"phone" text,
	"phone_search" text,
	"date_of_birth" date,
	"sex" "patient_sex" DEFAULT 'unknown' NOT NULL,
	"email" text,
	"address" text,
	"insurance" text,
	"notes" text,
	"medical_alerts" text[] DEFAULT '{}'::text[] NOT NULL,
	"primary_dentist_id" uuid,
	"external_id" text,
	"merged_into_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "patients_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "patients_merged_requires_archived" CHECK ("patients"."merged_into_id" is null or "patients"."deleted_at" is not null),
	CONSTRAINT "patients_not_merged_into_self" CHECK ("patients"."merged_into_id" <> "patients"."id")
);
--> statement-breakpoint
ALTER TABLE "patients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_linked_patient_fk" FOREIGN KEY ("tenant_id","linked_patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_contacts" ADD CONSTRAINT "patient_contacts_patient_fk" FOREIGN KEY ("tenant_id","patient_id") REFERENCES "public"."patients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_contacts" ADD CONSTRAINT "patient_contacts_contact_fk" FOREIGN KEY ("tenant_id","contact_id") REFERENCES "public"."contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contacts_tenant_idx" ON "contacts" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_linked_patient_unique" ON "contacts" USING btree ("tenant_id","linked_patient_id") WHERE "contacts"."linked_patient_id" is not null and "contacts"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "patient_contacts_tenant_idx" ON "patient_contacts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "patient_contacts_contact_idx" ON "patient_contacts" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "patient_contacts_primary_guardian_unique" ON "patient_contacts" USING btree ("tenant_id","patient_id") WHERE "patient_contacts"."is_primary_guardian";--> statement-breakpoint
CREATE UNIQUE INDEX "patient_contacts_primary_billing_unique" ON "patient_contacts" USING btree ("tenant_id","patient_id") WHERE "patient_contacts"."is_primary_billing";--> statement-breakpoint
CREATE UNIQUE INDEX "patient_contacts_primary_emergency_unique" ON "patient_contacts" USING btree ("tenant_id","patient_id") WHERE "patient_contacts"."is_primary_emergency";--> statement-breakpoint
CREATE INDEX "patients_tenant_idx" ON "patients" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_display_number_unique" ON "patients" USING btree ("tenant_id","display_number");--> statement-breakpoint
CREATE UNIQUE INDEX "patients_external_id_unique" ON "patients" USING btree ("tenant_id","external_id") WHERE "patients"."external_id" is not null;--> statement-breakpoint
CREATE INDEX "patients_name_key_dob_idx" ON "patients" USING btree ("tenant_id","name_key","date_of_birth") WHERE "patients"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "patients_tenant_updated_idx" ON "patients" USING btree ("tenant_id","updated_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "contacts" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "patient_contacts" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "patient_counters" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "patients" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);