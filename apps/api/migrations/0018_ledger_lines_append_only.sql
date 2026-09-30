-- Visit charge lines are append-only like the entries they belong to (0011_ledger_append_only):
-- the runtime roles lose UPDATE, DELETE and TRUNCATE (granted by default privileges, 0000). A
-- merge re-point moves the entry, never a line. `ledger_entries.visit_id` needs no statement:
-- 0011 left dcm_app UPDATE on `patient_id` and `updated_at` only, so it can't be rewritten.
REVOKE UPDATE, DELETE, TRUNCATE ON "ledger_entry_lines" FROM dcm_app, dcm_admin;
