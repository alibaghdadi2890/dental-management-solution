# `roles` module

**Status:** skeleton — module class and `index.ts` only.

## Purpose

What roles exist and who holds them. System roles seeded per tenant on provisioning (`owner`, `dentist`, `hygienist`, `receptionist`, `accountant`, `readonly`) plus tenant-defined custom roles; role → permission and user → role assignments. Permissions come from the catalog in `@dcm/contracts`.

## Owns

`roles`, `role_permissions`, `user_roles` (planned).

## Public API (`index.ts`)

`RolesModule`. Planned: `RolesService` (permissions for a user, manage roles).

## Events

- Emits: `RoleAssigned`, `RoleRevoked` (planned).
- Consumes: `TenantProvisioned` (seed system roles).

## Depends on

users, tenancy

## Permissions

`role:read`, `role:write`.
