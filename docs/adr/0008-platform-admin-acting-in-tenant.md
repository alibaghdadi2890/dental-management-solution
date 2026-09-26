# ADR-0008: Platform admins act inside a tenant through `X-Tenant-Id`

- Status: Accepted
- Date: 2026-09-26

## Context

Platform admins (back office) configure clinics: branches, rooms, users, settings (D1). They hold
no clinic membership (D9). We need them to use the normal tenant-scoped services without a second,
RLS-bypassing code path, and every change must still say who made it.

## Decision

- Platform admins are better-auth users with the admin-plugin role `platform_admin`.
- The SPA sends `X-Tenant-Id` on requests made for a selected clinic. The session guard accepts
  the header **only** from platform admins (it is ignored for everyone else) and sets the CLS
  tenant from it; an unknown or malformed id is `404 tenant.not_found`. Nothing is stored on the
  admin's session.
- Inside a tenant, a platform admin holds every permission; outside one, only `platform:admin`
  (`RequestContext.hasPermission`, ADR-0010). Suspended tenants refuse clinic users but not
  platform admins, so they can be inspected and reactivated.
- All tenant-scoped reads and writes go through the normal services under RLS. `withoutTenant()`
  is used only to create, list and (as provisioning compensation) remove tenant rows.
  Programmatic entry into a tenant (provisioning, suspension) uses
  `RequestContext.runInTenant(tenantId, fn)`, allowed only for platform admins and system tasks.
- Tenant-scoped routes never carry the tenant in the path (CLAUDE.md §12). Platform-admin APIs
  (`/platform/tenants…`) take `tenantId` in the query or body.
- Audit entries record `actor_kind = 'user'`, the admin's user id and `actor_platform_admin = true`;
  reasoned actions (suspend, deactivate…) store the reason in `audit_log.reason`.

## Consequences

- One code path for clinic owners (later, D1) and platform admins; the owner screens only add UI.
- `audit_log` gains `actor_platform_admin` and `reason` (CLAUDE.md §10).
- The acceptance test "403 on `POST /tenants/:id/branches`" becomes `POST /branches`.
