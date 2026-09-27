CREATE TYPE "public"."charge_unit" AS ENUM('per_tooth', 'per_jaw');--> statement-breakpoint
CREATE TABLE "diagnoses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"frequent" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "diagnoses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "procedures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"charge_unit" charge_unit NOT NULL,
	"price_amount" numeric(12, 2) NOT NULL,
	"price_currency" char(3) NOT NULL,
	"frequent" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "procedures_price_non_negative" CHECK ("procedures"."price_amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "procedures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "diagnoses_tenant_idx" ON "diagnoses" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "diagnoses_code_unique" ON "diagnoses" USING btree ("tenant_id",lower("code")) WHERE "diagnoses"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "procedures_tenant_idx" ON "procedures" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "procedures_code_unique" ON "procedures" USING btree ("tenant_id",lower("code")) WHERE "procedures"."deleted_at" is null;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "diagnoses" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "procedures" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);