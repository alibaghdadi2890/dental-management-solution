# `provisioning` module

**Status:** implemented — tenant + first branch + organization mirror; owner and system roles
arrive with `users`/`roles` (step C).

## Purpose

Platform back office (ADR-0009). Provisions a clinic end to end and serves the cross-tenant views a
platform admin needs. Owns no tables: everything goes through the owning modules' services.

Provisioning:

1. Fail fast if the owner's email already has an account (`409 user.email_taken`).
2. `tenancy.createTenant` via `withoutTenant()` — the only cross-tenant write (slug clash →
   `409 tenant.slug_taken`).
3. `runInTenant(tenantId)` → one transaction: organization mirror (`auth`), first branch
   (`tenancy`), audit `tenant.provision`, `TenantProvisioned` (dispatched after commit).
4. If step 3 fails, the tenant row is removed (compensation) and the error is rethrown.

## Owns

No tables.

## Public API (`index.ts`)

`ProvisioningModule`; event type `TenantProvisioned`. Nothing may depend on this module.

## HTTP

The tenant is in the body or query, never in the path (ADR-0008). All routes require
`platform:admin`.

| Route                               | Purpose                                              |
| ----------------------------------- | ---------------------------------------------------- |
| `GET /platform/tenants`             | `?status=&search=` — tenants with branch/user counts |
| `POST /platform/tenants`            | Provision (`provisionTenantRequestSchema`)           |
| `POST /platform/tenants/suspend`    | `{ tenantId, reason }`                               |
| `POST /platform/tenants/reactivate` | `{ tenantId, reason }`                               |

## Events

- Emits: `TenantProvisioned { tenantId, firstBranchId }`.
- Consumes: —

## Depends on

tenancy, auth, audit (users and roles from step C)

## Permissions

`platform:admin`.
