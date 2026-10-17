CREATE TABLE "payment_holds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"released_at" timestamp with time zone,
	"released_kind" text,
	"released_by" uuid,
	"release_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_holds_release_complete" CHECK (("payment_holds"."released_at" is null) = ("payment_holds"."released_kind" is null) and ("payment_holds"."released_at" is null) = ("payment_holds"."released_by" is null)),
	CONSTRAINT "payment_holds_reason_iff_manual" CHECK (("payment_holds"."release_reason" is not null) = ("payment_holds"."released_kind" is not distinct from 'manual'))
);
--> statement-breakpoint
ALTER TABLE "payment_holds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "visit_plan_shares" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid DEFAULT nullif(current_setting('app.tenant_id', true), '')::uuid NOT NULL,
	"visit_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visit_plan_shares_amount_non_negative" CHECK ("visit_plan_shares"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "visit_plan_shares" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "advance" text;--> statement-breakpoint
ALTER TABLE "payment_holds" ADD CONSTRAINT "payment_holds_payment_fk" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "public"."payments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payment_holds_tenant_idx" ON "payment_holds" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_holds_payment_unique" ON "payment_holds" USING btree ("tenant_id","payment_id");--> statement-breakpoint
CREATE INDEX "visit_plan_shares_tenant_idx" ON "visit_plan_shares" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "visit_plan_shares_visit_unique" ON "visit_plan_shares" USING btree ("tenant_id","visit_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_advance_only_on_payment" CHECK ("payments"."advance" is null or "payments"."kind"::text = 'payment');--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payment_holds" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "visit_plan_shares" AS PERMISSIVE FOR ALL TO public USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
-- A hold is written once and released once (ADR-0051): the runtime role may set only the release
-- columns, and may never delete one. `visit_plan_shares` is a cache and keeps the default grants.
REVOKE UPDATE, DELETE, TRUNCATE ON "payment_holds" FROM dcm_app, dcm_admin;--> statement-breakpoint
GRANT UPDATE ("released_at", "released_kind", "released_by", "release_reason", "updated_at") ON "payment_holds" TO dcm_app;
--> statement-breakpoint
-- Visits charged before this migration get their plan share (ADR-0051): Σ base − line discount of
-- their services that perform a plan item, so money held for the plan can cover what they owe.
INSERT INTO "visit_plan_shares" ("id", "tenant_id", "visit_id", "amount", "currency")
SELECT gen_random_uuid(), v."tenant_id", v."id", sum(s."base_amount" - s."discount_amount"), v."currency"
FROM "visits" v
JOIN "visit_services" s ON s."tenant_id" = v."tenant_id" AND s."visit_id" = v."id"
WHERE v."status"::text IN ('completed', 'amended')
  AND s."plan_id" IS NOT NULL
  AND s."deleted_at" IS NULL
GROUP BY v."tenant_id", v."id", v."currency";
