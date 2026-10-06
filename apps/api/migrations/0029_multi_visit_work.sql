ALTER TYPE "public"."plan_status" ADD VALUE 'in_progress' BEFORE 'performed';--> statement-breakpoint
CREATE TABLE "treatment_plan_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"note" text,
	"recorded_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "treatment_plan_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD COLUMN "started_in_visit_id" uuid;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "treatment_plan_sessions" ADD CONSTRAINT "treatment_plan_sessions_plan_fk" FOREIGN KEY ("tenant_id","plan_id") REFERENCES "public"."treatment_plans"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_sessions" ADD CONSTRAINT "treatment_plan_sessions_visit_fk" FOREIGN KEY ("tenant_id","visit_id") REFERENCES "public"."visits"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "treatment_plan_sessions_tenant_idx" ON "treatment_plan_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "treatment_plan_sessions_unique" ON "treatment_plan_sessions" USING btree ("tenant_id","plan_id","visit_id") WHERE "treatment_plan_sessions"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "treatment_plan_sessions_visit_idx" ON "treatment_plan_sessions" USING btree ("tenant_id","visit_id");--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_started_visit_fk" FOREIGN KEY ("tenant_id","started_in_visit_id") REFERENCES "public"."visits"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_started_fields" CHECK (("treatment_plans"."started_in_visit_id" is null) = ("treatment_plans"."started_at" is null) and ("treatment_plans"."status"::text <> 'in_progress' or "treatment_plans"."started_at" is not null));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "treatment_plan_sessions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);