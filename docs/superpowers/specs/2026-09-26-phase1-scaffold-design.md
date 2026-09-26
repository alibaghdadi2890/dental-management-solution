# Phase 1 scaffold — design

Date: 2026-09-26 · Status: approved

## Scope

Phase 1 product features (built in later PRs, on top of this scaffold):

1. Tenant creation and management — **platform admin only**, no public sign-up.
2. Create patients.
3. Import existing patients with service history — our CSV/XLSX template with column mapping.
4. Create and manage visits.

This PR is a **bare scaffold**: workspace, tooling, Docker, empty module skeletons with docs pages,
and real, tested `platform/` helpers. No feature code, no better-auth wiring, no feature screens.

## Decisions taken during design

| Decision | Recorded in |
|---|---|
| `treatments` renamed to `clinical`; `clinical` owns visits, treatment plans, charting | CLAUDE.md §4, ADR-0001 |
| Procedure/service catalog moves from `scheduling` to `clinical` | CLAUDE.md §4/§8, ADR-0002 |
| New `imports` module orchestrates imports through `patients` and `clinical` services | CLAUDE.md §4, ADR-0003 |
| Tenants are provisioned only by platform admins via `withoutTenant()` | CLAUDE.md §5, ADR-0004 |
| NestJS 11.2 (not 12: `nestjs-zod` supports ≤ 11); TypeScript 6.0 (not 7: `typescript-eslint` supports < 6.1) | ADR-0005 |

The design POC (`Dental Clinic POC/`) is the visual source of truth. The web shell follows its
app shell (212px sidebar, 56px header, tokens, IBM Plex). Tooth numbering is Universal (POC), not FDI.

## Workspace

- pnpm workspaces + Turborepo. Packages: `apps/api` (`@dcm/api`), `apps/web` (`@dcm/web`),
  `packages/contracts` (`@dcm/contracts`), `packages/config` (`@dcm/config`).
- `@dcm/contracts` is ESM, built with `tsc` to `dist/`. It exposes a `@dcm/source` export
  condition pointing at `src/` so Vite and Vitest consume source directly without a build.
- `packages/config`: shared `tsconfig` bases, ESLint flat configs (base, api, web), Prettier.
- ESLint enforces CLAUDE.md §4 with `eslint-plugin-boundaries`:
  - modules import other modules only via `index.ts`;
  - `domain/` imports only its own module's `domain/` and `platform/kernel` — plus a
    `no-restricted-imports` ban on `@nestjs/*`, `drizzle-orm`, `pg`, `bullmq`, `ioredis`;
  - `platform/` never imports `modules/`;
  - `import-x/no-cycle` for acyclic dependencies.
- Docker Compose: Postgres 17, Redis 7, MinIO (+ bucket init). Postgres init creates roles:
  `dcm_owner` (migrations, table owner), `dcm_app` (runtime, subject to RLS),
  `dcm_admin` (BYPASSRLS, used only by `withoutTenant()`).
- `pnpm dev` boots Compose, runs migrations, starts api + web.
- GitHub Actions: install → lint → typecheck → test → build.

## Backend `apps/api`

CommonJS output, `module: nodenext`, SWC for dev/build (decorator metadata), `tsc --noEmit` for
typecheck. Global prefix `/api/v1` (health excluded).

Module skeletons (folder layout from CLAUDE.md §4, `<name>.module.ts`, `index.ts`,
`docs/modules/<name>.md`): `tenancy`, `auth`, `users`, `roles`, `authorization`, `audit`,
`patients`, `clinical`, `imports`.

`platform/`:

