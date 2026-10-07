ALTER TABLE "audit_log" ADD COLUMN "patient_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "visit_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "area" text;--> statement-breakpoint
CREATE INDEX "audit_log_tenant_area_idx" ON "audit_log" USING btree ("tenant_id","area","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "audit_log"."area" is not null;--> statement-breakpoint
CREATE INDEX "audit_log_tenant_patient_idx" ON "audit_log" USING btree ("tenant_id","patient_id","occurred_at" DESC NULLS LAST) WHERE "audit_log"."patient_id" is not null;--> statement-breakpoint
-- Backfill (feature 7, H7; ADR-0037). The runtime roles cannot update `audit_log`; this runs as
-- the schema owner, once. Rows keep everything they had: only the three new columns are filled.
-- The area comes from the action's first segment (contracts' `areaOfAction`); stored domain
-- events have no dot in their name and stay without one.
UPDATE "audit_log" SET "area" = CASE split_part("action", '.', 1)
    WHEN 'patient' THEN 'patients'
    WHEN 'contact' THEN 'contacts'
    WHEN 'visit' THEN 'visits'
    WHEN 'visit_service' THEN 'visits'
    WHEN 'diagnosis_record' THEN 'visits'
    WHEN 'treatment_plan' THEN 'visits'
    WHEN 'plan_group' THEN 'visits'
    WHEN 'tooth_status' THEN 'visits'
    WHEN 'clinical' THEN 'visits'
    WHEN 'payment' THEN 'payments'
    WHEN 'ledger_entry' THEN 'payments'
    WHEN 'catalog' THEN 'catalog'
    WHEN 'user' THEN 'users'
    WHEN 'role' THEN 'users'
    WHEN 'tenant' THEN 'settings'
    WHEN 'branch' THEN 'settings'
    WHEN 'room' THEN 'settings'
  END
WHERE "resource_type" <> 'event'
  AND position('.' in "action") > 1
  -- A payment's or a visit charge's ledger entry only shadows the payment or the visit change.
  AND NOT ("action" = 'ledger_entry.create'
           AND coalesce("after"->>'kind', '') NOT IN ('opening_balance', 'adjustment'));--> statement-breakpoint
UPDATE "audit_log" SET
  "patient_id" = CASE
    WHEN "resource_type" = 'patient' AND "resource_id" ~ '^[0-9a-f-]{36}$' THEN "resource_id"::uuid
    WHEN "after"->>'patientId' ~ '^[0-9a-f-]{36}$' THEN ("after"->>'patientId')::uuid
    WHEN "before"->>'patientId' ~ '^[0-9a-f-]{36}$' THEN ("before"->>'patientId')::uuid
  END,
  "visit_id" = CASE
    WHEN "resource_type" = 'visit' AND "resource_id" ~ '^[0-9a-f-]{36}$' THEN "resource_id"::uuid
    WHEN "after"->>'visitId' ~ '^[0-9a-f-]{36}$' THEN ("after"->>'visitId')::uuid
    WHEN "before"->>'visitId' ~ '^[0-9a-f-]{36}$' THEN ("before"->>'visitId')::uuid
  END;--> statement-breakpoint
-- Rows that name only their own record: a service's visit, then each record's patient.
UPDATE "audit_log" AS a SET "visit_id" = s."visit_id"
FROM "visit_services" AS s
WHERE a."resource_type" = 'visit_service' AND a."visit_id" IS NULL
  AND a."tenant_id" = s."tenant_id" AND a."resource_id" = s."id"::text;--> statement-breakpoint
UPDATE "audit_log" AS a SET "patient_id" = v."patient_id"
FROM "visits" AS v
WHERE a."patient_id" IS NULL AND a."visit_id" = v."id" AND a."tenant_id" = v."tenant_id";--> statement-breakpoint
UPDATE "audit_log" AS a SET "patient_id" = p."patient_id"
FROM "treatment_plans" AS p
WHERE a."resource_type" = 'treatment_plan' AND a."patient_id" IS NULL
  AND a."tenant_id" = p."tenant_id" AND a."resource_id" = p."id"::text;--> statement-breakpoint
UPDATE "audit_log" AS a SET "patient_id" = d."patient_id"
FROM "patient_diagnoses" AS d
WHERE a."resource_type" = 'diagnosis_record' AND a."patient_id" IS NULL
  AND a."tenant_id" = d."tenant_id" AND a."resource_id" = d."id"::text;--> statement-breakpoint
UPDATE "audit_log" AS a SET "patient_id" = g."patient_id"
FROM "plan_groups" AS g
WHERE a."resource_type" = 'plan_group' AND a."patient_id" IS NULL
  AND a."tenant_id" = g."tenant_id" AND a."resource_id" = g."id"::text;--> statement-breakpoint
UPDATE "audit_log" AS a SET "patient_id" = t."patient_id"
FROM "tooth_status" AS t
WHERE a."resource_type" = 'tooth_status' AND a."patient_id" IS NULL
  AND a."tenant_id" = t."tenant_id" AND a."resource_id" = t."id"::text;
