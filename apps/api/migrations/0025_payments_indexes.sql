DROP INDEX "payments_receipt_unique";--> statement-breakpoint
DROP INDEX "payments_idempotency_unique";--> statement-breakpoint
CREATE INDEX "payments_receipt_idx" ON "payments" USING btree ("tenant_id","receipt_number") WHERE "payments"."reverses_payment_id" is null;--> statement-breakpoint
CREATE INDEX "payments_idempotency_idx" ON "payments" USING btree ("tenant_id","idempotency_key") WHERE "payments"."idempotency_key" is not null;