# `tenancy` module

**Status:** skeleton — module class and `index.ts` only.

## Purpose

Clinics (tenants) and their branches, tenant settings (IANA timezone, currency, locale), and provisioning. Tenants are created only by platform admins through `withoutTenant()`; provisioning seeds system roles (via events) and invites the clinic owner.

## Owns

`tenants`, `branches`, `tenant_settings` (planned).

## Public API (`index.ts`)

`TenancyModule`. Planned: `TenancyService` (provision tenant, update settings, list/suspend tenants for platform admins).

## Events

- Emits: `TenantProvisioned`, `TenantSettingsChanged` (planned).
- Consumes: —

## Depends on

—

## Permissions

`platform:admin` (provisioning), `tenant:read`, `tenant:write`.
