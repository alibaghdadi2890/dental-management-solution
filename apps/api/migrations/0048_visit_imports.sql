ALTER TABLE "visits" ADD COLUMN "imported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "visits" ADD COLUMN "external_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "visits_external_id_unique" ON "visits" USING btree ("tenant_id","external_id") WHERE "visits"."external_id" is not null;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_imported_completed" CHECK (("visits"."imported_at" is null and "visits"."external_id" is null) or ("visits"."imported_at" is not null and "visits"."external_id" is not null and "visits"."status"::text = 'completed'));