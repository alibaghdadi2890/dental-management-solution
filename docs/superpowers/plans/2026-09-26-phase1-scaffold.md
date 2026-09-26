# Phase 1 Scaffold Implementation Plan

> **For agentic workers:** executed inline in the authoring session (user approved "proceed").
> Steps use checkbox (`- [ ]`) syntax for tracking. Code lives in the commits, not in this file.

**Goal:** Bare, verified scaffold for the dental clinic platform per
`docs/superpowers/specs/2026-09-26-phase1-scaffold-design.md`.

**Architecture:** pnpm/Turborepo monorepo; NestJS modular monolith with real `platform/` helpers
and empty module skeletons; React SPA shell matching the POC; shared Zod contracts.

**Tech Stack:** NestJS 11.2, TypeScript 6.0, Drizzle 0.45, Postgres 17 (RLS), Redis/BullMQ,
nestjs-cls, nestjs-zod, pino, OpenTelemetry, Vite 8, React 19, TanStack Router/Query,
Tailwind 4, shadcn/ui, i18next, Vitest 5, Testcontainers, Playwright.

---

### Task 1: Workspace root and shared config

**Files:** `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.gitignore`, `.npmrc`,
`.editorconfig`, `.nvmrc`, `.env.example`, `packages/config/**` (tsconfig bases, eslint configs,
prettier).

- [ ] Write files; `corepack enable`; `pnpm install` succeeds.
- [ ] Commit `chore: workspace root and shared config`.

### Task 2: `@dcm/contracts`

**Files:** `packages/contracts/{package.json,tsconfig*.json,vitest.config.ts}`,
`src/{index,permissions,common,session}.ts`, `src/*.spec.ts`.

- [ ] Tests first: `isPermission`, `cursorPageSchema`, `moneySchema` (rejects floats with >2 dp,
      requires ISO currency), `problemDetailsSchema`. Run → fail.
- [ ] Implement. `pnpm --filter @dcm/contracts test` → pass; `build` emits `dist/`.
- [ ] Commit `feat(contracts): permission catalog and common schemas`.

### Task 3: API project + `platform/kernel`, `platform/config`

**Files:** `apps/api/{package.json,tsconfig*.json,nest-cli.json,.swcrc,vitest.config.ts,
eslint.config.mjs}`, `src/platform/kernel/*`, `src/platform/config/*`.

- [ ] Tests first: `loadConfig` rejects missing `DATABASE_URL`, coerces `PORT`, defaults
      `LOG_LEVEL`; `DomainError` carries `code`/`kind`; `newId()` is a v7 uuid.
- [ ] Implement; tests pass; typecheck passes.
- [ ] Commit.

### Task 4: `platform/cls`, `platform/logging`, `platform/errors`

- [ ] Tests first: request-id sanitizer (accepts safe ids, replaces bad ones); problem-details
      mapping for `DomainError` kinds, `ZodValidationException`, `NotFoundException`, unknown error.
- [ ] Implement `AppClsStore`, `RequestContext`, pino config (CLS mixin + redact),
      `ProblemDetailsFilter`. Tests pass.
- [ ] Commit.

### Task 5: `platform/db`

**Files:** `src/platform/db/*`, `drizzle.config.ts`, `migrations/0000_runtime_grants.sql`,
`test/support/postgres.ts`, `test/integration/tenant-db.int-spec.ts`, `docker/postgres/init/*`.

- [ ] Unit test: `tenantIsolationPolicy()` SQL text uses `NULLIF(current_setting(...))`.
- [ ] Integration test (Testcontainers): tenant A/B isolation for select/insert/update; missing
      tenant → `MissingTenantContextError`; nested `run` joins the outer tx; after-commit hooks run
      only on commit; `withoutTenant` refused for a normal user and allowed for `system`.
- [ ] Implement pools, `TenantDb`, `withoutTenant`, table helpers, migration runner. Pass.
- [ ] Commit.

### Task 6: `platform/events`, `platform/queue`

- [ ] Tests first: `EventBus.publish` inside `TenantDb.run` emits only after commit, outside emits
      immediately; `TenantJobs.enqueue` throws without tenant, stamps `tenantId`, passes `jobId`;
      `TenantWorker` rejects payload without `tenantId`, runs handler inside CLS with that tenant.
- [ ] Implement; pass. Commit.

### Task 7: `platform/storage`, `platform/health`, `platform/otel`, `main.ts`, `app.module.ts`

- [ ] Tests first: storage key namespacing uses CLS tenant and rejects `..`; health ready reports
      503 when a check fails.
- [ ] Implement; `pnpm --filter @dcm/api build` succeeds. Commit.

### Task 8: Module skeletons + docs

**Files:** `src/modules/<name>/{<name>.module.ts,index.ts}` for tenancy, auth, users, roles,
authorization, audit, patients, clinical, imports; `docs/modules/<name>.md`; ADR-0001..0005;
CLAUDE.md updates.

- [ ] Wire modules into `AppModule`.
- [ ] Lint proves boundaries: temporarily add a deep import + a Nest import in `domain/`, confirm
      `pnpm lint` fails, remove.
- [ ] Commit.

### Task 9: Web app

**Files:** `apps/web/**`.

- [ ] Tests first: `apiFetch` parses problem+json into `ApiError`; `formatDate`/`formatMoney`
      match POC formats; `usePermission` denies by default.
- [ ] Implement Vite/Tailwind/router/query/i18n/shell. `pnpm --filter @dcm/web build` passes.
- [ ] Playwright smoke test passes. Commit.

### Task 10: Docker Compose, dev script, CI, README

- [ ] `docker compose up -d`, `pnpm db:migrate`, `pnpm dev`; `curl /health/ready` → 200.
- [ ] `.github/workflows/ci.yml`. Root `README.md` quick start.
- [ ] Full `pnpm lint typecheck test build`. Commit.
