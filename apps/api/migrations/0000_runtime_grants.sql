-- Runtime roles get DML on every table the owner creates from now on. They never own tables,
-- so row-level security always applies to dcm_app. dcm_admin has BYPASSRLS (withoutTenant()).
-- Append-only tables (audit) revoke UPDATE/DELETE in their own migration.
GRANT USAGE ON SCHEMA public TO dcm_app, dcm_admin;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dcm_app, dcm_admin;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO dcm_app, dcm_admin;
