CREATE TYPE "public"."visit_amendment_kind" AS ENUM('amendment', 'checkout_discount');--> statement-breakpoint
ALTER TABLE "visit_amendments" DROP CONSTRAINT "visit_amendments_reason_length";--> statement-breakpoint
ALTER TABLE "visit_amendments" ALTER COLUMN "reason" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "visit_amendments" ADD COLUMN "kind" "visit_amendment_kind" DEFAULT 'amendment' NOT NULL;--> statement-breakpoint
ALTER TABLE "visit_amendments" ADD CONSTRAINT "visit_amendments_reason_length" CHECK (("visit_amendments"."kind"::text = 'checkout_discount' and "visit_amendments"."reason" is null) or ("visit_amendments"."reason" is not null and char_length("visit_amendments"."reason") >= 3));--> statement-breakpoint
-- visit:discount (checkout handoff, C2): the system roles seeded before it get the grant. Runs as
-- the schema owner: every tenant's rows.
INSERT INTO "role_permissions" ("tenant_id", "role_id", "permission")
SELECT "tenant_id", "id", 'visit:discount' FROM "roles"
WHERE "system" AND "key" IN ('owner', 'dentist', 'frontdesk')
ON CONFLICT DO NOTHING;
