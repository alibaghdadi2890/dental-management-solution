# `users` module

**Status:** implemented — staff profiles, branch assignments, staff user lifecycle, `GET /session`.

## Purpose

Who are you here. The staff record of a person inside one tenant — display name, professional
title, practitioner type (`dentist`, `assistant`, `frontdesk`, `other`), a dentist's specialties
(ADR-0050), phone, active flag — and the branches they work in. Keyed by
`(tenant_id, auth_user_id)`: the identity is global (`auth`), the profile is per tenant (D7). Creating a staff user orchestrates `auth` (identity and membership
mirror) and `roles` (assignments) in one transaction. Knows nothing about permission evaluation.

## Owns

- `staff_profiles` — tenant RLS; unique `(tenant_id, auth_user_id)`; `practitioner_type` is text
  validated by Zod. `primary_specialty` and `specialties text[]` (ADR-0050): a dentist has at least
  one specialty, the primary among them; anyone else has none (three CHECKs).
- `staff_branches` — tenant RLS; PK `(auth_user_id, branch_id)`; `position` keeps the assignment
  order (the first branch is the default one); composite FK to `staff_profiles`. Branch ids are
  validated through `TenancyService`, not by a foreign key into `tenancy`'s table.

## Public API (`index.ts`)

`UsersModule`, `UsersService`:

- `list()`, `get(userId)` (`user:read`) — `StaffUser` with email, roles and branches. `StaffUser.id`
  is the global auth user id (D7); `StaffUser.profileId` is this tenant's `staff_profiles.id` — the
  id a domain model refers to a staff member in a clinical role by (ADR-0020).
- `listPractitioners({ branchId? })` — active staff whose `practitioner_type = 'dentist'`,
  ordered by display name (tenant-locale collation), then auth user id. With `branchId`, only
  those assigned to that branch (`staff_branches`); an unknown branch yields `[]`. Not
  permission-gated: a building block like `TenancyService.activeBranches`, used wherever the app
  offers "assign a dentist" (feature 3 Q2) or "start a visit" (feature 4a's `StartVisitPopover`);
  `GET /users/practitioners?branchId=` still requires `user:read` (every system role holds it). A
  new clinic's owner is a dentist unless the platform admin chose another type (`provisioning`),
  so the list is not empty on day one. Each `Practitioner` carries `id` (the staff profile id,
  ADR-0020 — the id other modules should store) and `userId` (the auth user id, kept for links
  back to `users`).
- `practitionersByProfileIds(profileIds)` — practitioners among `profileIds`
  (`staff_profiles.id`) whatever their current type or active status, ordered the same way, for
  showing the display name of a dentist already assigned to a patient even after they leave or
  change role. Not permission-gated either: `patients` (`primary_dentist_id`, the `sort=dentist`
  rank) and `billing` (the export's Dentist column) resolve dentist names through it (ADR-0020).
  Domain models never store an auth user id for a dentist.
- `namesByUserIds(userIds)` — display names of the staff among `userIds` (auth user ids, the `*_by`
  columns), deactivated staff included; not permission-gated ("Recorded by" in `billing`, feature 5).
- `profileIdOf(userId)` — the user's `staff_profiles.id` in this tenant, or `null` (a platform
  admin acting in the tenant has no profile). Not permission-gated either: `clinical`'s
  `live({ mine: true })` matches the caller's visits as dentist through it (feature 4a, W18).
- `createStaffUser(input)` (`user:write`, roles also need `role:write`): a dentist sent without
  specialties starts on `general`; identity with a temporary password (D6) → membership mirror →
  profile → branches → roles, one transaction; a failure in any step rolls the identity back. `409 user.email_taken` for a registered email (D7 extension point:
  attach the existing identity instead), `422 user.unknown_branch`, `422 role.unknown`.
- `updateStaffUser(userId, patch)` (`user:write`): profile fields, specialties (as a pair), roles,
  branches (re-syncs the mirror). Branches kept from before may since be inactive; new ones must be
  active. Changing a dentist to another type clears the specialties; making someone a dentist
  needs one (`422 user.specialty_required`); specialties for another type are
  `422 user.specialty_not_allowed` (`resolveSpecialties`, `domain/staff-rules.ts`).
- `deactivate(userId, reason)` / `reactivate(userId, reason)` (`user:write`): ban + sessions
  revoked + membership removed (`MemberRemoved`), and back.
- `resetPassword(userId, temporaryPassword)` (`user:write`): signs the user out;
  `mustChangePassword` is set again.

Invariants (`domain/staff-rules.ts`): a tenant keeps at least one active owner
(`409 user.last_owner`, on deactivation and when removing the owner role); nobody deactivates
themselves (`409 user.self_deactivation`); a staff user has at least one role and one branch.

Every mutation is audited (`user.create`, `user.update` with before/after, `user.deactivate` /
`user.reactivate` with the reason, `user.reset_password`); passwords never reach the audit log.

## HTTP

| Route                                | Access                                              |
| ------------------------------------ | --------------------------------------------------- |
| `GET /session`                       | Authenticated, pending password ok                  |
| `GET /users`, `GET /users/:id`       | `user:read`                                         |
| `GET /users/practitioners?branchId=` | `user:read`                                         |
| `POST /users`                        | `user:write`                                        |
| `PATCH /users/:id`                   | `user:write`                                        |
| `POST /users/:id/deactivate`         | `user:write` (`{ reason }`)                         |
| `POST /users/:id/reactivate`         | `user:write` (`{ reason }`)                         |
| `POST /users/:id/reset-password`     | `user:write` (`{ temporaryPassword }`)              |
| `PUT /users/:id/grants`              | `role:write` (`{ permissions, reason? }`, ADR-0055) |

A staff user carries `grants` (their additional permissions) and `effectivePermissions` (roles and
grants) only for a caller with `role:read`; both are null otherwise. Role assignment and grants
follow the rules of widening in `roles` (an editor gives only what they hold; no self-lockout).
The clinic's owner manages staff from Settings › Staff, the admin portal's table and panel on the
clinic's own tenant.

`GET /session` carries `profile` — its id (the staff profile id the visit scope compares with a
visit's dentist, ADR-0055), the practitioner type and a dentist's specialties (ADR-0050); null
without a staff profile in the tenant (a platform admin). `:id` is the auth user id. Another
tenant's user is `404 user.not_found` (RLS).

## Events

- Emits: — (`MemberJoined` / `MemberRemoved` come from `auth`).
- Consumes: —

## Depends on

auth, tenancy, roles, audit

## Permissions

`user:read`, `user:write` (and `role:write` for role changes).
