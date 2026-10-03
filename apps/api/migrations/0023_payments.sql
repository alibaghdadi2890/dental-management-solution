CREATE TYPE "public"."allocation_kind" AS ENUM('allocation', 'credit_applied', 'release');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('payment', 'refund', 'void');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'card', 'bank_transfer', 'insurance');--> statement-breakpoint
ALTER TYPE "public"."ledger_entry_kind" ADD VALUE 'payment';--> statement-breakpoint
ALTER TYPE "public"."ledger_entry_kind" ADD VALUE 'payment_refund';--> statement-breakpoint
ALTER TYPE "public"."ledger_entry_kind" ADD VALUE 'payment_void';--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "payment_allocations_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"source_entry_id" uuid NOT NULL,
	"target_entry_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"kind" "allocation_kind" NOT NULL,
	"manual" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_allocations_amount_non_zero" CHECK ("payment_allocations"."amount" <> 0)
);
--> statement-breakpoint
ALTER TABLE "payment_allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment_counters" (
	"tenant_id" uuid PRIMARY KEY DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"last_value" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"kind" "payment_kind" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"method" "payment_method" NOT NULL,
	"paid_at" date NOT NULL,
	"reference" text,
	"note" text,
	"reason" text,
	"receipt_number" integer NOT NULL,
	"household_group_id" uuid,
	"payer_contact_id" uuid,
	"reverses_payment_id" uuid,
	"ledger_entry_id" uuid NOT NULL,
	"idempotency_key" uuid,
	"balance_after" numeric(20, 2),
	"branch_id" uuid,
	"recorded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "payments_ledger_entry_unique" UNIQUE("tenant_id","ledger_entry_id"),
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount" > 0),
	CONSTRAINT "payments_reverses_iff_correction" CHECK (("payments"."reverses_payment_id" is not null) = ("payments"."kind"::text <> 'payment')),
	CONSTRAINT "payments_reason_iff_correction" CHECK (("payments"."reason" is not null) = ("payments"."kind"::text <> 'payment'))
);
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_source_fk" FOREIGN KEY ("tenant_id","source_entry_id") REFERENCES "public"."ledger_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_target_fk" FOREIGN KEY ("tenant_id","target_entry_id") REFERENCES "public"."ledger_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_ledger_entry_fk" FOREIGN KEY ("tenant_id","ledger_entry_id") REFERENCES "public"."ledger_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reverses_fk" FOREIGN KEY ("tenant_id","reverses_payment_id") REFERENCES "public"."payments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_allocations_tenant_idx" ON "payment_allocations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_source_idx" ON "payment_allocations" USING btree ("tenant_id","source_entry_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_target_idx" ON "payment_allocations" USING btree ("tenant_id","target_entry_id");--> statement-breakpoint
CREATE INDEX "payments_tenant_idx" ON "payments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payments_patient_idx" ON "payments" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "payments_paid_at_idx" ON "payments" USING btree ("tenant_id","paid_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_receipt_unique" ON "payments" USING btree ("tenant_id","receipt_number","patient_id") WHERE "payments"."reverses_payment_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idempotency_unique" ON "payments" USING btree ("tenant_id","idempotency_key","patient_id") WHERE "payments"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "payments_reverses_idx" ON "payments" USING btree ("tenant_id","reverses_payment_id") WHERE "payments"."reverses_payment_id" is not null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payment_allocations" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payment_counters" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);