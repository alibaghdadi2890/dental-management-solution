CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"key" text,
	"name" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_categories_key_or_name" CHECK (("expense_categories"."key" is null) <> ("expense_categories"."name" is null))
);
--> statement-breakpoint
ALTER TABLE "expense_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"spent_on" date NOT NULL,
	"category_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"method" text NOT NULL,
	"payee" text,
	"reference" text,
	"description" text,
	"branch_id" uuid,
	"source" text NOT NULL,
	"source_id" uuid,
	"source_month" char(7),
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"idempotency_key" uuid,
	"idempotency_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_amount_positive" CHECK ("expenses"."amount" > 0),
	CONSTRAINT "expenses_method" CHECK ("expenses"."method" in ('cash', 'card', 'bank_transfer', 'whish', 'insurance')),
	CONSTRAINT "expenses_source" CHECK ("expenses"."source" in ('manual', 'fixed', 'payroll', 'compensation')),
	CONSTRAINT "expenses_source_id" CHECK (("expenses"."source" = 'manual') = ("expenses"."source_id" is null)),
	CONSTRAINT "expenses_source_month_format" CHECK ("expenses"."source_month" is null or "expenses"."source_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "expenses_void_complete" CHECK (("expenses"."voided_at" is null) = ("expenses"."voided_by" is null) and ("expenses"."voided_at" is null) = ("expenses"."void_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fixed_expense_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"fixed_expense_id" uuid NOT NULL,
	"month" char(7) NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"method" text,
	"payee" text,
	"branch_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"expense_id" uuid,
	"skip_reason" text,
	"skipped_at" timestamp with time zone,
	"skipped_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fixed_expense_items_status" CHECK ("fixed_expense_items"."status" in ('pending', 'confirmed', 'skipped')),
	CONSTRAINT "fixed_expense_items_month_format" CHECK ("fixed_expense_items"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "fixed_expense_items_confirmed" CHECK (("fixed_expense_items"."status" = 'confirmed') = ("fixed_expense_items"."expense_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "fixed_expense_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fixed_expenses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"method" text,
	"payee" text,
	"branch_id" uuid,
	"note" text,
	"first_month" char(7) NOT NULL,
	"next_month" char(7) NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fixed_expenses_amount_positive" CHECK ("fixed_expenses"."amount" > 0),
	CONSTRAINT "fixed_expenses_status" CHECK ("fixed_expenses"."status" in ('active', 'paused', 'ended')),
	CONSTRAINT "fixed_expenses_month_format" CHECK ("fixed_expenses"."first_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' and "fixed_expenses"."next_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "fixed_expenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "employee_salaries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"effective_month" char(7) NOT NULL,
	"reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_salaries_amount_positive" CHECK ("employee_salaries"."amount" > 0),
	CONSTRAINT "employee_salaries_month_format" CHECK ("employee_salaries"."effective_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "employee_salaries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"full_name" text NOT NULL,
	"job_title" text,
	"phone" text,
	"email" text,
	"hire_date" date NOT NULL,
	"payroll_from" char(7) NOT NULL,
	"branch_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"end_date" date,
	"note" text,
	"staff_profile_id" uuid,
	"created_by" uuid NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_status" CHECK ("employees"."status" in ('active', 'left')),
	CONSTRAINT "employees_left_has_end" CHECK (("employees"."status" = 'left') = ("employees"."end_date" is not null)),
	CONSTRAINT "employees_end_after_hire" CHECK ("employees"."end_date" is null or "employees"."end_date" >= "employees"."hire_date"),
	CONSTRAINT "employees_payroll_from_format" CHECK ("employees"."payroll_from" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll_adjustments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_adjustments_kind" CHECK ("payroll_adjustments"."kind" in ('bonus', 'deduction', 'other'))
);
--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"month" char(7) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"skip_reason" text,
	"skipped_at" timestamp with time zone,
	"skipped_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_lines_status" CHECK ("payroll_lines"."status" in ('pending', 'paid', 'skipped')),
	CONSTRAINT "payroll_lines_month_format" CHECK ("payroll_lines"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "payroll_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"line_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"month" char(7) NOT NULL,
	"base" numeric(12, 2) NOT NULL,
	"adjustments" jsonb NOT NULL,
	"net" numeric(12, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"paid_on" date NOT NULL,
	"method" text NOT NULL,
	"note" text,
	"created_by" uuid NOT NULL,
	"idempotency_key" uuid,
	"idempotency_hash" text,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"void_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_payments_net_positive" CHECK ("payroll_payments"."net" > 0),
	CONSTRAINT "payroll_payments_method" CHECK ("payroll_payments"."method" in ('cash', 'card', 'bank_transfer', 'whish', 'insurance')),
	CONSTRAINT "payroll_payments_void_complete" CHECK (("payroll_payments"."voided_at" is null) = ("payroll_payments"."voided_by" is null) and ("payroll_payments"."voided_at" is null) = ("payroll_payments"."void_reason" is null))
);
--> statement-breakpoint
ALTER TABLE "payroll_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_expense_items" ADD CONSTRAINT "fixed_expense_items_fixed_expense_id_fixed_expenses_id_fk" FOREIGN KEY ("fixed_expense_id") REFERENCES "public"."fixed_expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_expense_items" ADD CONSTRAINT "fixed_expense_items_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_expense_items" ADD CONSTRAINT "fixed_expense_items_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fixed_expenses" ADD CONSTRAINT "fixed_expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_line_id_payroll_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."payroll_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_line_id_payroll_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."payroll_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_payments" ADD CONSTRAINT "payroll_payments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_categories_tenant_idx" ON "expense_categories" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_categories_key_unique" ON "expense_categories" USING btree ("tenant_id","key") WHERE "expense_categories"."key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_categories_name_unique" ON "expense_categories" USING btree ("tenant_id",lower("name")) WHERE "expense_categories"."name" is not null;--> statement-breakpoint
CREATE INDEX "expenses_tenant_idx" ON "expenses" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "expenses_spent_on_idx" ON "expenses" USING btree ("tenant_id","spent_on");--> statement-breakpoint
CREATE INDEX "expenses_idempotency_idx" ON "expenses" USING btree ("tenant_id","idempotency_key") WHERE "expenses"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_manual_idempotency_unique" ON "expenses" USING btree ("tenant_id","idempotency_key") WHERE "expenses"."idempotency_key" is not null and "expenses"."source" = 'manual';--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_mirror_unique" ON "expenses" USING btree ("tenant_id","source","source_id") WHERE "expenses"."source" in ('payroll', 'compensation');--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_fixed_live_unique" ON "expenses" USING btree ("tenant_id","source_id") WHERE "expenses"."source" = 'fixed' and "expenses"."voided_at" is null;--> statement-breakpoint
CREATE INDEX "fixed_expense_items_tenant_idx" ON "fixed_expense_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "fixed_expense_items_status_idx" ON "fixed_expense_items" USING btree ("tenant_id","status","month");--> statement-breakpoint
CREATE UNIQUE INDEX "fixed_expense_items_month_unique" ON "fixed_expense_items" USING btree ("fixed_expense_id","month");--> statement-breakpoint
CREATE INDEX "fixed_expenses_tenant_idx" ON "fixed_expenses" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "employee_salaries_tenant_idx" ON "employee_salaries" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "employee_salaries_employee_idx" ON "employee_salaries" USING btree ("tenant_id","employee_id");--> statement-breakpoint
CREATE INDEX "employees_tenant_idx" ON "employees" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_staff_profile_unique" ON "employees" USING btree ("tenant_id","staff_profile_id") WHERE "employees"."staff_profile_id" is not null and "employees"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "payroll_adjustments_tenant_idx" ON "payroll_adjustments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payroll_adjustments_line_idx" ON "payroll_adjustments" USING btree ("tenant_id","line_id");--> statement-breakpoint
CREATE INDEX "payroll_lines_tenant_idx" ON "payroll_lines" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_lines_month_unique" ON "payroll_lines" USING btree ("tenant_id","employee_id","month");--> statement-breakpoint
CREATE INDEX "payroll_payments_tenant_idx" ON "payroll_payments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payroll_payments_employee_idx" ON "payroll_payments" USING btree ("tenant_id","employee_id","month");--> statement-breakpoint
CREATE INDEX "payroll_payments_idempotency_idx" ON "payroll_payments" USING btree ("tenant_id","idempotency_key") WHERE "payroll_payments"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_payments_live_unique" ON "payroll_payments" USING btree ("tenant_id","line_id") WHERE "payroll_payments"."voided_at" is null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "expense_categories" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "expenses" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fixed_expense_items" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fixed_expenses" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "employee_salaries" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "employees" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payroll_adjustments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payroll_lines" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payroll_payments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- Append-only (ADR-0076, ADR-0079): expenses are edited and voided, never deleted; items and
-- templates are never deleted; a salary entry never changes; a payroll payment is only voided.
-- A custom category never used may be deleted, and a pending line's adjustments are replaced.
REVOKE DELETE, TRUNCATE ON "expenses" FROM dcm_app, dcm_admin;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "fixed_expenses" FROM dcm_app, dcm_admin;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "fixed_expense_items" FROM dcm_app, dcm_admin;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "employees" FROM dcm_app, dcm_admin;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "payroll_lines" FROM dcm_app, dcm_admin;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "employee_salaries" FROM dcm_app, dcm_admin;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "payroll_payments" FROM dcm_app, dcm_admin;--> statement-breakpoint
GRANT UPDATE ("voided_at", "voided_by", "void_reason", "updated_at") ON "payroll_payments" TO dcm_app;--> statement-breakpoint
-- Every clinic's starting categories (D7): the predefined list, Other, and the two reserved ones.
-- New clinics get them at provisioning; runs as the schema owner, every tenant. Idempotent.
INSERT INTO "expense_categories" ("id", "tenant_id", "key")
SELECT gen_random_uuid(), "tenants"."id", "keys"."key"
FROM "tenants"
CROSS JOIN (VALUES
  ('rent'), ('electricity'), ('water'), ('internet_phone'), ('supplies'), ('lab_fees'),
  ('equipment'), ('cleaning'), ('marketing'), ('software'), ('taxes_fees'), ('insurance'),
  ('professional_fees'), ('transport'), ('other'), ('salaries'), ('dentist_compensation')
) AS "keys" ("key")
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- The payouts recorded before this feature, mirrored as read-only Dentist compensation rows
-- (P2, ADR-0076), voided ones voided. A one-off read across modules, as the schema owner; at
-- runtime `expenses` learns of payouts only from `compensation`'s events.
INSERT INTO "expenses" (
  "id", "tenant_id", "spent_on", "category_id", "amount", "currency", "method", "payee",
  "reference", "description", "source", "source_id", "created_by", "voided_at", "voided_by",
  "void_reason", "created_at", "updated_at"
)
SELECT gen_random_uuid(), "p"."tenant_id", "p"."paid_on", "c"."id", "p"."amount", "p"."currency",
  "p"."method", "s"."display_name", "p"."reference", "p"."note", 'compensation', "p"."id",
  "p"."created_by", "p"."voided_at", "p"."voided_by", "p"."void_reason", "p"."created_at",
  "p"."created_at"
FROM "compensation_payouts" AS "p"
JOIN "expense_categories" AS "c"
  ON "c"."tenant_id" = "p"."tenant_id" AND "c"."key" = 'dentist_compensation'
LEFT JOIN "staff_profiles" AS "s" ON "s"."id" = "p"."staff_profile_id"
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- The four permissions (ADR-0080): only added, to every clinic's owner and admin and to their two
-- platform templates. No other role or grant changes.
INSERT INTO "role_permissions" ("tenant_id", "role_id", "permission")
SELECT "roles"."tenant_id", "roles"."id", "grants"."permission"
FROM "roles"
CROSS JOIN (VALUES ('expense:read'), ('expense:manage'), ('payroll:read'), ('payroll:manage'))
  AS "grants" ("permission")
WHERE "roles"."system" AND "roles"."key" IN ('owner', 'admin')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_template_permissions" ("template_id", "permission")
SELECT "role_templates"."id", "grants"."permission"
FROM "role_templates"
CROSS JOIN (VALUES ('expense:read'), ('expense:manage'), ('payroll:read'), ('payroll:manage'))
  AS "grants" ("permission")
WHERE "role_templates"."key" IN ('owner', 'admin')
ON CONFLICT DO NOTHING;
