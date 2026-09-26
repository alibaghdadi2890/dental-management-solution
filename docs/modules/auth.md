# `auth` module

**Status:** skeleton — module class and `index.ts` only.

## Purpose

Who are you. Wraps better-auth (Drizzle adapter, organization plugin): identity, credentials, sessions, MFA, org membership and invitations. A global guard resolves the session and fills CLS with `{ userId, tenantId, branchId?, platformAdmin }`. Serves the session contract (`sessionSchema` in `@dcm/contracts`). Nothing else talks to better-auth.

## Owns

better-auth tables (users, sessions, accounts, organizations, members, invitations, teams).

## Public API (`index.ts`)

`AuthModule`. Planned: `AuthService` (current session), global session guard.

## Events

- Emits: `MemberJoined`, `MemberRemoved` (planned).
- Consumes: `TenantProvisioned` (create organization / owner invitation).

## Depends on

tenancy

## Permissions

None of its own; sign-in/up routes are the only undecorated routes besides health.
