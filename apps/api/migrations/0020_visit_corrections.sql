CREATE TABLE "visit_amendments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"reason" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"delta" numeric(12, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"amended_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visit_amendments_sequence_positive" CHECK ("visit_amendments"."sequence" >= 1),
	CONSTRAINT "visit_amendments_reason_length" CHECK (char_length("visit_amendments"."reason") >= 3)
);
--> statement-breakpoint
ALTER TABLE "visit_amendments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "visit_counters" (
	"tenant_id" uuid PRIMARY KEY DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"last_value" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "visit_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "visits" DROP CONSTRAINT "visits_completed_fields";--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "display_number" integer;--> statement-breakpoint
-- Backfill (feature 4b, D9): existing visits are numbered per tenant in start order, discarded
-- ones included, and each tenant's counter continues from there.
UPDATE "visits" SET "display_number" = numbered."n"
FROM (
	SELECT "id", row_number() OVER (PARTITION BY "tenant_id" ORDER BY "started_at", "id") AS "n"
	FROM "visits"
) AS numbered
WHERE "visits"."id" = numbered."id";--> statement-breakpoint
INSERT INTO "visit_counters" ("tenant_id", "last_value")
SELECT "tenant_id", max("display_number") FROM "visits" GROUP BY "tenant_id";--> statement-breakpoint
ALTER TABLE "visits" ALTER COLUMN "display_number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "voided_by" uuid;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "void_reason" text;--> statement-breakpoint
ALTER TABLE "visit_amendments" ADD CONSTRAINT "visit_amendments_visit_fk" FOREIGN KEY ("tenant_id","visit_id") REFERENCES "public"."visits"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visit_amendments_tenant_idx" ON "visit_amendments" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "visit_amendments_sequence_unique" ON "visit_amendments" USING btree ("tenant_id","visit_id","sequence");--> statement-breakpoint
CREATE INDEX "visits_branch_started_idx" ON "visits" USING btree ("tenant_id","branch_id","started_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_display_number_unique" UNIQUE("tenant_id","display_number");--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_voided_fields" CHECK (("visits"."status"::text = 'voided') = ("visits"."voided_at" is not null and "visits"."voided_by" is not null and "visits"."void_reason" is not null));--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_void_reason_length" CHECK ("visits"."void_reason" is null or char_length("visits"."void_reason") >= 3);--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_completed_fields" CHECK ("visits"."status"::text not in ('completed', 'amended', 'voided') or ("visits"."completed_at" is not null and "visits"."completed_by" is not null and "visits"."duration_minutes" is not null and "visits"."subtotal" is not null and "visits"."discount_amount" is not null and "visits"."total" is not null));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "visit_amendments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "visit_counters" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- Amendments are append-only (ADR-0025), like the ledger (0011) and the audit log (0001): the
-- runtime roles lose UPDATE, DELETE and TRUNCATE granted by default privileges (0000).
REVOKE UPDATE, DELETE, TRUNCATE ON "visit_amendments" FROM dcm_app, dcm_admin;
