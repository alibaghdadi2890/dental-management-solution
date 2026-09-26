# `users` module

**Status:** implemented — staff profiles, branch assignments, staff user lifecycle, `GET /session`.

## Purpose

Who are you here. The staff record of a person inside one tenant — display name, professional
title, practitioner type (`dentist`, `assistant`, `frontdesk`, `other`), phone, active flag — and
the branches they work in. Keyed by `(tenant_id, auth_user_id)`: the identity is global (`auth`),
the profile is per tenant (D7). Creating a staff user orchestrates `auth` (identity and membership
mirror) and `roles` (assignments) in one transaction. Knows nothing about permission evaluation.

## Owns

- `staff_profiles` — tenant RLS; unique `(tenant_id, auth_user_id)`; `practitioner_type` is text
  validated by Zod.
- `staff_branches` — tenant RLS; PK `(auth_user_id, branch_id)`; `position` keeps the assignment
  order (the first branch is the default one); composite FK to `staff_profiles`. Branch ids are
  validated through `TenancyService`, not by a foreign key into `tenancy`'s table.

## Public API (`index.ts`)

`UsersModule`, `UsersService`:

- `list()`, `get(userId)` (`user:read`) — `StaffUser` with email, roles and branches.
- `createStaffUser(input)` (`user:write`, roles also need `role:write`): identity with a temporary
  password (D6) → membership mirror → profile → branches → roles, one transaction; a failure in any
  step rolls the identity back. `409 user.email_taken` for a registered email (D7 extension point:
  attach the existing identity instead), `422 user.unknown_branch`, `422 role.unknown`.
- `updateStaffUser(userId, patch)` (`user:write`): profile fields, roles, branches (re-syncs the
  mirror). Branches kept from before may since be inactive; new ones must be active.
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

| Route                            | Access                                 |
| -------------------------------- | -------------------------------------- |
| `GET /session`                   | Authenticated, pending password ok     |
| `GET /users`, `GET /users/:id`   | `user:read`                            |
| `POST /users`                    | `user:write`                           |
| `PATCH /users/:id`               | `user:write`                           |
| `POST /users/:id/deactivate`     | `user:write` (`{ reason }`)            |
| `POST /users/:id/reactivate`     | `user:write` (`{ reason }`)            |
| `POST /users/:id/reset-password` | `user:write` (`{ temporaryPassword }`) |

`:id` is the auth user id. Another tenant's user is `404 user.not_found` (RLS).

## Events

- Emits: — (`MemberJoined` / `MemberRemoved` come from `auth`).
- Consumes: —

## Depends on

auth, tenancy, roles, audit

## Permissions

`user:read`, `user:write` (and `role:write` for role changes).
