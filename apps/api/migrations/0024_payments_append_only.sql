-- Payments and their allocations are append-only like the ledger (0011_ledger_append_only):
-- corrections are new rows (a refund or void, a negative allocation). The runtime roles lose
-- UPDATE, DELETE and TRUNCATE (granted by default privileges, 0000). The merge re-point may move a
-- payment to the kept patient: dcm_app keeps UPDATE on patient_id and updated_at only.
REVOKE UPDATE, DELETE, TRUNCATE ON "payments" FROM dcm_app, dcm_admin;
--> statement-breakpoint
GRANT UPDATE ("patient_id", "updated_at") ON "payments" TO dcm_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "payment_allocations" FROM dcm_app, dcm_admin;
