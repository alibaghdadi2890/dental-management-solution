CREATE TABLE "lab_adjustments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"lab_id" uuid NOT NULL,
	"on_date" date NOT NULL,
	"kind" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"idempotency_key" uuid,
	"idempotency_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_adjustments_amount_positive" CHECK ("lab_adjustments"."amount" > 0),
	CONSTRAINT "lab_adjustments_kind" CHECK ("lab_adjustments"."kind" in ('credit', 'charge'))
);
--> statement-breakpoint
ALTER TABLE "lab_adjustments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lab_order_counters" (
	"tenant_id" uuid PRIMARY KEY DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"last_value" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lab_order_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lab_order_files" (
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_order_files_order_id_file_id_pk" PRIMARY KEY("order_id","file_id")
);
--> statement-breakpoint
ALTER TABLE "lab_order_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lab_order_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"service_id" uuid,
	"description" text NOT NULL,
	"unit_price" numeric(12, 2),
	"turnaround_days" smallint,
	"quantity" smallint NOT NULL,
	"shade" text,
	"target" text NOT NULL,
	"teeth" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_order_items_quantity" CHECK ("lab_order_items"."quantity" between 1 and 99),
	CONSTRAINT "lab_order_items_target" CHECK ("lab_order_items"."target" in ('teeth', 'upper', 'lower', 'both')),
	CONSTRAINT "lab_order_items_teeth" CHECK (("lab_order_items"."target" = 'teeth') = (cardinality("lab_order_items"."teeth") > 0))
);
--> statement-breakpoint
ALTER TABLE "lab_order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lab_order_trips" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"sent_on" date NOT NULL,
	"sent_via" text NOT NULL,
	"sent_reference" text,
	"promised_on" date NOT NULL,
	"expected_on" date NOT NULL,
	"received_on" date,
	"received_note" text,
	"outcome" text,
	"outcome_note" text,
	"outcome_on" date,
	"remake_reason" text,
	"remake_borne_by" text,
	"remake_charge" numeric(12, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_order_trips_seq_unique" UNIQUE("order_id","seq"),
	CONSTRAINT "lab_order_trips_received_after_sent" CHECK ("lab_order_trips"."received_on" is null or "lab_order_trips"."received_on" >= "lab_order_trips"."sent_on"),
	CONSTRAINT "lab_order_trips_outcome_after_received" CHECK ("lab_order_trips"."outcome" is null or ("lab_order_trips"."received_on" is not null and "lab_order_trips"."outcome_on" is not null)),
	CONSTRAINT "lab_order_trips_remake" CHECK (("lab_order_trips"."outcome" = 'remake') = ("lab_order_trips"."remake_reason" is not null and "lab_order_trips"."remake_borne_by" is not null)),
	CONSTRAINT "lab_order_trips_remake_charge" CHECK ("lab_order_trips"."remake_charge" is null or ("lab_order_trips"."remake_charge" >= 0 and "lab_order_trips"."remake_borne_by" = 'clinic'))
);
--> statement-breakpoint
ALTER TABLE "lab_order_trips" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lab_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"display_number" integer NOT NULL,
	"patient_id" uuid NOT NULL,
	"dentist_id" uuid NOT NULL,
	"lab_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"visit_id" uuid,
	"appointment_id" uuid,
	"status" text DEFAULT 'to_send' NOT NULL,
	"held_from" text,
	"hold_reason" text,
	"cancelled_from" text,
	"priority" text DEFAULT 'normal' NOT NULL,
	"submission" text DEFAULT 'physical' NOT NULL,
	"lab_case_ref" text,
	"lab_case_url" text,
	"expected_days" smallint NOT NULL,
	"notes" text,
	"plan_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"cost" numeric(12, 2) NOT NULL,
	"cost_set_by_hand" boolean DEFAULT false NOT NULL,
	"currency" char(3) NOT NULL,
	"first_received_on" date,
	"waiting_since" date NOT NULL,
	"done_on" date,
	"cancel_reason" text,
	"cancel_charge" numeric(12, 2),
	"cancelled_on" date,
	"created_by" uuid NOT NULL,
	"idempotency_key" uuid,
	"idempotency_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_orders_display_number_unique" UNIQUE("tenant_id","display_number"),
	CONSTRAINT "lab_orders_status" CHECK ("lab_orders"."status" in ('to_send', 'at_lab', 'arrived', 'done', 'on_hold', 'remake', 'cancelled')),
	CONSTRAINT "lab_orders_held" CHECK (("lab_orders"."status" = 'on_hold') = ("lab_orders"."held_from" is not null)),
	CONSTRAINT "lab_orders_cancelled" CHECK (("lab_orders"."status" = 'cancelled') = ("lab_orders"."cancelled_from" is not null and "lab_orders"."cancelled_on" is not null)),
	CONSTRAINT "lab_orders_cost" CHECK ("lab_orders"."cost" >= 0),
	CONSTRAINT "lab_orders_cancel_charge" CHECK ("lab_orders"."cancel_charge" is null or "lab_orders"."cancel_charge" >= 0),
	CONSTRAINT "lab_orders_expected_days" CHECK ("lab_orders"."expected_days" between 1 and 365)
);
--> statement-breakpoint
ALTER TABLE "lab_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lab_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"lab_id" uuid NOT NULL,
	"paid_on" date NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"note" text,
	"created_by" uuid NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"idempotency_key" uuid,
	"idempotency_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_payments_amount_positive" CHECK ("lab_payments"."amount" > 0),
	CONSTRAINT "lab_payments_method" CHECK ("lab_payments"."method" in ('cash', 'card', 'bank_transfer', 'whish', 'insurance')),
	CONSTRAINT "lab_payments_void_complete" CHECK (("lab_payments"."voided_at" is null) = ("lab_payments"."voided_by" is null) and ("lab_payments"."voided_at" is null) = ("lab_payments"."void_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "lab_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lab_services" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"lab_id" uuid NOT NULL,
	"name" text NOT NULL,
	"price" numeric(12, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"turnaround_days" smallint,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_services_price" CHECK ("lab_services"."price" >= 0),
	CONSTRAINT "lab_services_turnaround" CHECK ("lab_services"."turnaround_days" is null or "lab_services"."turnaround_days" between 1 and 365)
);
--> statement-breakpoint
ALTER TABLE "lab_services" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "labs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"name" text NOT NULL,
	"contact_person" text,
	"phone" text,
	"email" text,
	"address" text,
	"delivery_methods" text[] NOT NULL,
	"portal_url" text,
	"turnaround_days" smallint NOT NULL,
	"note" text,
	"active" boolean DEFAULT true NOT NULL,
	"opening_balance" numeric(12, 2),
	"opening_balance_on" date,
	"currency" char(3) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "labs_delivery_methods" CHECK (cardinality("labs"."delivery_methods") >= 1),
	CONSTRAINT "labs_turnaround" CHECK ("labs"."turnaround_days" between 1 and 365),
	CONSTRAINT "labs_opening_balance_complete" CHECK (("labs"."opening_balance" is null) = ("labs"."opening_balance_on" is null))
);
--> statement-breakpoint
ALTER TABLE "labs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_source";--> statement-breakpoint
DROP INDEX "expenses_mirror_unique";--> statement-breakpoint
ALTER TABLE "lab_adjustments" ADD CONSTRAINT "lab_adjustments_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_order_files" ADD CONSTRAINT "lab_order_files_order_id_lab_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."lab_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_order_items" ADD CONSTRAINT "lab_order_items_order_id_lab_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."lab_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_order_items" ADD CONSTRAINT "lab_order_items_service_id_lab_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."lab_services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_order_trips" ADD CONSTRAINT "lab_order_trips_order_id_lab_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."lab_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_payments" ADD CONSTRAINT "lab_payments_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_services" ADD CONSTRAINT "lab_services_lab_id_labs_id_fk" FOREIGN KEY ("lab_id") REFERENCES "public"."labs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lab_adjustments_tenant_idx" ON "lab_adjustments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "lab_adjustments_lab_idx" ON "lab_adjustments" USING btree ("tenant_id","lab_id","on_date");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_adjustments_idempotency_unique" ON "lab_adjustments" USING btree ("tenant_id","idempotency_key") WHERE "lab_adjustments"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "lab_order_files_tenant_idx" ON "lab_order_files" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "lab_order_items_tenant_idx" ON "lab_order_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "lab_order_items_order_idx" ON "lab_order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "lab_order_trips_tenant_idx" ON "lab_order_trips" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "lab_orders_tenant_idx" ON "lab_orders" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "lab_orders_status_idx" ON "lab_orders" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "lab_orders_patient_idx" ON "lab_orders" USING btree ("tenant_id","patient_id");--> statement-breakpoint
CREATE INDEX "lab_orders_appointment_idx" ON "lab_orders" USING btree ("tenant_id","appointment_id") WHERE "lab_orders"."appointment_id" is not null;--> statement-breakpoint
CREATE INDEX "lab_orders_lab_idx" ON "lab_orders" USING btree ("tenant_id","lab_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_orders_idempotency_unique" ON "lab_orders" USING btree ("tenant_id","idempotency_key") WHERE "lab_orders"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "lab_payments_tenant_idx" ON "lab_payments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "lab_payments_lab_idx" ON "lab_payments" USING btree ("tenant_id","lab_id","paid_on");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_payments_idempotency_unique" ON "lab_payments" USING btree ("tenant_id","idempotency_key") WHERE "lab_payments"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "lab_services_tenant_idx" ON "lab_services" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_services_name_unique" ON "lab_services" USING btree ("lab_id",lower("name"));--> statement-breakpoint
CREATE INDEX "labs_tenant_idx" ON "labs" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "labs_name_unique" ON "labs" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_mirror_unique" ON "expenses" USING btree ("tenant_id","source","source_id") WHERE "expenses"."source" in ('payroll', 'compensation', 'lab');--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_source" CHECK ("expenses"."source" in ('manual', 'fixed', 'payroll', 'compensation', 'lab'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "lab_adjustments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "lab_order_counters" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "lab_order_files" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "lab_order_items" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "lab_order_trips" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "lab_orders" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "lab_payments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "lab_services" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "labs" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- Never deleted (ADR-0082, ADR-0083): labs, services and orders are deactivated or cancelled; a
-- payment is only voided; an adjustment never changes. Items and attachments are replaced as a
-- list, and Undo sent removes the open trip.
REVOKE DELETE, TRUNCATE ON "labs" FROM dcm_app, dcm_admin;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "lab_services" FROM dcm_app, dcm_admin;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "lab_orders" FROM dcm_app, dcm_admin;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "lab_order_counters" FROM dcm_app, dcm_admin;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "lab_adjustments" FROM dcm_app, dcm_admin;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "lab_payments" FROM dcm_app, dcm_admin;--> statement-breakpoint
GRANT UPDATE ("voided_at", "voided_by", "void_reason", "updated_at") ON "lab_payments" TO dcm_app;--> statement-breakpoint
-- The four permissions (ADR-0086): only added. The owner and the admin get all four; the dentist,
-- the assistant and the front desk work with orders. No other role or grant changes.
INSERT INTO "role_permissions" ("tenant_id", "role_id", "permission")
SELECT "roles"."tenant_id", "roles"."id", "grants"."permission"
FROM "roles"
JOIN (VALUES
  ('owner', 'lab:read'), ('owner', 'lab:manage'), ('owner', 'lab:money_read'), ('owner', 'lab:money_manage'),
  ('admin', 'lab:read'), ('admin', 'lab:manage'), ('admin', 'lab:money_read'), ('admin', 'lab:money_manage'),
  ('dentist', 'lab:read'), ('dentist', 'lab:manage'),
  ('assistant', 'lab:read'), ('assistant', 'lab:manage'),
  ('frontdesk', 'lab:read'), ('frontdesk', 'lab:manage')
) AS "grants" ("role_key", "permission") ON "grants"."role_key" = "roles"."key"
WHERE "roles"."system"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_template_permissions" ("template_id", "permission")
SELECT "role_templates"."id", "grants"."permission"
FROM "role_templates"
JOIN (VALUES
  ('owner', 'lab:read'), ('owner', 'lab:manage'), ('owner', 'lab:money_read'), ('owner', 'lab:money_manage'),
  ('admin', 'lab:read'), ('admin', 'lab:manage'), ('admin', 'lab:money_read'), ('admin', 'lab:money_manage'),
  ('dentist', 'lab:read'), ('dentist', 'lab:manage'),
  ('assistant', 'lab:read'), ('assistant', 'lab:manage'),
  ('frontdesk', 'lab:read'), ('frontdesk', 'lab:manage')
) AS "grants" ("role_key", "permission") ON "grants"."role_key" = "role_templates"."key"
ON CONFLICT DO NOTHING;
