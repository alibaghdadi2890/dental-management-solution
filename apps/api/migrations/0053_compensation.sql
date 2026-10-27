-- Agreements of one dentist never overlap (ADR-0058): an exclusion constraint on uuids and a date
-- range needs btree_gist (trusted since Postgres 13; the migration role owns the database).
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE TABLE "compensation_adjustments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"staff_profile_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"effective_date" date NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"idempotency_key" uuid,
	"idempotency_hash" text,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compensation_adjustments_amount_non_zero" CHECK ("compensation_adjustments"."amount" <> 0),
	CONSTRAINT "compensation_adjustments_void_complete" CHECK (("compensation_adjustments"."voided_at" is null) = ("compensation_adjustments"."voided_by" is null) and ("compensation_adjustments"."voided_at" is null) = ("compensation_adjustments"."void_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "compensation_adjustments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "compensation_agreements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"staff_profile_id" uuid NOT NULL,
	"preset" text NOT NULL,
	"components" jsonb NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"statement_visible_to_dentist" boolean DEFAULT true NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	"end_reason" text,
	"superseded_at" timestamp with time zone,
	"superseded_by" uuid,
	"supersede_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compensation_agreements_dates" CHECK ("compensation_agreements"."effective_to" is null or "compensation_agreements"."effective_to" >= "compensation_agreements"."effective_from"),
	CONSTRAINT "compensation_agreements_supersede_complete" CHECK (("compensation_agreements"."superseded_at" is null) = ("compensation_agreements"."superseded_by" is null))
);
--> statement-breakpoint
ALTER TABLE "compensation_agreements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "compensation_payouts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"staff_profile_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"paid_on" date NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"note" text,
	"created_by" uuid NOT NULL,
	"idempotency_key" uuid,
	"idempotency_hash" text,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compensation_payouts_amount_positive" CHECK ("compensation_payouts"."amount" > 0),
	CONSTRAINT "compensation_payouts_method" CHECK ("compensation_payouts"."method" in ('cash', 'card', 'bank_transfer', 'whish', 'insurance')),
	CONSTRAINT "compensation_payouts_void_complete" CHECK (("compensation_payouts"."voided_at" is null) = ("compensation_payouts"."voided_by" is null) and ("compensation_payouts"."voided_at" is null) = ("compensation_payouts"."void_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "compensation_payouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "compensation_periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"staff_profile_id" uuid NOT NULL,
	"month" char(7) NOT NULL,
	"status" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"line_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"closed_at" timestamp with time zone NOT NULL,
	"closed_by" uuid NOT NULL,
	"reopened_at" timestamp with time zone,
	"reopened_by" uuid,
	"reopen_reason" text,
	"idempotency_key" uuid,
	"idempotency_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compensation_periods_month_format" CHECK ("compensation_periods"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "compensation_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "compensation_adjustments_tenant_idx" ON "compensation_adjustments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "compensation_adjustments_profile_date_idx" ON "compensation_adjustments" USING btree ("tenant_id","staff_profile_id","effective_date");--> statement-breakpoint
CREATE UNIQUE INDEX "compensation_adjustments_idempotency_unique" ON "compensation_adjustments" USING btree ("tenant_id","idempotency_key") WHERE "compensation_adjustments"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "compensation_agreements_tenant_idx" ON "compensation_agreements" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "compensation_agreements_profile_idx" ON "compensation_agreements" USING btree ("tenant_id","staff_profile_id");--> statement-breakpoint
CREATE INDEX "compensation_payouts_tenant_idx" ON "compensation_payouts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "compensation_payouts_profile_date_idx" ON "compensation_payouts" USING btree ("tenant_id","staff_profile_id","paid_on");--> statement-breakpoint
CREATE UNIQUE INDEX "compensation_payouts_idempotency_unique" ON "compensation_payouts" USING btree ("tenant_id","idempotency_key") WHERE "compensation_payouts"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "compensation_periods_tenant_idx" ON "compensation_periods" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "compensation_periods_month_unique" ON "compensation_periods" USING btree ("tenant_id","staff_profile_id","month");--> statement-breakpoint
CREATE INDEX "ledger_entries_visit_date_idx" ON "ledger_entries" USING btree ("tenant_id","effective_date") WHERE "ledger_entries"."visit_id" is not null;--> statement-breakpoint
CREATE INDEX "ledger_entries_visit_created_idx" ON "ledger_entries" USING btree ("tenant_id","created_at") WHERE "ledger_entries"."visit_id" is not null;--> statement-breakpoint
CREATE INDEX "payment_allocations_created_idx" ON "payment_allocations" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "compensation_adjustments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "compensation_agreements" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "compensation_payouts" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "compensation_periods" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "compensation_agreements" ADD CONSTRAINT "compensation_agreements_no_overlap" EXCLUDE USING gist ("tenant_id" WITH =, "staff_profile_id" WITH =, daterange("effective_from", "effective_to", '[]') WITH &&) WHERE ("superseded_at" IS NULL);--> statement-breakpoint
-- Append-only (ADR-0058, ADR-0059): an agreement is only ever ended or superseded, an adjustment
-- or payout only voided, a period closed and reopened; nothing here is ever deleted.
REVOKE UPDATE, DELETE, TRUNCATE ON "compensation_agreements" FROM dcm_app, dcm_admin;--> statement-breakpoint
GRANT UPDATE ("effective_to", "ended_at", "ended_by", "end_reason", "superseded_at", "superseded_by", "supersede_reason", "updated_at") ON "compensation_agreements" TO dcm_app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "compensation_adjustments" FROM dcm_app, dcm_admin;--> statement-breakpoint
GRANT UPDATE ("voided_at", "voided_by", "void_reason", "updated_at") ON "compensation_adjustments" TO dcm_app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "compensation_payouts" FROM dcm_app, dcm_admin;--> statement-breakpoint
GRANT UPDATE ("voided_at", "voided_by", "void_reason", "updated_at") ON "compensation_payouts" TO dcm_app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "compensation_periods" FROM dcm_app, dcm_admin;--> statement-breakpoint
GRANT UPDATE ("status", "snapshot", "line_ids", "closed_at", "closed_by", "reopened_at", "reopened_by", "reopen_reason", "idempotency_key", "idempotency_hash", "updated_at") ON "compensation_periods" TO dcm_app;
