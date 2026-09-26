# CLAUDE.md — Dental Clinic Management Platform

This file is the source of truth for how this codebase is designed and how code must be written.
Read it fully before making changes. When a request conflicts with a rule here, stop and flag it
instead of silently breaking the rule.

## 1. What we are building

A multi-tenant SaaS for dental clinics. One deployable backend (modular monolith), one React SPA.
Features ship in phases:

- **Phase 1 (no AI):** tenancy, auth/RBAC, patients, scheduling, clinical (visits, treatment plans), basic billing,
  files (X-rays/documents), audit log, reminders.
- **Phase 2:** agentic assistant (chat first, voice later) that operates the system through a
  toolbox of application services. No direct DB access, no RAG.
- **Later:** insurance/claims, inventory, reporting, patient portal, integrations.

Design for growth from day one: new features arrive as new modules, never as bloat inside existing
ones. Frontend flows for phase 1 follow the Claude Design POC; do not invent screens that diverge
from it without asking.

## 2. Stack (fixed — do not substitute)

| Layer         | Choice                                                       |
|---------------|--------------------------------------------------------------|
| Backend       | NestJS 11+, TypeScript (strict), Node LTS                    |
| Database      | PostgreSQL 16+, single pooled DB, Row-Level Security          |
| ORM           | Drizzle ORM + drizzle-kit migrations                          |
| Validation    | Zod everywhere (`nestjs-zod` pipes; no class-validator)       |
| Queue/cache   | Redis + BullMQ                                                |
| Auth          | better-auth (Drizzle adapter, organization plugin)            |
| Storage       | S3-compatible object storage                                  |
| AI            | Vercel AI SDK (`ai`) — provider-agnostic; OpenAI is the first provider, never the only one |
| Observability | pino structured logs, OpenTelemetry traces                    |
| Frontend      | React + Vite + TypeScript, TanStack Router/Query, shadcn/ui + Tailwind |
| Monorepo      | pnpm workspaces + Turborepo                                   |
| Testing       | Vitest (unit/integration), Testcontainers for Postgres/Redis, Playwright (e2e) |

Not allowed: Next.js, Prisma, class-validator, LangChain, direct `openai` SDK calls in domain code,
any second ORM, any per-tenant database.

## 3. Repository layout

```
apps/
  api/                 NestJS application
    src/
      modules/         one folder per domain module (see §4)
      platform/        cross-cutting infra: db, cls, events, queue, storage, logging, otel
                       (platform/kernel: pure DomainError + ids, the only platform code domain/ may import)
      main.ts
    migrations/        drizzle-kit migrations (committed, never edited after merge)
  web/                 React SPA
packages/
  contracts/           Zod schemas + inferred types + permission catalog, shared by api, web, agent
  config/              shared eslint/tsconfig/prettier
docs/
  adr/                 Architecture Decision Records (one file per decision, numbered)
  modules/             one page per module: purpose, owned tables, public API, events
docker/                local-dev infrastructure (Postgres roles init, etc.)
Dental Clinic POC/     Claude Design POC: the visual source of truth for phase 1 screens
```

`packages/contracts` is the only code shared between backend and frontend. It contains no runtime
logic beyond Zod schemas and pure helpers.

## 4. Modular monolith — the boundary rules

Every feature is a NestJS module under `apps/api/src/modules/<name>/`. A module is a bounded
context. Structure inside a module:

```
modules/<name>/
  <name>.module.ts
  http/            controllers + route-level DTO wiring (Zod)
  application/     services (use cases) — the module's public API
  domain/          pure logic: entities, state machines, interval math, invariants; no Nest, no DB
  persistence/     Drizzle schema for this module's tables + repositories
  events/          domain events this module emits (types + names)
  tools/           agent tool definitions exposing application services (phase 2)
  index.ts         the ONLY file other modules may import from
```

**Hard rules (enforced by `eslint-plugin-boundaries` in CI):**

1. A module owns its tables. No module reads or writes another module's tables — not via Drizzle,
   not via raw SQL, not via joins. If you need data from another module, call its exported service.
2. Cross-module imports go through `modules/<name>/index.ts` only. Never deep-import.
3. Synchronous cross-module *reads* use the other module's application service.
   Cross-module *reactions* ("when an appointment is completed, create an invoice") use domain
   events. Never call another module's service just to trigger side effects.
4. Dependency direction is acyclic. If module A imports B, B must not import A. Break cycles with
   events or by extracting a third module — never with `forwardRef`.
5. `domain/` folders are pure TypeScript: no decorators, no injection, no I/O. They must be
   testable with plain Vitest and no container.
6. `platform/` is infrastructure only. It knows nothing about patients, appointments, or clinics.
7. The `assistant` module (phase 2) may depend on any module's `tools/`. No module may depend on
   `assistant`.
