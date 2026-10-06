CREATE TYPE "public"."jaw" AS ENUM('upper', 'lower');--> statement-breakpoint
-- Hand-written in place of `ALTER TYPE ... ADD VALUE 'per_mouth'`: a value added that way cannot be
-- written in the same transaction, and the rows below need it. The type is rebuilt instead, and
-- the columns converted in one pass: today's `per_jaw` rows carry no jaw and behave as whole
-- mouth, so they become `per_mouth` (spec L3).
ALTER TABLE "treatment_plans" DROP CONSTRAINT "treatment_plans_tooth_matches_unit";--> statement-breakpoint
ALTER TABLE "visit_services" DROP CONSTRAINT "visit_services_tooth_matches_unit";--> statement-breakpoint
ALTER TYPE "public"."charge_unit" RENAME TO "charge_unit_old";--> statement-breakpoint
CREATE TYPE "public"."charge_unit" AS ENUM('per_tooth', 'per_jaw', 'per_mouth');--> statement-breakpoint
ALTER TABLE "procedures" ALTER COLUMN "charge_unit" TYPE "public"."charge_unit" USING (case when "charge_unit"::text = 'per_jaw' then 'per_mouth' else "charge_unit"::text end)::"public"."charge_unit";--> statement-breakpoint
ALTER TABLE "treatment_plans" ALTER COLUMN "charge_unit" TYPE "public"."charge_unit" USING (case when "charge_unit"::text = 'per_jaw' then 'per_mouth' else "charge_unit"::text end)::"public"."charge_unit";--> statement-breakpoint
ALTER TABLE "visit_services" ALTER COLUMN "charge_unit" TYPE "public"."charge_unit" USING (case when "charge_unit"::text = 'per_jaw' then 'per_mouth' else "charge_unit"::text end)::"public"."charge_unit";--> statement-breakpoint
DROP TYPE "public"."charge_unit_old";--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_tooth_matches_unit" CHECK (("treatment_plans"."tooth_code" is not null) = ("treatment_plans"."charge_unit" = 'per_tooth'));--> statement-breakpoint
ALTER TABLE "visit_services" ADD CONSTRAINT "visit_services_tooth_matches_unit" CHECK (("visit_services"."tooth_code" is not null) = ("visit_services"."charge_unit" = 'per_tooth'));--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD COLUMN "jaw" "jaw";--> statement-breakpoint
ALTER TABLE "visit_services" ADD COLUMN "jaw" "jaw";--> statement-breakpoint
ALTER TABLE "treatment_plans" ADD CONSTRAINT "treatment_plans_jaw_matches_unit" CHECK (("treatment_plans"."jaw" is not null) = ("treatment_plans"."charge_unit"::text = 'per_jaw'));--> statement-breakpoint
ALTER TABLE "visit_services" ADD CONSTRAINT "visit_services_jaw_matches_unit" CHECK (("visit_services"."jaw" is not null) = ("visit_services"."charge_unit"::text = 'per_jaw'));
