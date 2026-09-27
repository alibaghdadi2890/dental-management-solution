# `tenancy` module

**Status:** implemented — tenants, settings, branches, rooms.

## Purpose

Clinics (tenants), their settings (IANA time zone, currency, locale, country; defaults
`Asia/Beirut`, `USD`, `en`, `LB`), their branches, and each branch's rooms. Country is ISO 3166-1
alpha-2 and drives phone parsing (`patients`, feature 3 Q3) and date order (feature 3 Q17). A room
is the physical unit a visit happens in and the unit `scheduling` will later book as a resource
(ADR-0007); there is no chair concept. Tenants are created and listed only by platform admins
through `withoutTenant()`; everything else runs inside the current tenant under RLS. End-to-end
provisioning (first branch, owner, roles) is orchestrated by `provisioning`.

## Owns

- `tenants` — `id, name, slug (unique), status (active|suspended), time_zone, currency, locale`,
  plus `country` (`char(2)`, default `'LB'`, `CHECK (country ~ '^[A-Z]{2}$')` as a second line of
  defence under `countrySchema`). No `tenant_id`; RLS policy `tenant_self` (`id` = the
  transaction's tenant) lets members read their own row.
- `branches` — tenant RLS; `name` and `code` unique per tenant, case-insensitive; `active`.
- `rooms` — tenant RLS; composite FK `(tenant_id, branch_id)` → `branches` so a room can never
  point at another tenant's branch (FK checks bypass RLS); `name` and `code` unique per branch.

Branches and rooms are deactivated, never deleted. Rooms never move between branches.

## Public API (`index.ts`)

`TenancyModule`, `TenancyService`:

- Platform (`platform:admin`, cross-tenant): `createTenant`, `discardTenant` (provisioning
  compensation), `listTenants` (with branch counts).
- Current tenant: `currentTenant`, `currentTenantStatus` (session guard), `updateSettings`
  (`tenant:write`), `setStatus` (`platform:admin`, with reason).
- Branches: `listBranches`, `createBranch`, `updateBranch` (`tenant:write`), `activeBranches(ids)`,
  `branchesByIds(ids)` (any status, for staff records),
  `allActiveBranches()`.
- Rooms: `listRooms(branchId?)` (for later features: visits pick a room), `saveRooms(batch)`
  (`tenant:write`, atomic, names may be swapped within a batch).

Errors: `TenantNotFoundError`, `TenantSuspendedError` (exported); `branch.*`, `room.*` codes.

## HTTP

| Route                  | Access         |
| ---------------------- | -------------- |
| `GET /tenant`          | `tenant:read`  |
| `PATCH /tenant`        | `tenant:write` |
| `GET /branches`        | `tenant:read`  |
| `POST /branches`       | `tenant:write` |
| `PATCH /branches/:id`  | `tenant:write` |
| `GET /rooms?branchId=` | `tenant:read`  |
| `POST /rooms/batch`    | `tenant:write` |

The tenant always comes from the session, or `X-Tenant-Id` for platform admins (ADR-0008).

## Events

- Emits: — (`TenantProvisioned` is emitted by `provisioning`).
- Consumes: —

## Depends on

audit

## Permissions

`platform:admin` (tenant creation, listing, suspension), `tenant:read`, `tenant:write`.
