# ADR-0011: better-auth tables are a global identity plane without RLS

- Status: Accepted
- Date: 2026-09-26

## Context

better-auth reads users, sessions and memberships on its own connection, before any tenant is
known (sign-in, session lookup, tenant resolution). Tenant RLS on those tables would hide every
row from it; routing it through the BYPASSRLS role would bypass RLS quietly (CLAUDE.md §5).

## Decision

- better-auth's tables are renamed `auth_*` (`auth_users`, `auth_sessions`, `auth_accounts`,
  `auth_verifications`, `auth_organizations`, `auth_members`, `auth_teams`, `auth_team_members`,
  `auth_invitations`) plus `auth_sign_in_throttle`. They have no `tenant_id` and no RLS, and only
  the `auth` module touches them — on the runtime role `dcm_app`, never `dcm_admin`.
- The auth user is global (D7). `auth_members` is the global user → tenant index that tenant
  resolution (and a future tenant picker) reads. Organization id = tenant id; team id = branch id.
- Organizations, teams, members and team members are a **mirror** written by `auth` inside the
  caller's open transaction (`IdentityDb` joins `TenantDb`'s transaction), so a staff user's
  identity, membership, profile and roles commit together. The app's own truth about staff lives
  in RLS tables (`staff_profiles`, `staff_branches`, `user_roles`).
- Only `POST /auth/sign-in/email` and `POST /auth/sign-out` are exposed over HTTP; the
  organization and admin plugins are driven server-side.
- A unit test compares the Drizzle schema with `getAuthTables()` for our plugin set.

## Consequences

- Isolation for the identity plane rests on `auth` being its only reader and writer (lint-enforced
  module boundaries) rather than on RLS; nothing tenant-scoped beyond membership is stored there.
- better-auth upgrades that add fields fail the parity test first.
