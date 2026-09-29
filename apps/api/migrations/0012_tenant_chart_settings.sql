CREATE TYPE "public"."chart_mode" AS ENUM('surface', 'simple');--> statement-breakpoint
CREATE TYPE "public"."chart_orientation" AS ENUM('patient_right_on_right', 'patient_right_on_left');--> statement-breakpoint
CREATE TYPE "public"."tooth_notation" AS ENUM('fdi', 'universal');--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "chart_mode" chart_mode DEFAULT 'surface' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "tooth_notation" "tooth_notation" DEFAULT 'fdi' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "chart_orientation" chart_orientation DEFAULT 'patient_right_on_right' NOT NULL;