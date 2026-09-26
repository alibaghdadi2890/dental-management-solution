# ADR-0009: Identity module graph — `provisioning` on top, `users` above `roles`

- Status: Accepted
- Date: 2026-09-26

## Context

Read literally, feature 1 needed cycles: `tenancy.provisionTenant` creating the owner (tenancy →
users/auth, both of which depend on tenancy); "create staff user with roles" in `users` (users →
roles while roles → users); `GET /session` in `auth` needing profiles and roles from modules above
it. CLAUDE.md §4 forbids cycles and `forwardRef`.

## Decision

```
tenancy        —
auth           tenancy
roles          tenancy                  (was: users, tenancy)
users          auth, tenancy, roles     (was: auth, tenancy)
authorization  auth, roles
audit          —                        (everyone else depends on audit)
provisioning   tenancy, auth, users, roles   (new; nothing depends on it)
```

- **`provisioning`** is the platform back office. It owns no tables and orchestrates: tenant row
  (`withoutTenant`), then inside the tenant one transaction for the organization mirror, first
  branch, system roles and owner, then `TenantProvisioned` after commit. On failure it removes the
  tenant row (compensation). It also serves the cross-tenant tenants list with counts.
- **`roles`** keys `user_roles` by the auth user id and no longer needs `users`. **`users`**
  depends on `roles`, so `createStaffUser` assigns roles in the same transaction as the identity
  and profile.
- **`GET /session`** is served by `users` ("who am I here"); sign-in, sign-out, the session guard,
  branch switch, password change and the idle heartbeat stay in `auth`.
- System roles are seeded by a **direct call** inside the provisioning transaction: they must
  exist before the owner's role is assigned, and events are dispatched after commit.
  `TenantProvisioned` is still emitted for the audit log and future reactions.

## Consequences

- CLAUDE.md §4 module map updated; `docs/modules/provisioning.md` added.
- Later owner-side user management calls `users` directly; it does not go through `provisioning`.
