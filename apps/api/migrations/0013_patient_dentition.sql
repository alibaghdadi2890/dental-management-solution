CREATE TYPE "public"."dentition" AS ENUM('primary', 'mixed', 'permanent');--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "dentition_override" "dentition";