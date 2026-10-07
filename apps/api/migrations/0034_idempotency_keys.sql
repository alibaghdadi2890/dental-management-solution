ALTER TABLE "ledger_entries" ADD COLUMN "idempotency_key" uuid;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "idempotency_hash" text;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "idempotency_key" uuid;--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "idempotency_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_idempotency_key_unique" ON "ledger_entries" USING btree ("tenant_id","idempotency_key") WHERE "ledger_entries"."idempotency_key" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "patients_idempotency_key_unique" ON "patients" USING btree ("tenant_id","idempotency_key") WHERE "patients"."idempotency_key" is not null;