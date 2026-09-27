CREATE TYPE "public"."ledger_entry_kind" AS ENUM('opening_balance', 'adjustment');--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"kind" "ledger_entry_kind" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"effective_date" date NOT NULL,
	"note" text,
	"reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_amount_non_zero" CHECK ("ledger_entries"."amount" <> 0)
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "ledger_entries_tenant_idx" ON "ledger_entries" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_patient_idx" ON "ledger_entries" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ledger_entries" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);