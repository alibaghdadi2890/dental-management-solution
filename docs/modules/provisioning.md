# `provisioning` module

**Status:** implemented — tenant, organization mirror, system roles, first branch, owner account.

## Purpose

Platform back office (ADR-0009). Provisions a clinic end to end and serves the cross-tenant views a
platform admin needs. Owns no tables: everything goes through the owning modules' services.

Provisioning:

1. Fail fast if the owner's email already has an account (`409 user.email_taken`).
2. `tenancy.createTenant` via `withoutTenant()` — the only cross-tenant write (slug clash →
   `409 tenant.slug_taken`).
3. `runInTenant(tenantId)` → one transaction: organization mirror (`auth`), the four system roles
   with the D5 matrix (`roles.seedSystemRoles`, called directly because the owner needs them —
   A5), first branch (`tenancy`), the owner account (`users.createStaffUser`: identity with the
   temporary password, membership, profile with practitioner type `other`, the first branch, role
   `owner` — ADR-0012), audit `tenant.provision`, `TenantProvisioned` (dispatched after commit).
4. If step 3 fails, the tenant row is removed (compensation) and the error is rethrown; nothing
   else was committed, identity included.

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

- Emits: `TenantProvisioned { tenantId, ownerUserId, firstBranchId }` (one per clinic).
- Consumes: —

## Depends on

tenancy, auth, users, roles, audit

## Permissions

`platform:admin`.
