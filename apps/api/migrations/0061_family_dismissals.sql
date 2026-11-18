CREATE TABLE "family_dismissals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"phone_key" text NOT NULL,
	"people" uuid[] NOT NULL,
	"dismissed_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "family_dismissals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "family_dismissals_tenant_idx" ON "family_dismissals" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "family_dismissals_phone_key" ON "family_dismissals" USING btree ("tenant_id","phone_key");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "family_dismissals" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);