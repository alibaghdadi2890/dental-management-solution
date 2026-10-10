ALTER TABLE "diagnoses" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "diagnoses" ADD COLUMN "mark_priority" smallint DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "procedures" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "procedures" ADD COLUMN "icon" text;--> statement-breakpoint
ALTER TABLE "procedures" ADD COLUMN "mark_priority" smallint DEFAULT 5 NOT NULL;--> statement-breakpoint
-- Feature 9 (ADR-0042): existing catalogs get a chart colour, the palette in order, round-robin
-- by catalog order, per tenant. Every diagnosis (removed ones too: old records still point at
-- them) and every per-tooth service; icons stay empty.
UPDATE "diagnoses" AS d
SET "color" = (ARRAY['rose', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'teal', 'cyan', 'sky', 'blue', 'violet', 'purple', 'magenta', 'pink', 'brown'])[1 + (r.n - 1) % 16]
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "tenant_id" ORDER BY "created_at", "id") AS n
  FROM "diagnoses"
) AS r
WHERE r."id" = d."id";--> statement-breakpoint
UPDATE "procedures" AS p
SET "color" = (ARRAY['rose', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'teal', 'cyan', 'sky', 'blue', 'violet', 'purple', 'magenta', 'pink', 'brown'])[1 + (r.n - 1) % 16]
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "tenant_id" ORDER BY "created_at", "id") AS n
  FROM "procedures"
  WHERE "charge_unit" = 'per_tooth'
) AS r
WHERE r."id" = p."id";--> statement-breakpoint
ALTER TABLE "diagnoses" ALTER COLUMN "color" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_color_known" CHECK ("diagnoses"."color" in ('rose', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'teal', 'cyan', 'sky', 'blue', 'violet', 'purple', 'magenta', 'pink', 'brown'));--> statement-breakpoint
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_mark_priority_range" CHECK ("diagnoses"."mark_priority" between 0 and 9);--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_color_known" CHECK ("procedures"."color" in ('rose', 'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'teal', 'cyan', 'sky', 'blue', 'violet', 'purple', 'magenta', 'pink', 'brown'));--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_icon_known" CHECK ("procedures"."icon" in ('filling', 'crown', 'root_canal', 'extraction', 'implant', 'bridge', 'veneer', 'sealant', 'post_core', 'denture', 'cleaning', 'whitening'));--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_mark_per_tooth" CHECK ("procedures"."charge_unit" <> 'per_tooth' or "procedures"."color" is not null);--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_mark_priority_range" CHECK ("procedures"."mark_priority" between 0 and 9);