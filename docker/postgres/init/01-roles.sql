-- Local development / test roles. Production roles and secrets are provisioned by ops, not here.
-- dcm_owner (POSTGRES_USER) owns the schema and runs migrations.
-- dcm_app is the runtime role: not a table owner, so row-level security always applies.
-- dcm_admin bypasses RLS and is reachable only through withoutTenant().
CREATE ROLE dcm_app LOGIN PASSWORD 'dcm_app';
CREATE ROLE dcm_admin LOGIN PASSWORD 'dcm_admin' BYPASSRLS;
