CREATE TABLE "inventory_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"source" text NOT NULL,
	"receipt_id" uuid,
	"position" smallint,
	"lot" text,
	"expires_on" date,
	"received_on" date NOT NULL,
	"quantity" integer NOT NULL,
	"quantity_left" integer NOT NULL,
	"price" numeric(12, 2),
	"price_per" text,
	"amount" numeric(12, 2),
	"currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_batches_source" CHECK ("inventory_batches"."source" in ('receipt', 'opening', 'count')),
	CONSTRAINT "inventory_batches_receipt" CHECK (("inventory_batches"."source" = 'receipt') = ("inventory_batches"."receipt_id" is not null)),
	CONSTRAINT "inventory_batches_quantity" CHECK ("inventory_batches"."quantity" >= 0),
	CONSTRAINT "inventory_batches_left" CHECK ("inventory_batches"."quantity_left" >= 0),
	CONSTRAINT "inventory_batches_priced" CHECK (("inventory_batches"."price" is null) = ("inventory_batches"."amount" is null) and ("inventory_batches"."price" is null) = ("inventory_batches"."price_per" is null)),
	CONSTRAINT "inventory_batches_amount" CHECK ("inventory_batches"."amount" is null or ("inventory_batches"."amount" >= 0 and "inventory_batches"."price" >= 0))
);
--> statement-breakpoint
ALTER TABLE "inventory_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"key" text,
	"name" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_categories_key_or_name" CHECK (("inventory_categories"."key" is null) <> ("inventory_categories"."name" is null))
);
--> statement-breakpoint
ALTER TABLE "inventory_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_count_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"count_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"counted" integer,
	"system_then" integer,
	"counted_by" uuid,
	"counted_at" timestamp with time zone,
	"opening_price" numeric(12, 2),
	"opening_price_per" text,
	"opening_lot" text,
	"opening_expires_on" date,
	"difference" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_count_lines_unique" UNIQUE("count_id","item_id"),
	CONSTRAINT "inventory_count_lines_counted" CHECK (("inventory_count_lines"."counted" is null) = ("inventory_count_lines"."system_then" is null) and ("inventory_count_lines"."counted" is null or "inventory_count_lines"."counted" >= 0))
);
--> statement-breakpoint
ALTER TABLE "inventory_count_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_counts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"category_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"started_by" uuid NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"apply_idempotency_key" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_counts_status" CHECK ("inventory_counts"."status" in ('open', 'applied', 'discarded')),
	CONSTRAINT "inventory_counts_closed" CHECK (("inventory_counts"."status" = 'open') = ("inventory_counts"."closed_at" is null and "inventory_counts"."closed_by" is null))
);
--> statement-breakpoint
ALTER TABLE "inventory_counts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_item_branches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"reorder_level" integer,
	"ordered_on" date,
	"ordered_note" text,
	"ordered_by" uuid,
	"to_count_at" timestamp with time zone,
	"to_count_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_item_branches_unique" UNIQUE("item_id","branch_id"),
	CONSTRAINT "inventory_item_branches_reorder_level" CHECK ("inventory_item_branches"."reorder_level" is null or "inventory_item_branches"."reorder_level" >= 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_item_branches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"category_id" uuid NOT NULL,
	"unit" text NOT NULL,
	"pack_name" text,
	"pack_size" integer,
	"reorder_level" integer,
	"usual_supplier_id" uuid,
	"usual_order_packs" integer,
	"tracks_expiry" boolean DEFAULT false NOT NULL,
	"note" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_items_pack" CHECK (("inventory_items"."pack_name" is null) = ("inventory_items"."pack_size" is null)),
	CONSTRAINT "inventory_items_pack_size" CHECK ("inventory_items"."pack_size" is null or "inventory_items"."pack_size" >= 1),
	CONSTRAINT "inventory_items_reorder_level" CHECK ("inventory_items"."reorder_level" is null or "inventory_items"."reorder_level" >= 0),
	CONSTRAINT "inventory_items_usual_order" CHECK ("inventory_items"."usual_order_packs" is null or "inventory_items"."usual_order_packs" >= 1)
);
--> statement-breakpoint
ALTER TABLE "inventory_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_movement_batches" (
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"movement_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movement_batches_movement_id_batch_id_pk" PRIMARY KEY("movement_id","batch_id"),
	CONSTRAINT "inventory_movement_batches_quantity" CHECK ("inventory_movement_batches"."quantity" <> 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_movement_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"action_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"item_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"reason" text,
	"note" text,
	"occurred_on" date NOT NULL,
	"receipt_id" uuid,
	"count_id" uuid,
	"reverses_id" uuid,
	"reversed_at" timestamp with time zone,
	"reversed_by" uuid,
	"reversal_reason" text,
	"created_by" uuid NOT NULL,
	"idempotency_key" uuid,
	"idempotency_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_kind" CHECK ("inventory_movements"."kind" in ('receive', 'opening', 'take_out', 'adjust', 'count', 'receipt_edit', 'receipt_void', 'reversal')),
	CONSTRAINT "inventory_movements_reason" CHECK ("inventory_movements"."reason" is null or "inventory_movements"."reason" in ('expired', 'damaged', 'lost', 'returned', 'unrecorded_use', 'correction', 'count')),
	CONSTRAINT "inventory_movements_quantity" CHECK ("inventory_movements"."quantity" <> 0),
	CONSTRAINT "inventory_movements_reversed_complete" CHECK (("inventory_movements"."reversed_at" is null) = ("inventory_movements"."reversed_by" is null))
);
--> statement-breakpoint
ALTER TABLE "inventory_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_receipt_counters" (
	"tenant_id" uuid PRIMARY KEY DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"last_value" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_receipt_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_receipt_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"saved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inventory_receipt_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_receipts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"display_number" integer NOT NULL,
	"supplier_id" uuid,
	"payee" text,
	"branch_id" uuid NOT NULL,
	"received_on" date NOT NULL,
	"invoice_number" text,
	"invoice_date" date,
	"discount" numeric(12, 2),
	"charges" numeric(12, 2),
	"currency" char(3) NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"idempotency_key" uuid,
	"idempotency_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_receipts_display_number_unique" UNIQUE("tenant_id","display_number"),
	CONSTRAINT "inventory_receipts_supplier_or_payee" CHECK (("inventory_receipts"."supplier_id" is null) <> ("inventory_receipts"."payee" is null)),
	CONSTRAINT "inventory_receipts_discount" CHECK ("inventory_receipts"."discount" is null or "inventory_receipts"."discount" >= 0),
	CONSTRAINT "inventory_receipts_charges" CHECK ("inventory_receipts"."charges" is null or "inventory_receipts"."charges" >= 0),
	CONSTRAINT "inventory_receipts_void_complete" CHECK (("inventory_receipts"."voided_at" is null) = ("inventory_receipts"."voided_by" is null) and ("inventory_receipts"."voided_at" is null) = ("inventory_receipts"."void_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "inventory_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_settings" (
	"tenant_id" uuid PRIMARY KEY DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"expiring_days" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_settings_expiring_days" CHECK ("inventory_settings"."expiring_days" between 1 and 365)
);
--> statement-breakpoint
ALTER TABLE "inventory_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_supplier_adjustments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
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
	CONSTRAINT "inventory_supplier_adjustments_amount" CHECK ("inventory_supplier_adjustments"."amount" > 0),
	CONSTRAINT "inventory_supplier_adjustments_kind" CHECK ("inventory_supplier_adjustments"."kind" in ('credit', 'charge'))
);
--> statement-breakpoint
ALTER TABLE "inventory_supplier_adjustments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_supplier_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"supplier_id" uuid,
	"receipt_id" uuid,
	"payee" text,
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
	CONSTRAINT "inventory_supplier_payments_amount" CHECK ("inventory_supplier_payments"."amount" > 0),
	CONSTRAINT "inventory_supplier_payments_method" CHECK ("inventory_supplier_payments"."method" in ('cash', 'card', 'bank_transfer', 'whish', 'insurance')),
	CONSTRAINT "inventory_supplier_payments_payee" CHECK ("inventory_supplier_payments"."supplier_id" is not null or ("inventory_supplier_payments"."receipt_id" is not null and "inventory_supplier_payments"."payee" is not null)),
	CONSTRAINT "inventory_supplier_payments_void_complete" CHECK (("inventory_supplier_payments"."voided_at" is null) = ("inventory_supplier_payments"."voided_by" is null) and ("inventory_supplier_payments"."voided_at" is null) = ("inventory_supplier_payments"."void_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "inventory_supplier_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_suppliers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"name" text NOT NULL,
	"contact_person" text,
	"phone" text,
	"email" text,
	"address" text,
	"note" text,
	"active" boolean DEFAULT true NOT NULL,
	"opening_balance" numeric(12, 2),
	"opening_balance_on" date,
	"currency" char(3) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_suppliers_opening_balance_complete" CHECK (("inventory_suppliers"."opening_balance" is null) = ("inventory_suppliers"."opening_balance_on" is null))
);
--> statement-breakpoint
ALTER TABLE "inventory_suppliers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_source";--> statement-breakpoint
DROP INDEX "expenses_mirror_unique";--> statement-breakpoint
ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_batches" ADD CONSTRAINT "inventory_batches_receipt_id_inventory_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."inventory_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_count_id_inventory_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."inventory_counts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_count_lines" ADD CONSTRAINT "inventory_count_lines_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_item_branches" ADD CONSTRAINT "inventory_item_branches_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_category_id_inventory_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."inventory_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_usual_supplier_id_inventory_suppliers_id_fk" FOREIGN KEY ("usual_supplier_id") REFERENCES "public"."inventory_suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movement_batches" ADD CONSTRAINT "inventory_movement_batches_movement_id_inventory_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movement_batches" ADD CONSTRAINT "inventory_movement_batches_batch_id_inventory_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."inventory_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_receipt_id_inventory_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."inventory_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_receipt_files" ADD CONSTRAINT "inventory_receipt_files_receipt_id_inventory_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."inventory_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_receipts" ADD CONSTRAINT "inventory_receipts_supplier_id_inventory_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."inventory_suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_supplier_adjustments" ADD CONSTRAINT "inventory_supplier_adjustments_supplier_id_inventory_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."inventory_suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_supplier_payments" ADD CONSTRAINT "inventory_supplier_payments_supplier_id_inventory_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."inventory_suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_supplier_payments" ADD CONSTRAINT "inventory_supplier_payments_receipt_id_inventory_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."inventory_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_batches_tenant_idx" ON "inventory_batches" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "inventory_batches_item_idx" ON "inventory_batches" USING btree ("tenant_id","branch_id","item_id");--> statement-breakpoint
CREATE INDEX "inventory_batches_receipt_idx" ON "inventory_batches" USING btree ("receipt_id") WHERE "inventory_batches"."receipt_id" is not null;--> statement-breakpoint
CREATE INDEX "inventory_categories_tenant_idx" ON "inventory_categories" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_categories_key_unique" ON "inventory_categories" USING btree ("tenant_id","key") WHERE "inventory_categories"."key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_categories_name_unique" ON "inventory_categories" USING btree ("tenant_id",lower("name")) WHERE "inventory_categories"."name" is not null;--> statement-breakpoint
CREATE INDEX "inventory_count_lines_tenant_idx" ON "inventory_count_lines" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "inventory_counts_tenant_idx" ON "inventory_counts" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_counts_open_unique" ON "inventory_counts" USING btree ("tenant_id","branch_id") WHERE "inventory_counts"."status" = 'open';--> statement-breakpoint
CREATE INDEX "inventory_item_branches_tenant_idx" ON "inventory_item_branches" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "inventory_item_branches_branch_idx" ON "inventory_item_branches" USING btree ("tenant_id","branch_id");--> statement-breakpoint
CREATE INDEX "inventory_items_tenant_idx" ON "inventory_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_items_name_unique" ON "inventory_items" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_items_code_unique" ON "inventory_items" USING btree ("tenant_id",lower("code")) WHERE "inventory_items"."code" is not null;--> statement-breakpoint
CREATE INDEX "inventory_movement_batches_tenant_idx" ON "inventory_movement_batches" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "inventory_movement_batches_batch_idx" ON "inventory_movement_batches" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_tenant_idx" ON "inventory_movements" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_item_idx" ON "inventory_movements" USING btree ("tenant_id","branch_id","item_id","occurred_on");--> statement-breakpoint
CREATE INDEX "inventory_movements_occurred_idx" ON "inventory_movements" USING btree ("tenant_id","occurred_on","kind");--> statement-breakpoint
CREATE INDEX "inventory_movements_idempotency_idx" ON "inventory_movements" USING btree ("tenant_id","idempotency_key") WHERE "inventory_movements"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_movements_reverses_unique" ON "inventory_movements" USING btree ("reverses_id") WHERE "inventory_movements"."reverses_id" is not null;--> statement-breakpoint
CREATE INDEX "inventory_receipt_files_tenant_idx" ON "inventory_receipt_files" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "inventory_receipt_files_receipt_idx" ON "inventory_receipt_files" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "inventory_receipts_tenant_idx" ON "inventory_receipts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "inventory_receipts_supplier_idx" ON "inventory_receipts" USING btree ("tenant_id","supplier_id","received_on");--> statement-breakpoint
CREATE INDEX "inventory_receipts_received_idx" ON "inventory_receipts" USING btree ("tenant_id","received_on");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_receipts_idempotency_unique" ON "inventory_receipts" USING btree ("tenant_id","idempotency_key") WHERE "inventory_receipts"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "inventory_supplier_adjustments_tenant_idx" ON "inventory_supplier_adjustments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "inventory_supplier_adjustments_supplier_idx" ON "inventory_supplier_adjustments" USING btree ("tenant_id","supplier_id","on_date");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_supplier_adjustments_idempotency_unique" ON "inventory_supplier_adjustments" USING btree ("tenant_id","idempotency_key") WHERE "inventory_supplier_adjustments"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "inventory_supplier_payments_tenant_idx" ON "inventory_supplier_payments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "inventory_supplier_payments_supplier_idx" ON "inventory_supplier_payments" USING btree ("tenant_id","supplier_id","paid_on");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_supplier_payments_idempotency_unique" ON "inventory_supplier_payments" USING btree ("tenant_id","idempotency_key") WHERE "inventory_supplier_payments"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "inventory_suppliers_tenant_idx" ON "inventory_suppliers" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_suppliers_name_unique" ON "inventory_suppliers" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_mirror_unique" ON "expenses" USING btree ("tenant_id","source","source_id") WHERE "expenses"."source" in ('payroll', 'compensation', 'lab', 'supplier');--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_source" CHECK ("expenses"."source" in ('manual', 'fixed', 'payroll', 'compensation', 'lab', 'supplier'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "inventory_batches" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "inventory_categories" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "inventory_count_lines" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "inventory_counts" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "inventory_item_branches" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "inventory_items" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "inventory_movement_batches" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "inventory_movements" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "inventory_receipt_counters" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "inventory_receipt_files" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "inventory_receipts" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "inventory_settings" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "inventory_supplier_adjustments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "inventory_supplier_payments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "inventory_suppliers" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- Never deleted (ADR-0095, ADR-0098): items, suppliers, receipts and counts are deactivated,
-- voided or closed; a batch keeps its history; a movement is only marked reversed; a payment is
-- only voided; an adjustment never changes. Custom categories are deleted while unused and
-- pending attachments are discarded.
REVOKE DELETE, TRUNCATE ON "inventory_items" FROM dcm_app, dcm_admin;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "inventory_item_branches" FROM dcm_app, dcm_admin;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "inventory_suppliers" FROM dcm_app, dcm_admin;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "inventory_receipt_counters" FROM dcm_app, dcm_admin;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "inventory_receipts" FROM dcm_app, dcm_admin;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "inventory_batches" FROM dcm_app, dcm_admin;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "inventory_counts" FROM dcm_app, dcm_admin;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "inventory_count_lines" FROM dcm_app, dcm_admin;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "inventory_movements" FROM dcm_app, dcm_admin;--> statement-breakpoint
GRANT UPDATE ("reversed_at", "reversed_by", "reversal_reason", "updated_at") ON "inventory_movements" TO dcm_app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "inventory_movement_batches" FROM dcm_app, dcm_admin;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "inventory_supplier_payments" FROM dcm_app, dcm_admin;--> statement-breakpoint
GRANT UPDATE ("voided_at", "voided_by", "void_reason", "updated_at") ON "inventory_supplier_payments" TO dcm_app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "inventory_supplier_adjustments" FROM dcm_app, dcm_admin;--> statement-breakpoint
-- Every existing clinic starts with the twelve categories (Part A); new clinics get them at
-- provisioning, and the list adds any that is missing.
INSERT INTO "inventory_categories" ("id", "tenant_id", "key")
SELECT gen_random_uuid(), "tenants"."id", "keys"."key"
FROM "tenants"
CROSS JOIN (VALUES
  ('anaesthetics'), ('restorative'), ('endodontics'), ('prosthetics_impression'),
  ('surgery_implants'), ('orthodontics'), ('hygiene_prevention'), ('sterilisation'),
  ('disposables'), ('instruments_burs'), ('imaging'), ('office_cleaning')
) AS "keys" ("key")
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- The five permissions (ADR-0101): only added. The owner and the admin get all five; the
-- assistant sees stock, takes out, receives and manages it; the dentist and the front desk see
-- stock, take out and receive. No other role or grant changes.
INSERT INTO "role_permissions" ("tenant_id", "role_id", "permission")
SELECT "roles"."tenant_id", "roles"."id", "grants"."permission"
FROM "roles"
JOIN (VALUES
  ('owner', 'inventory:read'), ('owner', 'inventory:write'), ('owner', 'inventory:manage'),
  ('owner', 'inventory:money_read'), ('owner', 'inventory:money_manage'),
  ('admin', 'inventory:read'), ('admin', 'inventory:write'), ('admin', 'inventory:manage'),
  ('admin', 'inventory:money_read'), ('admin', 'inventory:money_manage'),
  ('assistant', 'inventory:read'), ('assistant', 'inventory:write'), ('assistant', 'inventory:manage'),
  ('dentist', 'inventory:read'), ('dentist', 'inventory:write'),
  ('frontdesk', 'inventory:read'), ('frontdesk', 'inventory:write')
) AS "grants" ("role_key", "permission") ON "grants"."role_key" = "roles"."key"
WHERE "roles"."system"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_template_permissions" ("template_id", "permission")
SELECT "role_templates"."id", "grants"."permission"
FROM "role_templates"
JOIN (VALUES
  ('owner', 'inventory:read'), ('owner', 'inventory:write'), ('owner', 'inventory:manage'),
  ('owner', 'inventory:money_read'), ('owner', 'inventory:money_manage'),
  ('admin', 'inventory:read'), ('admin', 'inventory:write'), ('admin', 'inventory:manage'),
  ('admin', 'inventory:money_read'), ('admin', 'inventory:money_manage'),
  ('assistant', 'inventory:read'), ('assistant', 'inventory:write'), ('assistant', 'inventory:manage'),
  ('dentist', 'inventory:read'), ('dentist', 'inventory:write'),
  ('frontdesk', 'inventory:read'), ('frontdesk', 'inventory:write')
) AS "grants" ("role_key", "permission") ON "grants"."role_key" = "role_templates"."key"
ON CONFLICT DO NOTHING;
