# Feature 1 — Identity & provisioning — design

Date: 2026-09-26 · Status: draft for review

## Goal

A platform admin signs in, provisions a clinic (tenant) with its first branch and owner, configures
branches, rooms and staff users with roles, and can act inside a clinic. A staff user signs in on
the designed Login screen, lands in the clinic shell with their branch, and every API route is
guarded by session and permission. Everything is audited, tenant-isolated, tested and documented.

Out of scope: patients, catalogs, visits, payments, imports, email delivery, invitations, MFA,
custom-role UI, tenant-side user/RBAC screens, multi-tenant sign-in (design only), tablet layout.

## Decisions

The brief's D1–D11 stand. Decisions taken while designing (✓ = confirmed by the product owner):

| #   | Decision                                                                                                                                                                                                                                                                                                    | ADR  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| A1✓ | New top-level **`provisioning`** module (platform back office, no tables) orchestrates tenant provisioning and serves the cross-tenant tenants list. **`roles` no longer depends on `users`**; **`users` depends on `roles`** so `createStaffUser` assigns roles atomically. `users` serves `GET /session`. | 0009 |
| A2✓ | The actor's **resolved permission set is carried in CLS**. `platform/cls` evaluates it (`requirePermission`), so tenancy/users/roles re-check without importing `authorization`. `authorization` resolves the set at the edge and owns resource-level rules.                                                | 0010 |
| A3✓ | better-auth tables are the **identity plane**: global, no `tenant_id`, no RLS, touched only by `auth`, on the runtime role. All app data about staff stays in RLS tables.                                                                                                                                   | 0011 |
| A4✓ | Tenant-scoped routes take the tenant **only** from the session (or `X-Tenant-Id` for platform admins). Platform-admin APIs take `tenantId` in the query or body, never in the path.                                                                                                                         | 0008 |
| A5  | Roles are seeded by a **direct call inside the provisioning transaction** (they must exist before the owner's role is assigned). `TenantProvisioned` is emitted after commit for audit and future reactions.                                                                                                | 0009 |
| A6  | Staff accounts get a temporary password and `mustChangePassword`; this supersedes ADR-0004's owner invitation and "owners manage their own members" (deferred per D1).                                                                                                                                      | 0012 |
| A7  | Lockout is tracked per normalised email (known or not, so responses never reveal whether an account exists); idle timeout is enforced by the session guard from a `last_active_at` column.                                                                                                                  | 0013 |
| A8  | Rooms live in `tenancy`; the chair concept is removed everywhere; a room is the future scheduling resource.                                                                                                                                                                                                 | 0007 |
| A9  | `audit_log` gains `actor_platform_admin` and `reason` columns (D2 and the POC's reason dialogs).                                                                                                                                                                                                            | 0008 |

## Module graph

```
tenancy        —                              tenants, branches, rooms
auth           tenancy                        identity plane (better-auth), sign-in throttle, session guard
roles          tenancy                        roles, role_permissions, user_roles
users          auth, tenancy, roles           staff_profiles, staff_branches; GET /session
authorization  auth, roles                    permission resolution guard, @RequirePermission, can()
audit          —                              audit_log; generic event subscriber
provisioning   tenancy, auth, users, roles    (no tables) provision tenant, platform tenants list
```

Everything that mutates records an audit entry, so every module except `audit` also depends on
`audit`. Nothing depends on `provisioning`. `patients`/`clinical`/`imports` are untouched.

### Where each cross-cutting piece lives

| Piece                                      | Location                                           | Why                                                                                                                                     |
| ------------------------------------------ | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `@Public()`, `@Authenticated()` decorators | `platform/http/route-access.ts`                    | Needed by the health controller (platform) and both guards.                                                                             |
| `Permission` carrier + `requirePermission` | `platform/cls` (`RequestContext`)                  | A2.                                                                                                                                     |
| `runInTenant(tenantId, fn)`                | `platform/cls` (`RequestContext`)                  | Platform admin / system entering a tenant programmatically (provisioning, suspend).                                                     |
| `Clock` (`now()`)                          | `platform/kernel/clock.ts` + provider              | Deterministic lockout/idle tests.                                                                                                       |
| Session guard                              | `auth` (exported), registered as `APP_GUARD` first | Fills CLS identity and tenant.                                                                                                          |
| Permission guard                           | `authorization`, registered as `APP_GUARD` second  | Resolves permissions into CLS, enforces `@RequirePermission`. Both registered in `AuthorizationModule` so their order is deterministic. |

## Data model

All ids are uuid v7 from the application. All tables have `created_at`/`updated_at`.
Tenant-owned tables use `tenantIdColumn()` + `tenantIsolationPolicy()` + an index on `tenant_id`.

### `tenancy`

| Table      | Columns                                                                                                                | Constraints / RLS                                                                                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tenants`  | `id`, `name`, `slug`, `status` (`tenant_status` enum: `active`,`suspended`), `time_zone`, `currency` char(3), `locale` | `slug` unique. **RLS policy `tenant_self`: `id = current tenant`** (members read their own row via `TenantDb`); created and listed only through `withoutTenant()`. |
| `branches` | `id`, `tenant_id`, `name`, `code?`, `address?`, `phone?`, `active`                                                     | Tenant RLS. Unique `(tenant_id, lower(name))`; unique `(tenant_id, lower(code)) where code is not null`.                                                           |
| `rooms`    | `id`, `tenant_id`, `branch_id` → `branches.id`, `name`, `code?`, `active`                                              | Tenant RLS. Unique `(branch_id, lower(name))`; unique `(branch_id, lower(code)) where code is not null`.                                                           |

Defaults (D8): `Asia/Beirut`, `USD`, `en`. Branches and rooms are deactivated, never deleted.

### `auth` (identity plane, A3)

better-auth models renamed with an `auth_` prefix, columns snake_case, ids uuid v7 (via
`advanced.database.generateId`):

- `auth_users` (+ admin plugin `role`, `banned`, `ban_reason`, `ban_expires`; + `must_change_password`)
- `auth_sessions` (+ org plugin `active_organization_id`, `active_team_id`; + admin
  `impersonated_by`; + `trusted` boolean, `last_active_at`)
- `auth_accounts`, `auth_verifications`
- `auth_organizations` (id **= tenant id**), `auth_members` (role `member`), `auth_teams`
  (id **= branch id**), `auth_team_members`, `auth_invitations` (unused, created by the plugin)
- `auth_sign_in_throttle` (`email` pk, `failed_attempts`, `locked_until?`, `last_failed_at`)

A unit test compares this Drizzle schema with `getAuthTables(authOptions)` so a better-auth
upgrade that adds a field fails CI instead of production.

Organizations, teams, members and team members are a **mirror** maintained by `auth` inside the
caller's transaction (`AuthService.syncMembership`). They are what better-auth and the session
guard use; the app's own source of truth is the RLS tables in `users`, `roles` and `tenancy`.

### `roles`

| Table              | Columns                                                  | Constraints                                                    |
| ------------------ | -------------------------------------------------------- | -------------------------------------------------------------- |
| `roles`            | `id`, `tenant_id`, `key`, `name`, `system`               | Tenant RLS. Unique `(tenant_id, key)`.                         |
| `role_permissions` | `tenant_id`, `role_id` → roles, `permission` text        | Tenant RLS. PK `(role_id, permission)`. Junction: hard delete. |
| `user_roles`       | `tenant_id`, `user_id` (auth user id), `role_id` → roles | Tenant RLS. PK `(user_id, role_id)`. Junction: hard delete.    |

System roles and the D5 matrix are a pure constant in `roles/domain/system-roles.ts`; a unit test
checks every permission exists in the catalog. Permission text is validated with
`permissionSchema` on read.

### `users`

| Table            | Columns                                                                                                                                          | Constraints                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `staff_profiles` | `id`, `tenant_id`, `auth_user_id`, `display_name`, `title?`, `practitioner_type` (`dentist`,`assistant`,`frontdesk`,`other`), `phone?`, `active` | Tenant RLS. Unique `(tenant_id, auth_user_id)`.       |
| `staff_branches` | `tenant_id`, `auth_user_id`, `branch_id`                                                                                                         | Tenant RLS. PK `(auth_user_id, branch_id)`. Junction. |

`practitioner_type` is text + Zod (a tenant may extend it later). The API identifies a staff user
by their **auth user id** (global, stable across tenants — D7).

### `audit`

`audit_log`: `id`, `tenant_id`, `actor_user_id?`, `actor_kind` (`user|agent|system|job`),
`actor_platform_admin`, `action`, `resource_type`, `resource_id`, `before` jsonb?, `after` jsonb?,
`reason?`, `request_id?`, `occurred_at`. Tenant RLS; index `(tenant_id, occurred_at desc, id desc)`
and `(tenant_id, resource_type, resource_id)`. The migration `REVOKE UPDATE, DELETE ... FROM
dcm_app, dcm_admin`. Secrets (passwords) are never written to `before`/`after`.

Platform-global actions with no tenant (bootstrap) are logged by pino only.

## Request pipeline

```
request → requestId → CLS → SessionGuard (auth) → PermissionGuard (authorization) → Zod pipe → controller
```

### better-auth mount

`AuthHttpController` (`@Public()`, `@All('auth/*path')`) converts the Express request into a Fetch
`Request` (the app is created with `rawBody: true`) and calls `auth.handler`. Only an allowlist
is forwarded: `POST /auth/sign-in/email` and `POST /auth/sign-out`; everything else is 404 (no
sign-up, no org/admin HTTP endpoints — those plugins are driven server-side only). Non-2xx
better-auth responses are converted to problem+json with stable codes:

| better-auth                 | problem code                                  | status |
| --------------------------- | --------------------------------------------- | ------ |
| `INVALID_EMAIL_OR_PASSWORD` | `auth.invalid_credentials` (+ `attemptsLeft`) | 401    |
| lock active / reached       | `auth.account_locked` (+ `lockedUntil`)       | 401    |
| `BANNED_USER`               | `auth.account_deactivated`                    | 403    |
| other                       | `auth.<lower_snake_code>`                     | as-is  |

Sign-in throttling wraps the forwarded call (A7, D11): before forwarding, a locked email gets
`auth.account_locked`; after a 401 the attempt is recorded, and the fifth consecutive failure
locks the email for 15 minutes; success clears the row. The rules are a pure state machine in
`auth/domain/sign-in-throttle.ts`.

better-auth config: email/password, `disableSignUp`, min password length 10, organization plugin
(`teams.enabled`, `allowUserToCreateOrganization: false`), admin plugin (`adminRoles:
['platform_admin']`), `session.expiresIn` 30 days with `disableSessionRefresh` (absolute), cookie
prefix `dcm`, `SameSite=Lax`, `Secure` in production. `rememberMe` ("Trust this workstation") is
passed through: trusted → 30-day persistent cookie; otherwise a browser-session cookie with a
1-day hard expiry. A `session.create.before` database hook stamps `trusted` and `last_active_at`.

### SessionGuard (auth)

1. `@Public()` → pass.
2. `auth.api.getSession({ headers })`; none → 401 `unauthenticated`.
3. Idle timeout: untrusted session with `last_active_at` older than 15 minutes → revoke, 401
   `auth.session_expired`. Otherwise bump `last_active_at` when older than 60 seconds.
4. `platformAdmin = user.role === 'platform_admin'`.
5. **Tenant resolution** (`resolveTenant`, the D7 extension point):
   - platform admin: `X-Tenant-Id` header if present (must be a uuid of an existing tenant, else
     404 `tenant.not_found`), otherwise no tenant;
   - everyone else: `X-Tenant-Id` is **ignored**; tenant = `session.activeOrganizationId`, or, when
     unset, the user's memberships (`auth_members`): exactly one → persisted to the session; none →
     403 `auth.no_tenant`. _Several_ is where a tenant picker will plug in; today it cannot happen
     (a user belongs to one tenant) and is treated as the first membership.
6. Tenant status: a suspended tenant → 403 `tenant.suspended` (platform admins are exempt so they
   can reactivate).
7. Branch: `session.activeTeamId` if still a team membership, else the first assigned branch
   (persisted); none → `null`. A platform admin inside a tenant has no memberships: any active
   branch of that tenant is valid (checked through `tenancy` under RLS), defaulting to the first.
8. `user.mustChangePassword` → only routes marked `@AllowPendingPasswordChange()` pass (session
   read, password change, touch, sign-out); others → 403 `auth.password_change_required`.
9. CLS ← `{ userId, tenantId, branchId, platformAdmin, actorKind: 'user' }`.

### PermissionGuard (authorization)

1. `@Public()` → pass.
2. Resolve the permission set into CLS: platform admin → evaluated by rule (every permission
   inside a tenant; only `platform:admin` outside one); others → `RolesService.permissionsForUser`
   (tenant RLS).
3. `@Authenticated()` → pass. `@RequirePermission(p)` → `context.hasPermission(p)` or 403
   `forbidden`. A route with neither decorator → 403 (deny by default; a unit test scans every
   controller for a declaration).

`RequestContext.hasPermission(p)` (A2) is the one evaluation: `system` actors pass; platform admins
pass for any permission inside a tenant and for `platform:admin` outside one; otherwise the
resolved set decides. `requirePermission(p)` throws `PermissionDeniedError` (`forbidden`).
Every mutating application service calls it. `AuthorizationService.can(permission, resource?)`
wraps it and is where resource-level rules will go.

## Services and routes

All request/response bodies are Zod schemas in `@dcm/contracts`. `(A)` = `@Authenticated()`,
`(P)` = `@Public()`, otherwise the named permission.

### auth — `AuthService` (exported)

`createIdentity({ email, name, password, mustChangePassword })`, `syncMembership({ userId,
branchIds })` (mirror org/member/teams from tenancy inside the open transaction),
`removeMembership(userId)`, `setPassword(userId, password, { mustChange })` (revokes sessions),
`deactivate(userId)` / `reactivate(userId)` (ban/unban + revoke sessions), `isEmailTaken(email)`,
`identity(userId)`, `branchIdsFor(userId)`, `memberCountsByTenant()`,
`bootstrapPlatformAdmin({ email, password, name })` (system actor, `withoutTenant`, idempotent:
an existing user is promoted, never re-passworded).

Identity writes join the caller's open `TenantDb` transaction (via a new
`TenantDb.currentTransaction()`), so a staff user and their profile/roles commit together.

| Route                      | Access        | Purpose                                                                                 |
| -------------------------- | ------------- | --------------------------------------------------------------------------------------- |
| `POST /auth/sign-in/email` | P             | better-auth, throttled; body `{ email, password, rememberMe }`                          |
| `POST /auth/sign-out`      | P             | better-auth                                                                             |
| `POST /session/branch`     | A             | `{ branchId }` must be an active assigned branch                                        |
| `POST /session/password`   | A, pending ok | `{ currentPassword, newPassword }`; clears `mustChangePassword`, revokes other sessions |
| `POST /session/touch`      | A, pending ok | 204; idle heartbeat from the SPA                                                        |

Emits `MemberJoined`, `MemberRemoved` from `syncMembership` / `removeMembership`.

### tenancy — `TenancyService`

`createTenant(input)` (platform admin, `withoutTenant`, slug unique → 409 `tenant.slug_taken`),
`deleteProvisioningTenant(id)` (compensation only), `listTenants(filter)` (platform admin,
`withoutTenant`, with branch counts), `currentTenant()`, `updateSettings(patch)`,
`setStatus(status, reason)`, `listBranches()`, `createBranch()`, `updateBranch()`, `listRooms(branchId?)`
(exported for later features), `saveRooms(items[])` (batch create/update in one transaction),
`branchesByIds(ids)`.

| Route                  | Access                                                                 |
| ---------------------- | ---------------------------------------------------------------------- |
| `GET /tenant`          | `tenant:read`                                                          |
| `PATCH /tenant`        | `tenant:write`                                                         |
| `GET /branches`        | `tenant:read`                                                          |
| `POST /branches`       | `tenant:write`                                                         |
| `PATCH /branches/:id`  | `tenant:write` (name, code, address, phone, active)                    |
| `GET /rooms?branchId=` | `tenant:read`                                                          |
| `POST /rooms/batch`    | `tenant:write` (`{ items: [{ id?, branchId, name, code?, active }] }`) |

### roles — `RolesService`

`seedSystemRoles()`, `listRoles()`, `rolesFor(userIds)`, `assignRoles(userId, roleKeys)`,
`permissionsForUser(userId)`, `activeOwnerIds()` (for the last-owner rule).
`GET /roles` — `role:read`.

### users — `UsersService`

`createStaffUser({ displayName, email, title?, practitionerType, phone?, roleKeys, branchIds,
temporaryPassword })` — one transaction: identity (auth) → membership mirror → profile → branches
→ roles; email already registered → 409 `user.email_taken` (the D7 extension point: later this
attaches the existing identity instead). `updateStaffUser`, `deactivate(userId, reason)`,
`reactivate`, `resetPassword(userId, temporaryPassword)`, `list()`, `get(userId)`,
`listPractitioners()` (exported for later features), `sessionFor()`.

Invariants (pure, `users/domain/`): a tenant keeps at least one active owner (409
`user.last_owner`); a user cannot deactivate themselves (409 `user.self_deactivation`); a staff
user has at least one branch and one role. Changing roles also requires `role:write`.

| Route                            | Access                                 |
| -------------------------------- | -------------------------------------- |
| `GET /session`                   | A, pending ok                          |
| `GET /users`, `GET /users/:id`   | `user:read`                            |
| `POST /users`                    | `user:write`                           |
| `PATCH /users/:id`               | `user:write`                           |
| `POST /users/:id/deactivate`     | `user:write` (`{ reason }`)            |
| `POST /users/:id/reactivate`     | `user:write` (`{ reason }`)            |
| `POST /users/:id/reset-password` | `user:write` (`{ temporaryPassword }`) |

`GET /session` returns the extended `sessionSchema`: `user { id, displayName, email }`,
`platformAdmin`, `mustChangePassword`, `tenant { id, name, slug, timeZone, currency, locale } |
null`, `branch | null`, `branches: { id, name }[]` (active, assigned; all active branches for a
platform admin inside a tenant), `roleNames`, `permissions`, `idleTimeoutSeconds: number | null`
(null for trusted sessions).

### provisioning — `ProvisioningService`

| Route                                   | Access                                                 |
| --------------------------------------- | ------------------------------------------------------ |
| `GET /platform/tenants?status=&search=` | `platform:admin` — tenants with branch and user counts |
| `POST /platform/tenants`                | `platform:admin` — provision                           |
| `POST /platform/tenants/suspend`        | `platform:admin` — `{ tenantId, reason }`              |
| `POST /platform/tenants/reactivate`     | `platform:admin` — `{ tenantId, reason }`              |

Provisioning (`{ clinic: { name, slug, timeZone, currency, locale }, firstBranch: { name,
address?, phone? }, owner: { displayName, email, temporaryPassword } }`):

1. Fail fast: owner email taken → 409 `user.email_taken`.
2. `tenancy.createTenant` via `withoutTenant()` (commits).
3. `context.runInTenant(tenantId)` → one `TenantDb` transaction: audit `tenant.provision`, seed
   system roles (A5), create the first branch, `users.createStaffUser(owner, roles: ['owner'],
practitionerType: 'other')` (which mirrors organization, team and membership), publish
   `TenantProvisioned { tenantId, ownerUserId, firstBranchId }`.
4. If step 3 fails, compensate by deleting the tenant row (nothing else committed) and rethrow.

Suspend/reactivate run `runInTenant(tenantId)` → `tenancy.setStatus` under RLS, audited with the
reason.

### audit — `AuditService`

`record({ action, resourceType, resourceId, before?, after?, reason? })` joins the open
transaction and stamps actor, platform-admin flag and request id from CLS. A generic subscriber
records every domain event (`action` = event name, `resource_type` = `event`, `after` =
payload); `EventBus` gains a catch-all channel for it. `GET /audit?resourceType=&resourceId=&cursor=&limit=`
— `audit:read`, newest first, cursor = opaque `(occurred_at, id)`.

## Contracts (`packages/contracts`)

New files: `tenancy.ts` (tenant, tenant settings patch, branch, branch create/patch, room, room
batch, provision request, platform tenant list item/query, suspend request), `users.ts` (staff
user, create/patch, deactivate, reset password, practitioner types), `roles.ts` (role, system role
keys), `auth.ts` (sign-in body, password change body, sign-in problem extensions, password policy
`passwordSchema` ≥ 10 chars), `audit.ts` (entry, query). `session.ts` is extended.
`permissions.ts` adds `visit:void`, `visit:amend`, `payment:read`, `payment:write`,
`payment:refund`. `slugSchema` (lowercase, digits, hyphens, 3–48). `problemDetailsSchema` accepts
extension members (`attemptsLeft`, `lockedUntil`), which `DomainError` subclasses can expose
through a public `extensions` field.

## Frontend

### Structure

```
routes/__root.tsx                 Outlet + toaster
routes/login.tsx                  Login / Set a new password / suspended notice
routes/_app.tsx                   session guard (beforeLoad) + AppShell
routes/_app/{index,patients,visits,catalog,settings}.tsx
routes/_app/admin/index.tsx       → /admin/tenants
routes/_app/admin/tenants/index.tsx
routes/_app/admin/tenants/$tenantId.tsx   (?tab=overview|branches|users|settings)
features/auth/                    session query, sign-in/out, password change, idle timeout, branch switch
features/platform/                tenants list, new tenant panel, tenant detail tabs, acting tenant
components/ui/                    button, input, field, select, switch, chip-checkbox, pill, tabs,
                                  dialog, confirm-dialog (reason), dropdown-menu, right-panel,
                                  toast, skeleton-rows, empty/error states, spinner, save-bar
```

Radix primitives (`radix-ui`) back the dialog, dropdown menu and switch; styling follows the POC
values exactly. No global stores: server state in TanStack Query; the acting tenant is per-tab UI
state in `sessionStorage`.

### Guarding (`_app` beforeLoad)

No session (401) → `/login`; `auth.session_expired` → `/login?expired=1` (amber notice);
`mustChangePassword` → `/login` (shows "Set a new password"); `tenant.suspended` → `/login` with
a notice; platform admin without a tenant outside `/admin` → `/admin/tenants`; non-platform-admin
on `/admin/*` → `/`.

### Login

Pixel port of `Login.dc.html` without the demo buttons: centred 380px, card 12px radius, 40px
inputs, Show/Hide, "Trust this workstation for 30 days", 40px primary with spinner. Messages:
"Enter your email and password.", "Email or password is incorrect. N attempts left.", locked
state (grey button, message with the unlock time), amber session-expiry notice. When the session
says `mustChangePassword`, the same card becomes "Set a new password" (new + confirm, policy hint).

### Shell

- Sidebar clinic block: tenant name and "CLINIC · {branch}"; with more than one branch it is a
  dropdown (34px items like nav) that calls `POST /session/branch` and refetches everything.
- Nav visibility: Patients `patient:read`, Visits `visit:read`, Catalog `procedure:write`,
  Settings `tenant:write`, PLATFORM › Tenants `platformAdmin`.
- Footer: display name, first role name, sign-out icon button.
- Platform admin without a tenant: clinic block "Platform admin" with a 28px indigo "P" square;
  only the PLATFORM group.
- Acting in a tenant: full-width amber banner under the header "Managing {tenant} as platform
  admin" with **Exit** → `/admin/tenants/:id`.
- Idle timeout (only when `idleTimeoutSeconds` is set): activity (mousemove, keydown, click)
  resets the timer and sends a throttled `POST /session/touch` (≤ 1/min); the POC dialog opens 60s
  before the server limit with an amber countdown bar, "Sign out now" / "Stay signed in".

### Platform admin portal

As specified in the brief (tenants list with tabs, search, table, ⋯ menu with reasoned
suspend/reactivate; New tenant right panel with generated slug and temporary password; tenant
detail header and tabs Overview · Branches & rooms · Users · Settings; Catalog-style inline room
rows with dirty rows and sticky save bar; New/Edit user panel with role and branch chips).
Tenant-detail calls send `X-Tenant-Id` from the route param explicitly (per request, not the
acting-tenant state). "Manage in clinic" stores the acting tenant and navigates to `/`.

## Testing

- **Unit** (`domain/`, no I/O): sign-in throttle, idle decision, system-role matrix vs catalog,
  last-owner/self-deactivation rules, slug derivation, room batch validation (duplicate
  names/codes within a branch). Platform: `hasPermission` rules, `runInTenant`, event catch-all,
  problem extensions, route-declaration scan. Contracts: new schemas.
- **Integration** (Testcontainers Postgres, one container per run via Vitest `globalSetup`; the
  Nest app without Redis/queue/storage; supertest with real better-auth cookies):
  auth (bootstrap idempotent, sign-in, lockout countdown and unlock with a fake clock, trusted vs
  session cookie, idle expiry, pending password gate, password change, deactivated sign-in),
  provisioning (all artefacts + matrix + one `TenantProvisioned` audit row; compensation on slug
  clash), tenancy (branches/rooms CRUD + before/after audit; frontdesk 403 on `POST /branches`),
  users (create/update/deactivate/reset, branch switch, last owner), and the **tenant isolation
  suite** (tenant A's user cannot read or change B's branches, rooms, users, roles or audit through
  any service; `X-Tenant-Id` ignored for non-platform-admins; RLS on every tenant table).
- **Web unit**: login states, branch switcher visibility, nav by permission, idle timer (fake
  timers), acting-tenant header injection, slug/password generators.
- **Playwright** (real API + DB): login as bootstrapped admin → create tenant + user → sign out →
  new user signs in, sets a new password, sees the clinic shell with the branch name. The existing
  stubbed shell tests are updated to the new session contract.

## Operations

- New env: `AUTH_SECRET` (≥ 32 chars), `AUTH_BASE_URL` (the SPA origin), optional
  `AUTH_TRUSTED_ORIGINS`. Validated at boot.
- `pnpm --filter @dcm/api admin:bootstrap --email … --password … [--name …]`.
- `main.ts` creates the app with `rawBody: true`.

## Multi-tenant users (D7) — extension points, not built

- The auth user and `auth_members` are global; a second membership is a second `auth_members` row.
- `SessionGuard.resolveTenant` is the single place that picks the tenant; a picker adds a
  `POST /session/tenant` that sets `activeOrganizationId` after checking membership, and the
  "several memberships" branch returns `auth.tenant_selection_required` instead of the first one.
- `staff_profiles`, `staff_branches` and `user_roles` are already per tenant.
- `createStaffUser`'s `user.email_taken` becomes "attach existing identity to this tenant".
- Deactivation currently bans the global identity; with several tenants it becomes
  membership removal plus profile deactivation.

## Documentation

ADR-0007 (rooms), 0008 (platform admin acting in a tenant; tenant never in the URL), 0009 (module
graph: provisioning, roles/users flip, session in users, direct role seeding), 0010 (permissions
carried in CLS), 0011 (identity-plane tables), 0012 (staff accounts with temporary passwords;
supersedes parts of 0004), 0013 (sign-in lockout and session lifetimes). CLAUDE.md §4 (module map:
rooms, provisioning, edges, chair → room), §5 (identity plane, `tenants` self policy), §6 (roles
`owner/dentist/assistant/frontdesk`, CLS permissions, route access decorators), §8 (chair → room),
§10 (audit columns). `docs/modules/*` updated and `provisioning.md` added.