8. Adding a new feature = adding a new module + a `docs/modules/<name>.md` page. Do not grow an
   existing module past its stated purpose.

### Module map (phase 1)

| Module          | Owns                                                                 | Depends on            |
|-----------------|----------------------------------------------------------------------|-----------------------|
| `tenancy`       | tenants (clinics), branches, tenant settings, timezone, provisioning | —                     |
| `auth`          | better-auth integration, sessions, sign-in/up, org membership sync, tenant resolution into request context | tenancy |
| `users`         | app-level user/staff profile (name, title, dentist/hygienist/receptionist, contact), links to auth identity | auth, tenancy |
| `roles`         | role definitions per tenant, system roles, role → permission assignments, user → role assignments | users, tenancy |
| `authorization` | permission catalog (from `contracts`), `can(user, action, resource)` evaluation, HTTP guard + decorator, agent tool guard | roles |
| `audit`         | append-only audit log (who/what/when/tenant/before/after), query API | — (consumes events from all) |
| `patients`      | patient records, contacts, medical alerts/allergies, odontogram, notes | tenancy |
| `scheduling`    | resources (practitioners, chairs, equipment), availability templates + exceptions, slot search, appointments + state machine, waitlist | users, patients, clinical, tenancy (reacts to clinical events) |
| `clinical`      | visits (clinical encounters: patient, practitioner, date, services performed, notes, status), procedure/service catalog, treatment plans, planned procedures, clinical charting linked to visits | patients, users |
| `billing`       | invoices, payments, price lists                                     | patients, clinical    |
| `files`         | S3 object metadata, upload/download signed URLs, attachment links   | tenancy               |
| `notifications` | reminders, templates, SMS/WhatsApp/email delivery via BullMQ         | tenancy (reacts to scheduling events) |
| `imports`       | import jobs: uploaded file, column mapping, staged rows + validation, preview, commit progress; writes only through `patients` and `clinical` services | patients, clinical, tenancy |

Phase 2 adds `assistant` (agent runtime, conversations, tool registry, confirmation workflow) and
`voice` (STT/TTS adapters in front of `assistant`).

## 5. Multi-tenancy

- Single pooled Postgres database. Every tenant-owned table has `tenant_id uuid NOT NULL` with an
  index, and an RLS policy `USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)`
  (same `WITH CHECK`). Use the helpers in `platform/db/columns.ts`; `tenant_id` defaults from the
  transaction setting, so inserts never pass it.
- Tenant context is set **once per request or job** into `nestjs-cls` (AsyncLocalStorage). The
  DB layer opens every transaction with `SET LOCAL app.tenant_id = <id>` from CLS.
- Repositories never accept `tenantId` as a parameter and never filter by it manually; RLS is the
  guarantee, CLS is the plumbing. A query that "forgets" the tenant returns nothing, not everything.
- Background jobs (BullMQ) carry `tenantId` in the job payload and re-establish CLS before doing
  any work. A job without a tenant context must fail loudly.
- Cross-tenant operations (platform admin, migrations) use an explicit `withoutTenant()` helper
  that is grep-able and requires a `platform:admin` permission. Never bypass RLS quietly.
  It runs on a separate BYPASSRLS role (`dcm_admin`); the runtime role (`dcm_app`) owns no tables.
- Tenants (clinics) are created only by platform admins (`tenancy` provisioning via
  `withoutTenant()`). There is no public sign-up; clinic owners are invited.
- Tenant = clinic (better-auth organization). Branch = better-auth team. Timezone is stored per
  tenant as an IANA name; all "local time" logic uses it.
- No tenant-specific code paths. Differences between tenants are configuration, never `if (tenant === ...)`.

## 6. Auth, users, roles, authorization (four modules, four responsibilities)

**`auth` — who are you.** Wraps better-auth. Owns identity, credentials, sessions, MFA, org
membership and invitations (via the organization plugin). Exposes: current session, current user
id, active tenant id. Populates CLS with `{ userId, tenantId, branchId? }` in a global guard.
Nothing else in the codebase talks to better-auth directly.

**`users` — who are you *here*.** Application-level profile and staff record for a user within a
tenant (display name, professional title, practitioner type, contact, active flag). Keyed by
`(tenant_id, auth_user_id)`. Does not know about permissions.

**`roles` — what roles exist and who holds them.** Permission catalog lives in
`packages/contracts/permissions.ts` as a typed constant (`patient:read`, `appointment:write`,
`invoice:void`, `assistant:use`, …). Roles are per tenant: system roles seeded on provisioning
(`owner`, `dentist`, `hygienist`, `receptionist`, `accountant`, `readonly`) plus custom roles a
tenant admin can create. A user may hold multiple roles in a tenant.

