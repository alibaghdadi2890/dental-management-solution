# `users` module

**Status:** skeleton — module class and `index.ts` only.

## Purpose

Who are you here. Application-level staff profile per tenant: display name, professional title, practitioner type (dentist/hygienist/receptionist), contact, active flag. Keyed by `(tenant_id, auth_user_id)`. Knows nothing about permissions.

## Owns

`staff_profiles` (planned).

## Public API (`index.ts`)

`UsersModule`. Planned: `UsersService` (get/list practitioners, update profile).

## Events

- Emits: `StaffProfileCreated`, `StaffProfileUpdated` (planned).
- Consumes: `MemberJoined`.

## Depends on

auth, tenancy

## Permissions

`user:read`, `user:write`.
