CREATE TABLE "plan_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_groups_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "plan_groups_title_length" CHECK (char_length("plan_groups"."title") between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "plan_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "treatment_plans" DROP CONSTRAINT "treatment_plans_cancelled_fields";--> statement-breakpoint
ALTER TABLE "patient_diagnoses" ALTER COLUMN "recorded_in_visit_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "treatment_plans" ALTER COLUMN "recorded_in_visit_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD COLUMN "group_id" uuid;--> statement-breakpoint
CREATE INDEX "plan_groups_tenant_idx" ON "plan_groups" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "plan_groups_patient_idx" ON "plan_groups" USING btree ("tenant_id","patient_id");--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_group_fk" FOREIGN KEY ("tenant_id","group_id") REFERENCES "public"."plan_groups"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_cancelled_fields" CHECK (case when "treatment_plans"."status" = 'cancelled' then "treatment_plans"."cancelled_at" is not null else "treatment_plans"."cancelled_in_visit_id" is null and "treatment_plans"."cancelled_at" is null end);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "plan_groups" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- chart:write (records outside a visit, P3): the system roles seeded before it get the grant.
-- Runs as the schema owner: every tenant's rows.
INSERT INTO "role_permissions" ("tenant_id", "role_id", "permission")
SELECT "tenant_id", "id", 'chart:write' FROM "roles"
WHERE "system" AND "key" IN ('owner', 'dentist')
ON CONFLICT DO NOTHING;
