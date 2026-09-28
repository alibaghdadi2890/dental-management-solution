-- Ledger entries are append-only (docs/modules/billing.md): the runtime roles lose UPDATE, DELETE
-- and TRUNCATE (granted by default privileges, 0000), as audit_log does (0001). The one update
-- the app makes — the merge re-point moving entries to the kept patient — may change only
-- patient_id and updated_at; the amount, currency, kind and author can never be rewritten.
REVOKE UPDATE, DELETE, TRUNCATE ON "ledger_entries" FROM dcm_app, dcm_admin;
--> statement-breakpoint
GRANT UPDATE ("patient_id", "updated_at") ON "ledger_entries" TO dcm_app;
