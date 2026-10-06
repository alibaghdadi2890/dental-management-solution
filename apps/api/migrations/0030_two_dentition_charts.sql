ALTER TABLE "patients" ALTER COLUMN "dentition_override" SET DATA TYPE text;--> statement-breakpoint
-- The mixed chart is gone: every patient has a primary and a permanent chart. A patient set to
-- `mixed` by hand goes back to the chart their age opens on. Runs as the schema owner: every
-- tenant's rows.
UPDATE "patients" SET "dentition_override" = NULL WHERE "dentition_override" = 'mixed';--> statement-breakpoint
DROP TYPE "public"."dentition";--> statement-breakpoint
CREATE TYPE "public"."dentition" AS ENUM('primary', 'permanent');--> statement-breakpoint
ALTER TABLE "patients" ALTER COLUMN "dentition_override" SET DATA TYPE "public"."dentition" USING "dentition_override"::"public"."dentition";