**`authorization` — may you do this.** One evaluation function:
`can(actor, permission, resource?)`. Exposed three ways: a `@RequirePermission()` route decorator
+ guard, an injectable `AuthorizationService` for use inside application services, and the guard
applied to every agent tool. Deny by default. Resource-level rules (e.g. a dentist sees only their
own appointments if the tenant enables that setting) live here, not scattered in repositories.

Rules:
- Every controller route declares a permission. No undecorated routes except health and auth.
- Every mutation in an application service re-checks permission (the controller check is not the
  last line of defense; agent tools and jobs call services too).
- Permission strings are the shared vocabulary between backend, frontend (to hide UI), and agent
  tools. Never invent one inline; add it to the catalog.
- SPA and API sit under one domain (cookie sessions). If that changes, use the better-auth bearer
  plugin — never a hand-rolled JWT.

## 7. Data and persistence

- Drizzle schema per module in `persistence/schema.ts`; `drizzle.config.ts` collects them with a
  glob for migrations only (no aggregating import, so `platform/` never imports modules). Migrations are generated with drizzle-kit, reviewed by a human, and
  committed. Never edit a migration that has been merged.
- Primary keys: `uuid` (v7 preferred), generated in the application.
- Timestamps: `timestamptz`, UTC, `created_at`/`updated_at` on every table.
- Soft delete (`deleted_at`) for patient-facing records; hard delete only for pure junction/cache rows.
- Money: `numeric(12,2)` + a `currency` column. Never floats.
- Enums: Postgres enums for stable lifecycles (appointment status); text + Zod for anything a
  tenant can extend.
- Concurrency-sensitive writes (booking) use DB constraints (exclusion constraints on
  `tstzrange`) or `SELECT ... FOR UPDATE`. Never "check then insert" without a lock.
- No ORM in `domain/`. Repositories map rows to domain types at the persistence boundary.

## 8. Scheduling module — specific invariants

- Resource-based: an appointment reserves one or more resources (practitioner, chair, equipment).
  A slot is free only if every required resource is free.
- Availability is materialized: weekly templates + exceptions are expanded into concrete
  availability windows per resource per day (rolling horizon, refreshed by a job). Slot search
  queries the materialized table; it never evaluates recurrence rules on the request path.
- Slot search and interval arithmetic live in `scheduling/domain/` as pure functions with
  exhaustive tests (adjacent intervals, overlaps, DST transitions, midnight crossings).
- Double booking is prevented by a Postgres exclusion constraint on
  `(resource_id, tstzrange(starts_at, ends_at)) WHERE status NOT IN ('cancelled','no_show')`.
- Appointment lifecycle is an explicit state machine in `domain/`:
  `booked → confirmed → checked_in → in_chair → completed`, with `cancelled`, `no_show`,
  `rescheduled` as terminal branches. Illegal transitions throw. Every transition emits an event.
- Rescheduling creates a new appointment linked by `lineage_id`; history is never rewritten.
- Recurring series generate concrete occurrences; a rule is stored for regeneration only.
- Durations come from the procedure catalog (owned by `clinical`); overrides are stored on the
  appointment.

## 9. Events, jobs, and side effects

- Domain events are typed objects in `modules/<name>/events/`, named `<Entity><PastTense>`
  (`AppointmentCompleted`, `PatientCreated`). Payload = ids + the minimal facts, never full rows.
- In-process event bus (`platform/events`) for phase 1. Handlers that must survive a crash or take
  time (notifications, materialization, PDF generation) enqueue a BullMQ job instead of doing the
  work in the handler.
- Every event is also persisted to the `audit` module's log via a single generic subscriber.
- Jobs are idempotent (use a deterministic `jobId`), carry `tenantId`, and are retried with
  backoff. Failed jobs go to a dead-letter queue that is monitored.
- Never call external services (SMS, email, S3, LLM) synchronously inside a request that mutates
  state, except signed-URL generation.

## 10. Audit

- Append-only table, no updates, no deletes, RLS-scoped.
- Fields: `id, tenant_id, actor_user_id, actor_kind (user|agent|system|job), action, resource_type,
  resource_id, before (jsonb), after (jsonb), request_id, occurred_at`.
- Every mutation through application services produces an audit entry. Agent tool calls produce
  an entry with `actor_kind = 'agent'` plus the originating user id and the tool arguments.

## 11. Agentic assistant (phase 2) — design constraints that apply now

Even in phase 1, write application services so they can be exposed as tools later:

- Application services take a single Zod-validated input object and return plain data. No
  Express/Nest types leak into them. This makes them callable from controllers, jobs, and tools.
- Each module exposes tools in `tools/` by wrapping application services; tool input schemas are
  the same Zod schemas from `contracts`. One schema, three consumers (HTTP, agent, frontend).
