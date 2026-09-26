# ADR-0004: Tenants are provisioned by platform admins only

- Status: Accepted
- Date: 2026-09-26

## Context

"Tenant creation and management" could mean self-serve sign-up or an internal back office.

## Decision

Only platform admins create tenants. Provisioning runs in `tenancy` through
`PlatformAdminDb.withoutTenant()` (BYPASSRLS `dcm_admin` role, requires `platform:admin` or a
system actor, always logged), seeds system roles via `TenantProvisioned`, and invites the clinic
owner by email. There is no public sign-up. Clinic owners manage their own settings, branches and
members inside the tenant.

## Consequences

- A platform-admin area is needed in the SPA; it is not in the design POC and needs design input.
- The first platform admin is bootstrapped by a system task, not through the UI.
