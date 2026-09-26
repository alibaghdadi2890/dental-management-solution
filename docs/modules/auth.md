# `auth` module

**Status:** implemented — sign-in/out, lockout, session guard, idle timeout, tenant and branch
resolution, organization mirror, platform-admin bootstrap. Staff identities, branch switch and
password change arrive with `users` (step C).

## Purpose

Who are you. Wraps better-auth (Drizzle adapter, organization plugin with teams, admin plugin).
Nothing else talks to better-auth. Organization = tenant (same id), team = branch (same id),
admin-plugin role `platform_admin` = back-office operator, ban = deactivate.

## Owns

The identity plane (ADR-0011): `auth_users`, `auth_sessions`, `auth_accounts`,
`auth_verifications`, `auth_organizations`, `auth_members`, `auth_teams`, `auth_team_members`,
`auth_invitations` (unused), `auth_sign_in_throttle`. Global, no `tenant_id`, no RLS; written
inside the caller's transaction through `IdentityDb`.

## Request pipeline

`SessionGuard` (registered first by `AuthorizationModule`) → `SessionResolver.authenticate`:

1. better-auth session from the cookie, else `401 unauthenticated`.
2. Idle timeout for untrusted sessions (15 min, `401 auth.session_expired`); activity recorded at
   most once a minute (ADR-0013).
3. Tenant: platform admins from `X-Tenant-Id` only (ADR-0008); clinic users from their
   membership — the extension point for users of several tenants (D7).
4. Tenant must exist and, for clinic users, be active (`403 tenant.suspended`).
5. Branch: the session's active branch if still an active assigned branch, else the first
   (`BranchResolver`); any active branch for platform admins.
6. CLS ← `{ userId, tenantId, branchId, platformAdmin }`.
7. A pending temporary password blocks every route not marked `@AllowPendingPasswordChange()`
   (`403 auth.password_change_required`).

## Public API (`index.ts`)

`AuthModule`, `AuthService` (`createIdentity`, `syncOrganization`, `memberCountsByTenant`,
`isEmailTaken`, `bootstrapPlatformAdmin`), `SessionGuard`, `BranchResolver`,
`AuthenticatedSession`, `CurrentSession`, `AllowPendingPasswordChange`, `idleTimeoutSeconds`,
`EmailTakenError`, `TENANT_HEADER`.

## HTTP

| Route                      | Access                         |
| -------------------------- | ------------------------------ |
| `POST /auth/sign-in/email` | Public — throttled (D11)       |
| `POST /auth/sign-out`      | Public                         |
| `POST /session/touch`      | Authenticated — idle heartbeat |

No other better-auth endpoint is reachable.

## CLI

`pnpm --filter @dcm/api admin:bootstrap --email … --password … [--name …]` creates or promotes the
first platform admin (system actor, `withoutTenant`, idempotent, never changes a password).

## Events

- Emits: `MemberJoined`, `MemberRemoved` (step C).
- Consumes: —

## Depends on

tenancy

## Permissions

None of its own.
