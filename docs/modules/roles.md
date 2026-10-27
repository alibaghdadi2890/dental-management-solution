# `roles` module

**Status:** implemented — system and custom roles, per-user grants, the rules of widening
(feature 13a, ADR-0055), the Admin role (ADR-0061).

## Purpose

What roles exist in a tenant, who holds them and which extra permissions a person has. Every
tenant gets the five system roles `owner`, `admin`, `dentist`, `assistant`, `frontdesk` (D4,
ADR-0061), seeded by `provisioning` inside the provisioning transaction (ADR-0009). The clinic edits them (all but
`owner`) and resets them to their default, adds custom roles (`custom_<8 hex>` keys) and switches
them off, never deletes them; it grants a person additional permissions (`user_permission_grants`,
additive only). A user may do the union of their active roles and their grants; whoever holds
`owner` holds every grantable permission by rule. `admin` starts with every grantable permission as
data, which the clinic may narrow, and stays below the owner (ADR-0061). Permissions come from the catalog in
`@dcm/contracts`; the capability catalog (`capabilities.ts`) groups them for the editors, and
`implies` closes every write (`visit:read_all ⇒ visit:read`, `finance:read ⇒ payment:read`, …).

The default matrix (deny by default, the owner widens):

| Permission                                                                                                           | owner | admin | dentist | assistant | frontdesk |
| -------------------------------------------------------------------------------------------------------------------- | ----- | ----- | ------- | --------- | --------- |
| `tenant:read`, `user:read`, `catalog:read`, `patient:read`, `patient:write`, `visit:read`, `file:read`, `file:write` | ✓     | ✓     | ✓       | ✓         | ✓         |
| `visit:read_all`                                                                                                     | ✓     | ✓     | –       | ✓         | ✓         |
| `visit:write`                                                                                                        | ✓     | ✓     | ✓       | ✓         | –         |
| `visit:void`, `visit:amend`, `chart:write`, `file:archive`, `audit:read`, `compensation:read`                        | ✓     | ✓     | ✓       | –         | –         |
| `visit:discount`                                                                                                     | ✓     | ✓     | –       | –         | –         |
| `payment:read`, `payment:write`                                                                                      | ✓     | ✓     | –       | –         | ✓         |
| `payment:refund`, `finance:read`, `compensation:manage`                                                              | ✓     | ✓     | –       | –         | –         |
| `tenant:write`, `user:write`, `role:read`, `role:write`, `catalog:write`, `import:run`                               | ✓     | ✓     | –       | –         | –         |

`visit:read` is the caller's own visits (dentist or starter), `visit:read_all` every visit;
`payment:read` is one patient's account, `finance:read` money across patients; `visit:discount` is
every change that lowers or sets a price (ADR-0055). `compensation:*` are reserved for feature 13b.
Migration `0050_financial_access` brought every tenant to this matrix — the **last full rewrite**:
from now on a migration only adds permissions to system roles, never removes one, and a
permission new to the catalog is added to the `admin` role and template (`0054_admin_role` added
the role to every clinic, ADR-0061).

**Rules of widening** (`domain/role-rules.ts`, run in the service): every change needs
`role:write`; an editor gives only what they hold, by role edit, grant or role assignment, and
only an owner or a platform admin assigns `owner` (403 `role.cannot_grant`, `permission` names
it); only an owner or a platform admin takes `owner` from someone (an admin holds every permission but
is no owner, so these rules keep it below the owner, ADR-0061); managing someone's account
(password, status, profile, roles, grants) needs everything they hold, and an owner's an owner
(403 `role.cannot_manage`, `RolesService.assertCanManage`, called by `users`); no change may take the caller's own `role:write` or `user:write` (409 `role.self_lockout`,
checked after the write); `owner` is not edited (409 `role.owner_locked`); a held role is not
switched off (409 `role.has_holders`, `holders`); only custom roles are renamed or switched off,
only system ones reset (409 `role.not_allowed`).

`visit:amend` and `visit:void` are enforced by `POST /visits/:id/amend` and `/void` and
re-checked in `VisitCorrectionsService` (feature 4b); the SPA shows front desk "Request a change"
instead.
`visit:discount` was first the visit discount at checkout (ADR-0030, migration `0026`); since
ADR-0055 it covers every discount and line price.
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

**Platform default roles (ADR-0056).** The default matrix is data: `role_templates` and
`role_template_permissions`, managed by platform admins from the admin portal (**Default roles**),
who also edit a clinic's roles from its tenant page. Provisioning creates a clinic's system roles
from the system templates and each active extra template as a custom role; Reset to default
restores a system role to its template. Existing clinics never change with a template. New extra
templates start switched off.

## Owns

- `roles` — tenant RLS; `key` unique per tenant; `name`; `description`; `system`; `active`;
  `updated_by`.
- `role_templates`, `role_template_permissions` — **global**, no `tenant_id`, no RLS: read by
  every tenant transaction, written only through `withoutTenant()` (the runtime role has no write
  grant, migration 0051).
- `user_permission_grants` — tenant RLS; PK `(tenant_id, user_id, permission)`; `granted_by`,
  `reason`; filtered through the catalog on read; a revoked grant is hard-deleted.
- `role_permissions` — tenant RLS; PK `(role_id, permission)`; permission text is filtered through
  the catalog on read, so a retired permission grants nothing.
- `user_roles` — tenant RLS; PK `(user_id, role_id)`; `user_id` is the global auth user id.

Both junctions reference `roles` through a composite `(tenant_id, role_id)` foreign key, so an
assignment can never point at another tenant's role. Junction rows are hard-deleted.

## Public API (`index.ts`)

`RolesModule`, `RolesService`:

- `seedSystemRoles()` (`role:write`, idempotent: creates only missing roles, audited
  `role.create`).
- `listRoles()` (`role:read`): with permissions, `active`, `description` and holder counts.
- `createRole`, `updateRole`, `deactivateRole`, `reactivateRole`, `resetToDefault` (`role:write`,
  the rules above), audited `role.create`, `role.update` (permissions before/after),
  `role.deactivate`, `role.reactivate`, `role.reset`.
- `assignRoles(userId, roleKeys)` (`role:write`): replaces the user's set; an unknown or inactive
  key refuses the whole call with 422 `role.unknown`; audited `user.roles_assign`.
- `setGrants(userId, { permissions, reason? })` (`role:write`): replaces the person's grants,
  closed under `implies`; audited `user.grants_update`. `users` calls it after checking the user.
- Reads for other modules: `rolesFor(userIds)`, `grantsFor(userIds)`,
  `permissionsForUser(userId)` (active roles ∪ grants, or everything for an owner; resolved into
  the request context by `authorization`), `holdersOf(roleKey)` (the last-owner rule in `users`).

## HTTP

| Route                                                                                    | Access       |
| ---------------------------------------------------------------------------------------- | ------------ |
| `GET /roles`                                                                             | `role:read`  |
| `POST /roles`, `PATCH /roles/:id`, `POST /roles/:id/deactivate`, `/reactivate`, `/reset` | `role:write` |

| `GET /platform/role-templates`, `POST /platform/role-templates`, `PATCH /platform/role-templates/:id`, `POST /platform/role-templates/:id/deactivate`, `/reactivate` | `platform:admin` |

`PUT /users/:id/grants` lives in `users` and delegates here.

## Events

- Emits: —
- Consumes: —

## Depends on

audit (tenant scope comes from RLS; `tenancy` is an allowed edge but not needed yet)

## Permissions

`role:read`, `role:write`.
