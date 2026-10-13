#!/bin/bash
# Runs once, when /var/lib/dcm/postgres-data is still empty (the postgres image's
# /docker-entrypoint-initdb.d). The two runtime roles the migrations grant to
# (apps/api/migrations/0000_runtime_grants.sql): dcm_app runs the API under row-level security,
# dcm_admin bypasses it for withoutTenant() only. Passwords come from /opt/dcm/.env through the
# container's environment (docker-compose.yml). To rotate one later: ALTER ROLE ... PASSWORD, then
# ship the new .env.
set -euo pipefail
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -v app_password="$DCM_APP_PASSWORD" -v admin_password="$DCM_ADMIN_PASSWORD" <<'SQL'
CREATE ROLE dcm_app LOGIN PASSWORD :'app_password';
CREATE ROLE dcm_admin LOGIN PASSWORD :'admin_password' BYPASSRLS;
SQL
