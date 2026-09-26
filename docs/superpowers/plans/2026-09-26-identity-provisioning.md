# Identity & Provisioning Implementation Plan

> **For agentic workers:** executed inline in the authoring session (the user asked for plan →
> implementation in PR-sized steps). Steps use checkbox (`- [ ]`) syntax for tracking. As in the
> scaffold plan, code lives in the commits, not in this file; each task names its files, the test
> cases written first, and the verification commands.

**Goal:** Feature 1 of the MVP per `docs/superpowers/specs/2026-09-26-identity-provisioning-design.md`.

**Architecture:** better-auth wrapped by `auth` (identity plane, no RLS); tenancy/roles/users own
RLS tables; permissions resolved into CLS by `authorization`; `provisioning` orchestrates; `audit`
records inside the same transaction. SPA gets Login, a session-aware shell and the `/admin` portal.

**Tech Stack:** better-auth 1.7 (Drizzle adapter, organization + admin plugins), NestJS 11.2,
Drizzle 0.45, Postgres 17 RLS, Zod 4, React 19, TanStack Router/Query, Radix primitives, Vitest 5,
Testcontainers, Playwright.

**Gate for every step (a)–(e):** `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green,
docs for the touched modules updated, one commit per task on `feat/identity-provisioning`.

---

## Step (a) — platform groundwork, audit, auth, platform-admin bootstrap

### Task A1: Contracts — permissions, auth, session, audit

**Files:** `packages/contracts/src/{permissions,auth,session,audit,common}.ts` (+ specs), `index.ts`.

- [ ] Tests first: catalog contains `visit:void`, `visit:amend`, `payment:read|write|refund`;
      `passwordSchema` rejects < 10 and > 128 chars; `signInRequestSchema` lower-cases/trims email
      and defaults `rememberMe` to false; `problemDetailsSchema` keeps `attemptsLeft`/`lockedUntil`;
      `sessionSchema` requires `platformAdmin`, `branches`, `mustChangePassword`,
      `idleTimeoutSeconds`; `slugSchema` accepts `north-gate-2`, rejects `North Gate`, `ab`, `-x`;
      `auditEntrySchema` round-trips.
- [ ] Implement; `pnpm --filter @dcm/contracts test build`.
- [ ] Update the web e2e/unit session fixtures to the new shape so the workspace still typechecks.
- [ ] Commit `feat(contracts): identity schemas and extended permission catalog`.

### Task A2: Platform — permissions in CLS, runInTenant, route access, clock, problem extensions

**Files:** `platform/cls/{app-cls-store,request-context,permission-denied.error}.ts`,
`platform/http/route-access.ts`, `platform/kernel/clock.ts`, `platform/clock/clock.module.ts`,
`platform/errors/problem-details.ts`, `platform/kernel/domain-error.ts`,
`platform/db/tenant-db.ts` (`currentTransaction()`), `platform/events/event-bus.ts` (catch-all
`ANY_DOMAIN_EVENT`), `platform/health/health.controller.ts` (`@Public()`).

- [ ] Tests first (`request-context.spec.ts`): `hasPermission` — system passes; platform admin in
      tenant passes anything; platform admin outside tenant only `platform:admin`; user decided by
      resolved set; nothing resolved → false. `requirePermission` throws `PermissionDeniedError`
      (code `forbidden`, kind `forbidden`). `runInTenant` keeps requestId/userId/platformAdmin, sets
      tenant, refuses plain users (`PlatformAccessDeniedError`).
- [ ] Tests first: problem details include `extensions` of a DomainError; event bus emits on the
      catch-all channel too; `TenantDb.currentTransaction()` is undefined outside `run` (unit, fake db).
- [ ] Implement. `pnpm --filter @dcm/api test:unit`.
- [ ] Commit `feat(api): permission carrier, tenant entry, route access and clock in platform`.

### Task A3: Integration test harness

**Files:** `apps/api/test/support/{global-setup,postgres,test-app,session}.ts`,
`vitest.config.mts` (integration `globalSetup`), `test/integration/tenant-isolation.int-spec.ts`.

- [ ] One Postgres container per run (roles + migrations), URLs provided through Vitest `provide`;
      `connectTestDatabase()` returns owner/app/admin pools. `createTestApp()` builds the Nest app from
      the platform core (no Redis/queue/storage/health) + domain modules with an injectable fake
      clock and test config. `signIn(app, email, password)` returns a supertest agent with cookies.
- [ ] Existing isolation spec moves to the shared container; still green.
- [ ] Commit `test(api): shared Testcontainers database and app harness`.

### Task A4: `audit` module

**Files:** `modules/audit/{audit.module,index}.ts`, `persistence/{schema,audit.repository}.ts`,
`application/{audit.service,domain-event.subscriber}.ts`, `http/audit.controller.ts`,
`domain/audit-cursor.ts` (+ spec), migration, `docs/modules/audit.md`.

- [ ] Unit: cursor encode/decode round-trip, rejects garbage (`audit.invalid_cursor`).
- [ ] Integration: `record()` inside `TenantDb.run` commits/rolls back with the transaction; stamps
      actor kind, user, platform-admin flag, request id; `dcm_app` UPDATE/DELETE on `audit_log` fail
      (permission denied); subscriber records a published event; listing is newest-first with a
      working cursor; tenant B sees none of A's rows.
- [ ] `pnpm --filter @dcm/api db:generate` → review SQL; append `REVOKE UPDATE, DELETE`.
- [ ] Commit `feat(audit): append-only audit log, event subscriber and query API`.

### Task A5: `auth` — schema, better-auth instance, HTTP mount, throttle

**Files:** `modules/auth/persistence/{schema,identity.repository,sign-in-throttle.repository}.ts`,
`modules/auth/application/{better-auth.factory,auth.service,sign-in.service}.ts`,
`modules/auth/domain/{sign-in-throttle,idle-timeout}.ts` (+ specs),
`modules/auth/http/{auth-http.controller,better-auth-errors}.ts`, `auth.module.ts`, `index.ts`,
`platform/config/config.schema.ts` (`AUTH_SECRET`, `AUTH_BASE_URL`, `AUTH_TRUSTED_ORIGINS`),
`.env.example`, `main.ts` (`rawBody: true`), migration.

- [ ] Unit: throttle — 4 failures leave 1 attempt; 5th locks for 15 min; locked rejects even valid;
      expired lock resets the count; success clears. Idle — trusted never idles; untrusted expires at
      > 15 min; touch only when older than 60 s. Schema parity with `getAuthTables(options)`.
      Error mapping table (better-auth code → problem code/status).
- [ ] Integration: sign-up path 404; sign-in with the bootstrapped admin sets a `dcm.session_token`
      cookie; `rememberMe: true` → cookie `Max-Age` 30 days, false → no `Max-Age`; wrong password →
      401 `auth.invalid_credentials` with `attemptsLeft` 4,3,2,1 then `auth.account_locked`; unknown
      email behaves the same; clock +15 min unlocks.
- [ ] Commit `feat(auth): better-auth identity plane with throttled sign-in`.

### Task A6: Session guard, permission guard (platform-admin rules), session routes, bootstrap CLI

**Files:** `modules/auth/http/{session-guard,session.controller}.ts`,
`modules/auth/application/tenant-resolver.ts`, `modules/authorization/{authorization.module,index}.ts`,
`modules/authorization/http/{permission.guard,require-permission.decorator}.ts`,
`modules/authorization/application/authorization.service.ts`,
`modules/users/http/session-read.controller.ts` (identity-only session for now),
`src/cli/bootstrap-admin.ts`, `apps/api/package.json` (`admin:bootstrap`).

- [ ] Unit: route-declaration scan — every controller handler has `@Public`, `@Authenticated` or
      `@RequirePermission`.
- [ ] Integration: no cookie → 401 `unauthenticated` problem+json; platform admin `GET /session` →
      `platformAdmin: true`, `tenant: null`, `permissions: ['platform:admin']`; untrusted session idle
      16 min → 401 `auth.session_expired`; touch keeps it alive; bootstrap twice → one user, role
      `platform_admin`, second run reports "already exists"; banned user → 403
      `auth.account_deactivated`.
- [ ] Docs: `docs/modules/{auth,authorization}.md`; ADR-0010, 0011, 0013; `docs/adr/README.md`;
      CLAUDE.md §5/§6.
- [ ] Gate. Commit `feat(auth): session guard, permission guard and platform admin bootstrap`.

## Step (b) — tenancy, branches, rooms, provisioning (tenant + first branch)

### Task B1: `tenancy` persistence and domain

**Files:** `modules/tenancy/persistence/{schema,tenants.repository,branches.repository,rooms.repository}.ts`,
`modules/tenancy/domain/{slug,room-batch,tenant-errors}.ts` (+ specs), migration (incl. `tenant_self`
policy on `tenants`).

- [ ] Unit: `deriveSlug('Northgate Dental — Main')` → `northgate-dental-main`; room batch rejects
      duplicate names/codes within a branch (case-insensitive) and empty names.
- [ ] Commit `feat(tenancy): tenants, branches and rooms tables`.

### Task B2: `TenancyService` + routes

**Files:** `modules/tenancy/application/tenancy.service.ts`, `http/{tenant,branches,rooms}.controller.ts`,
`index.ts`, `tenancy.module.ts`, `docs/modules/tenancy.md`.

- [ ] Integration: platform admin via `X-Tenant-Id` creates/updates/deactivates branches and saves a
      room batch; each change has an audit row with before/after; duplicate branch name → 409
      `branch.name_taken`; `GET /tenant` under RLS returns only the current tenant; tenant settings
      patch validates IANA zone/currency.
- [ ] Commit `feat(tenancy): tenant settings, branches and rooms services and API`.

### Task B3: `provisioning` module (tenant + first branch + organization mirror)

**Files:** `modules/provisioning/**`, `modules/auth/application/auth.service.ts` (`syncOrganization`),
`docs/modules/provisioning.md`, ADR-0008, ADR-0009 (draft; completed in C4), ADR-0007,
CLAUDE.md §4/§8 (rooms, chair → room).

- [ ] Integration: `POST /platform/tenants` creates tenant, first branch, `auth_organizations` row with
      the tenant id; slug clash → 409 `tenant.slug_taken` and nothing left behind; list shows branch
      counts; suspend/reactivate with reason are audited; suspended tenant → 403 `tenant.suspended`
      for its (future) users but not the platform admin; non-admin → 403 `forbidden`.
- [ ] Gate. Commit `feat(provisioning): platform tenant provisioning and listing`.

## Step (c) — roles, users, authorization by role, owner provisioning

### Task C1: `roles`

**Files:** `modules/roles/{persistence,domain,application,http}/**`, migration, `docs/modules/roles.md`.

- [ ] Unit: system role matrix equals the D5 table (per-role snapshot); every permission is in the
      catalog; owner lacks only `platform:admin`.
- [ ] Integration: `seedSystemRoles()` idempotent; `assignRoles` replaces the set; unknown role key →
      422 `role.unknown`; `permissionsForUser` unions roles.
- [ ] Commit `feat(roles): system roles, assignments and permission lookup`.

### Task C2: `users` + auth membership mirror

**Files:** `modules/users/{persistence,domain,application,http}/**`,
`modules/auth/application/auth.service.ts` (`createIdentity`, `syncMembership`, `setPassword`,
`deactivate`, `reactivate`, `isEmailTaken`), migration, `docs/modules/users.md`.

- [ ] Unit: last-owner rule; self-deactivation rule; at least one role and branch.
- [ ] Integration: create staff user → identity, member, team members, profile, branches, roles in
      one transaction (failure in roles rolls back the identity); email taken → 409; update roles and
      branches re-syncs the mirror; deactivate bans + revokes sessions and emits `MemberRemoved`;
      reactivate; reset password sets `mustChangePassword`; audit rows never contain the password.
- [ ] Commit `feat(users): staff profiles with identity, branches and roles`.

### Task C3: Permission resolution by role, branch switch, password change, full session

**Files:** `modules/authorization/http/permission.guard.ts`, `modules/auth/http/session.controller.ts`,
`modules/users/http/session-read.controller.ts`, `modules/users/application/session.service.ts`.

- [ ] Integration: frontdesk `POST /branches` → 403 `forbidden`; frontdesk `GET /session` has
      exactly the D5 frontdesk permissions; `mustChangePassword` blocks `GET /branches` with 403
      `auth.password_change_required`, allows `GET /session`; password change clears it; two-branch
      user switches branch (session reflects it), unassigned branch → 403 `session.branch_not_assigned`.
- [ ] Commit `feat(authorization): role-based permissions, branch switch and password change`.

### Task C4: Owner provisioning + tenant isolation suite

**Files:** `modules/provisioning/application/provisioning.service.ts`,
`test/integration/tenant-isolation-services.int-spec.ts`, ADR-0009 (final), ADR-0012,
CLAUDE.md §4/§6/§10, `docs/modules/*` status lines.

- [ ] Integration: provisioning creates owner (identity + profile + owner role + branch) and the four
      roles with the matrix, and exactly one `TenantProvisioned` audit row; duplicate owner email →
      409 and nothing created. Isolation: user of A gets empty lists / 404 for B's branches, rooms,
      users, roles, audit; `X-Tenant-Id: B` from A's user is ignored; RLS enabled on every tenant table.
- [ ] Gate. Commit `feat(provisioning): owner account and system roles on provisioning`.

## Step (d) — SPA login and session-aware shell

### Task D1: UI primitives

**Files:** `apps/web/src/components/ui/{button,input,field,spinner,dialog,dropdown-menu,toast}.tsx`,
`apps/web/package.json` (`radix-ui`, `lucide-react`).

- [ ] Port exact POC values (heights, radii, colours, focus ring). Toast context (max 3, 5 s).
- [ ] Commit `feat(web): UI primitives per the POC design system`.

### Task D2: Auth client, login route, set-new-password

**Files:** `features/auth/{session,auth-api,acting-tenant,login-form,set-password-form}.ts(x)`,
`routes/login.tsx`, `routes/__root.tsx`, `routes/_app.tsx` (+ move screens under `_app/`),
`locales/*/auth.json`, `lib/api.ts` (X-Tenant-Id + session-expired handling).

- [ ] Unit: empty submit → "Enter your email and password."; 401 with `attemptsLeft: 3` → "Email or
      password is incorrect. 3 attempts left."; locked → grey disabled button; expired notice with
      `?expired=1`; `apiFetch` adds `X-Tenant-Id` when acting.
- [ ] Commit `feat(web): login and first-sign-in password change`.

### Task D3: Shell — guard, branch switcher, nav by permission, sign-out, idle timeout, acting banner

**Files:** `shell/{sidebar,app-shell,app-header,branch-switcher,idle-timeout-dialog,acting-tenant-banner,nav-items}.tsx`,
`features/auth/use-idle-timeout.ts` (+ spec), `locales/*/shell.json`.

- [ ] Unit: switcher only with > 1 branch; frontdesk sees Patients/Visits only; idle hook opens the
      dialog 60 s before the limit, resets on activity, signs out at 0 (fake timers).
- [ ] Update `e2e/shell.spec.ts` to the new session contract.
- [ ] Gate. Commit `feat(web): session-aware shell with branch switcher and idle timeout`.

## Step (e) — SPA platform admin portal

### Task E1: Remaining primitives

**Files:** `components/ui/{select,switch,chip-checkbox,pill,tabs,right-panel,confirm-dialog,skeleton-rows,state-panels,save-bar,table}.tsx`.

- [ ] Commit `feat(web): list, panel and form primitives`.

### Task E2: Tenants list + New tenant panel

**Files:** `features/platform/{tenants-api,tenants-list,new-tenant-panel,password-generator}.ts(x)`,
`routes/_app/admin/{index,tenants/index}.tsx`, `locales/*/admin.json`.

- [ ] Unit: slug auto-derives until edited by hand; generated password satisfies `passwordSchema`.
- [ ] Commit `feat(web): platform tenants list and provisioning panel`.

### Task E3: Tenant detail — overview, branches & rooms, users, settings; Manage in clinic

**Files:** `features/platform/tenant-detail/**`, `routes/_app/admin/tenants/$tenantId.tsx`.

- [ ] Unit: rooms editor dirty tracking (counts, discard, validation message blocks save).
- [ ] Commit `feat(web): tenant detail with branches, rooms, users and settings`.

### Task E4: Playwright end-to-end and final docs

**Files:** `apps/web/e2e/{global-setup,identity.spec}.ts`, `playwright.config.ts`, README, CLAUDE.md,
`docs/adr/README.md`.

- [ ] E2E: login as bootstrapped admin → create tenant + user → sign out → user signs in, sets a new
      password, sees the shell with the branch name.
- [ ] Full gate + e2e. Commit `test(web): identity end-to-end flow`.
