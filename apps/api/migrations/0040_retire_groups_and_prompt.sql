-- Feature 10: named plan groups and the once-per-visit unfinished prompt are retired (ADR-0045,
-- ADR-0048). The foreign key goes before its target table.
ALTER TABLE "treatment_plans" DROP CONSTRAINT "treatment_plans_group_fk";--> statement-breakpoint
ALTER TABLE "treatment_plans" DROP COLUMN "group_id";--> statement-breakpoint
DROP POLICY "tenant_isolation" ON "plan_groups";--> statement-breakpoint
DROP TABLE "plan_groups";--> statement-breakpoint
ALTER TABLE "visits" DROP COLUMN "unfinished_answered_at";
