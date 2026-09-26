# `audit` module

**Status:** implemented — append-only log, generic event subscriber, query API.

## Purpose

Append-only audit log: who/what/when/tenant/before/after for every mutation, fed by explicit
entries from application services (inside their transaction) and by a single generic subscriber
to all domain events. Agent tool calls will be recorded with `actor_kind = 'agent'`.

## Owns

`audit_log` — `id, tenant_id, actor_user_id, actor_kind, actor_platform_admin, action,
resource_type, resource_id, before, after, reason, request_id, occurred_at` (+ timestamps).
Tenant RLS. `dcm_app` and `dcm_admin` have INSERT/SELECT only (UPDATE, DELETE and TRUNCATE are
revoked in the migration). Snapshots pass through `redactSecrets()`; credentials are never stored.

## Public API (`index.ts`)

- `AuditModule`
- `AuditService.record({ action, resourceType, resourceId, before?, after?, reason? })` — joins
  the caller's open `TenantDb` transaction and stamps actor, platform-admin flag and request id
  from CLS. Requires a tenant context. Actions are `<resource>.<verb>` (e.g. `branch.update`).
- `AuditService.list(query)` — newest first, opaque `(occurred_at, id)` cursor.

## HTTP

| Route        | Access       |
| ------------ | ------------ |
| `GET /audit` | `audit:read` — `?resourceType=&resourceId=&cursor=&limit=` |

## Events

- Emits: —
- Consumes: every domain event (catch-all channel); stored with `resource_type = 'event'`, the
  event name as `action` and the payload as `after`. Events without a tenant are not stored;
  platform-global actions (admin bootstrap) are logged by pino only.

## Depends on

— (every other module depends on `audit`)

## Permissions

`audit:read`.