| Area | Contents |
|---|---|
| `kernel` | Pure TS usable from `domain/`: `DomainError` (+ `kind`), `newId()` (uuid v7) |
| `config` | Zod env schema; `loadConfig()` throws on invalid env; global `APP_CONFIG` provider |
| `cls` | `nestjs-cls` setup; typed store `{ requestId, tenantId?, userId?, branchId?, actorKind, platformAdmin }`; `RequestContext` accessor with `requireTenantId()` |
| `db` | `pg` pools; `TenantDb.run(fn)` opens (or joins) a transaction, runs `set_config('app.tenant_id', …, true)` from CLS, throws `MissingTenantContextError` without a tenant, supports after-commit hooks; `withoutTenant(reason, fn)` uses the `dcm_admin` pool and requires `platformAdmin` or `actorKind = 'system'`; `tenantColumns()` + `tenantIsolationPolicy()` table helpers; root `schema.ts` aggregating module schemas; drizzle-kit config; migration runner |
| `events` | `DomainEvent<N, P>` envelope (`name, id, occurredAt, tenantId, actor, requestId, payload`); `EventBus.publish()` defers to after-commit when inside a tenant transaction; `@OnDomainEvent()` |
| `queue` | BullMQ root config; `TenantJobs.enqueue(queue, name, payload, { jobId })` stamps `tenantId` from CLS (required `jobId`, retries with exponential backoff); `TenantWorker` base re-establishes CLS and fails loudly without `tenantId`; exhausted jobs are copied to `dead-letter` |
| `errors` | Global filter → RFC 7807 `application/problem+json` with stable `code` and `requestId`; maps `DomainError`, `ZodValidationException` (`validation_failed`), Nest `HttpException`, unknown (`internal_error`) |
| `logging` | `nestjs-pino`; every line carries `requestId`, `tenantId`, `userId` from CLS; PII paths redacted; `x-request-id` accepted (validated) or generated, echoed on the response |
| `otel` | `register.ts` preloaded with `node -r`; NodeSDK + auto-instrumentations (http, express, pg, ioredis, nestjs); exporter from standard `OTEL_*` env; disabled via `OTEL_SDK_DISABLED` |
| `storage` | S3 client; `presignUpload` / `presignDownload`; keys namespaced `tenants/<tenantId>/…` from CLS |
| `health` | `GET /health/live`, `GET /health/ready` (DB `select 1`, Redis `PING`) |

RLS policy form (stricter than CLAUDE.md's shorthand, same meaning): `tenant_id =
NULLIF(current_setting('app.tenant_id', true), '')::uuid` for `USING` and `WITH CHECK`, so a
missing tenant yields no rows instead of a cast error.

## `packages/contracts`

- `permissions.ts`: typed catalog — `platform:admin`, `tenant:read`, `tenant:write`, `user:read`,
  `user:write`, `role:read`, `role:write`, `patient:read`, `patient:write`, `visit:read`,
  `visit:write`, `procedure:read`, `procedure:write`, `import:run`, `audit:read`; `Permission`
  type and `isPermission()` guard.
- `common.ts`: `idSchema`, `isoDateTimeSchema`, `moneySchema` (decimal string + ISO 4217),
  cursor pagination (`cursorPageQuerySchema`, `cursorPageSchema(item)`), `problemDetailsSchema`.
- `session.ts`: `sessionSchema` (user, tenant with IANA timezone, permissions) — the shape the
  auth PR will serve.

## Frontend `apps/web`

- Vite 8, React 19, TanStack Router (file-based, `@tanstack/router-plugin`), TanStack Query,
  Tailwind 4 with POC tokens as CSS variables, shadcn/ui (`components.json`, `cn`, Button).
- i18next + react-i18next, `en`/`ar`/`fr`, per-feature namespaces; `<html dir>` follows the
  language. Lint: `i18next/no-literal-string` in JSX; a rule banning physical-direction Tailwind
  classes (`ml-`, `pr-`, `left-`, `text-left`, …).
- `lib/api.ts`: `apiFetch()` with credentials, parses problem+json into `ApiError`.
- `features/auth/session.ts`: `sessionQueryOptions`, `useSession()`, `usePermission()`.
- `lib/format.ts`: `formatDate()` ("4 Sep 2026"), `formatDateTime()` in the tenant timezone,
  `formatMoney()` ("$1,234" / "−$30").
- Shell per POC: sidebar (clinic block, main nav: Patients, Visits; ADMIN: Catalog, Settings;
  user footer), header (breadcrumb). Routes `/patients`, `/visits`, `/catalog`, `/settings`
  render page headers only. Schedule and Payments are not in phase 1 and are not shown.
- `features/<module>/` folders are created when the first screen lands (no empty folders).

## Testing

- Vitest 5 in api (projects: `unit` = `src/**/*.spec.ts`, `integration` =
  `test/integration/**/*.int-spec.ts`) and web (jsdom).
- `test/support/postgres.ts`: Testcontainers Postgres with the same role setup as Compose.
- Integration test: tenant A cannot read or write tenant B's rows through `TenantDb`; no tenant →
  `MissingTenantContextError`; `withoutTenant` refused for normal users.
- Unit tests: config, problem-details filter, RLS policy SQL, `TenantJobs`, `TenantWorker`,
  request-id handling, web `apiFetch`, `format`, `usePermission`.
- Playwright: config + one smoke test (shell renders, `dir="rtl"` for Arabic).

## Verification

`pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (incl. Testcontainers), `pnpm build`,
and `pnpm dev` with `/health/ready` returning 200.

## Out of scope

better-auth wiring, tenant provisioning, users/roles/authorization logic, audit subscriber,
all feature services, screens for patients/visits/catalog/import, OpenAPI generation (added with
the first controller that has a body).
