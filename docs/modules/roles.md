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
| `file:read`, `file:write`               | ✓     | ✓       | ✓         | ✓         |
| `file:archive`                          | ✓     | ✓       | –         | –         |

`visit:amend` and `visit:void` are enforced by `POST /visits/:id/amend` and `/void` and
re-checked in `VisitCorrectionsService` (feature 4b); the SPA shows front desk "Request a change"
instead.
`visit:discount` is the visit discount at checkout, on the visit's day (ADR-0030); migration
`0026_checkout_discount` grants it to the system roles of tenants seeded before it.
`chart:write` is charting on the patient record, outside a visit (ADR-0031): diagnoses, plans and
tooth presence; in-visit charting stays on `visit:write`. Migration `0028_records_without_visit`
grants it likewise.

Visit flows (feature 10) added no permission. What each existing one covers:

| Action                                                                                                                        | Permission      |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------- |
| Start a visit with a type, read the start options; set the step, the view, the reason and the complaint; skip a worklist item | `visit:write`   |
| In a visit: what a diagnosis was seen on; the priority of a plan made in that visit                                           | `visit:write`   |
| Confirm the medical history in a visit, or take the confirmation back (ADR-0046)                                              | `chart:write`   |
| On the patient record: a plan's priority and acceptance; what a diagnosis was seen on (ADR-0045, ADR-0049)                    | `chart:write`   |
| A patient's medical history (part of the patient create and update)                                                           | `patient:write` |
| Read the medical-history lists                                                                                                | `patient:read`  |
| Edit the medical-history lists; "Added on" and "Sessions" on a catalog service (ADR-0047)                                     | `catalog:write` |
| Read the history confirmation and the file citations of a patient                                                             | `visit:read`    |

So an assistant, who holds `visit:write` and not `chart:write`, runs the visit flow and cannot
confirm the medical history; front desk, without `visit:write`, starts no visit.

`file:read`, `file:write` and `file:archive` are patient files (feature 8): everyone reads and
uploads, and archiving is the owner's and the dentist's — plus, by rule and not by permission, the
uploader's for 24 hours (`canArchiveFile`, ADR-0040). Migration `0038_files` grants them likewise.

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