- The agent acts **as the logged-in user**, inside the same CLS tenant context, subject to the
  same `authorization` checks. There is no agent service account.
- Read tools execute immediately. Write tools return a *proposal* that the user confirms in the UI
  before the service is called. The confirmation step is not optional.
- The LLM provider is abstracted by the Vercel AI SDK; model choice is configuration. Prompts and
  tool definitions must not contain OpenAI-specific features.
- No RAG, no vector store, no direct SQL. If the agent "needs" data, that is a signal to add a
  read tool to the owning module.
- Voice = STT adapter in front of the same text agent, TTS behind it. Never a separate agent.

## 12. API conventions

- REST, JSON, versioned under `/api/v1`. Resource nouns, plural. Tenant is implicit from session,
  never in the URL.
- Every request/response body has a Zod schema in `contracts`; controllers use `nestjs-zod` DTOs.
  OpenAPI is generated from those schemas.
- Errors: RFC 7807 problem details with a stable `code`. Domain errors extend `DomainError` and are
  mapped to HTTP in one global filter. Never `throw new HttpException` from a service.
- Pagination: cursor-based for lists that grow (appointments, audit); offset only for small
  reference lists.
- Idempotency: mutations that clients may retry (booking, payment) accept an `Idempotency-Key`.

## 13. Frontend conventions

- Feature folders mirror backend modules: `apps/web/src/features/<module>/`.
- Server state only via TanStack Query; no data in global stores. UI state local or in URL.
- Types and validation come from `packages/contracts` — never hand-write API types.
- Permissions from the session drive UI visibility (`usePermission('patient:write')`); the API
  remains the enforcement point.
- All dates handled with the tenant timezone from session; display via one shared formatter.
- Calendar views use a scheduler component with resource support; do not build the grid by hand.
- RTL and Arabic/French/English i18n readiness from day 1: no hard-coded strings, logical CSS
  properties (`margin-inline-start`), i18n keys per feature.

## 14. Code quality and testing

- TypeScript `strict`, `noUncheckedIndexedAccess`, no `any` (use `unknown` + Zod).
- Lint + typecheck + tests must pass before a PR is opened. CI enforces module boundaries.
- Test pyramid per module: unit tests for `domain/` (fast, no I/O), integration tests for
  application services against a real Postgres via Testcontainers (RLS on), a handful of e2e
  flows with Playwright for phase-1 critical paths (book, check in, invoice).
- Every bug fix ships with a failing test first.
- Tenant isolation has its own test suite: for every module, prove that tenant A cannot read or
  affect tenant B's rows through any public service.
- Naming: files `kebab-case.ts`, classes `PascalCase`, DB columns `snake_case`, permissions
  `resource:action`.
- No dead code, no commented-out code, no TODOs without an issue link.

## 15. Observability and ops

- pino JSON logs; every line carries `requestId`, `tenantId`, `userId` (from CLS). Never log PII
  (names, phone numbers, clinical notes) — log ids.
- OpenTelemetry traces for HTTP, DB, BullMQ, and LLM calls; the exporter is configuration.
- Health endpoints: `/health/live`, `/health/ready` (DB + Redis).
- Config via environment variables validated by a Zod schema at boot; the app refuses to start on
  invalid config. No secrets in the repo.
- Docker Compose for local dev (Postgres, Redis, MinIO). One command to boot everything.

## 16. How to work in this repo (for the AI agent and humans)

1. Before writing code, identify which module owns the change. If none does, propose a new module
   and its `docs/modules/<name>.md` page first.
2. Read the module's doc page and its `index.ts` before touching it.
3. Keep changes inside one module per PR where possible. Cross-module changes need an ADR if they
   change a boundary or introduce a new dependency edge.
4. Never add a dependency from a lower module to a higher one to "make it work." Use an event.
5. Never weaken RLS, skip an authorization check, or bypass the confirmation step for agent writes
   to unblock a feature.
6. When a request is ambiguous about tenant scope, permissions, or lifecycle, ask before coding.
7. Record non-obvious decisions as ADRs. Keep this file updated when a rule changes; a rule that
   is not written here does not exist.

## 17. Decisions already made (do not reopen without an ADR)

- Modular monolith, not microservices.
- Drizzle over Prisma (RLS/transaction control).
- Pooled database with RLS over database-per-tenant.
- better-auth over Keycloak/Auth0 for now; org = clinic, team = branch.
- React + Vite SPA over Next.js.
- Vercel AI SDK as the LLM abstraction; OpenAI first, provider swappable.
- Agent = toolbox over application services; no RAG, no DB access, confirm-before-write.
- Four separate modules for auth / users / roles / authorization; RBAC from day 1.
- S3-compatible storage for all files.
- Audit log as a first-class module from phase 1.
