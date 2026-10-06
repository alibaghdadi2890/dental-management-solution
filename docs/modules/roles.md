# `roles` module

**Status:** implemented — system roles, assignments, permission lookup.

## Purpose

What roles exist in a tenant and who holds them. Every tenant gets the four system roles `owner`,
`dentist`, `assistant`, `frontdesk` (D4) with the D5 permission matrix, seeded by `provisioning`
inside the provisioning transaction (ADR-0009). Custom roles (`system = false`) fit the data model;
there is no UI or API to create them yet. Permissions come from the catalog in `@dcm/contracts`.

| Permission                              | owner | dentist | assistant | frontdesk |
| --------------------------------------- | ----- | ------- | --------- | --------- |
| `tenant:read`, `user:read`              | ✓     | ✓       | ✓         | ✓         |
| `tenant:write`                          | ✓     | –       | –         | –         |
| `user:write`, `role:read`, `role:write` | ✓     | –       | –         | –         |
| `patient:read`, `patient:write`         | ✓     | ✓       | ✓         | ✓         |
| `visit:read`                            | ✓     | ✓       | ✓         | ✓         |
| `visit:write`                           | ✓     | ✓       | ✓         | –         |
| `visit:void`, `visit:amend`             | ✓     | ✓       | –         | –         |
| `visit:discount`                        | ✓     | ✓       | –         | ✓         |
| `chart:write`                           | ✓     | ✓       | –         | –         |
| `catalog:read`                          | ✓     | ✓       | ✓         | ✓         |
| `catalog:write`, `import:run`           | ✓     | –       | –         | –         |
| `payment:read`                          | ✓     | ✓       | ✓         | ✓         |
| `payment:write`                         | ✓     | ✓       | –         | ✓         |
| `payment:refund`, `audit:read`          | ✓     | ✓       | –         | –         |

`visit:amend` and `visit:void` are enforced by `POST /visits/:id/amend` and `/void` and
re-checked in `VisitsService` (feature 4b); the SPA shows front desk "Request a change" instead.
`visit:discount` is the visit discount at checkout, on the visit's day (ADR-0030); migration
`0026_checkout_discount` grants it to the system roles of tenants seeded before it.
`chart:write` is charting on the patient record, outside a visit (ADR-0031): diagnoses, plans and
named plans; in-visit charting stays on `visit:write`. Migration `0028_records_without_visit`
grants it likewise.

`platform:admin` is never granted by a role (platform admins are decided by rule, ADR-0008). The
matrix is the pure constant `domain/system-roles.ts`; a unit test pins it per role. Renaming a
permission ships a migration that rewrites stored grants (`0006_catalog_permissions`:
`procedure:*` → `catalog:*`).

## Owns

- `roles` — tenant RLS; `key` unique per tenant; `name`; `system`.
- `role_permissions` — tenant RLS; PK `(role_id, permission)`; permission text is filtered through
  the catalog on read, so a retired permission grants nothing.
- `user_roles` — tenant RLS; PK `(user_id, role_id)`; `user_id` is the global auth user id.

Both junctions reference `roles` through a composite `(tenant_id, role_id)` foreign key, so an
assignment can never point at another tenant's role. Junction rows are hard-deleted.

## Public API (`index.ts`)

`RolesModule`, `RolesService`:

- `seedSystemRoles()` (`role:write`, idempotent: creates only missing roles, audited
  `role.create`).
- `listRoles()` (`role:read`).
- `assignRoles(userId, roleKeys)` (`role:write`): replaces the user's set; any unknown key refuses
  the whole call with 422 `role.unknown`; audited `user.roles_assign` with before/after keys.
- Reads for other modules: `rolesFor(userIds)`, `permissionsForUser(userId)` (the union of the
  user's roles, resolved into the request context by `authorization`), `holdersOf(roleKey)` (the
  last-owner rule in `users`).

## HTTP

| Route        | Access      |
| ------------ | ----------- |
| `GET /roles` | `role:read` |

## Events

- Emits: —
- Consumes: —

## Depends on

audit (tenant scope comes from RLS; `tenancy` is an allowed edge but not needed yet)

## Permissions

`role:read`, `role:write`.
