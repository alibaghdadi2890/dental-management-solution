# Dental Clinic Management

Multi-tenant SaaS for dental clinics: a NestJS modular monolith (`apps/api`), a React SPA
(`apps/web`) and shared Zod contracts (`packages/contracts`).

**Read [CLAUDE.md](CLAUDE.md) before changing anything** — it is the source of truth for
architecture and coding rules. Decisions live in [docs/adr](docs/adr), module pages in
[docs/modules](docs/modules), and the phase 1 screens follow the design POC in
[`Dental Clinic POC/`](Dental%20Clinic%20POC/README.md).

## Prerequisites

- Node.js 24 (see `.nvmrc`)
- pnpm 10 (`corepack enable` or `npm install -g pnpm@10`)
- Docker (Compose v2)

## Quick start

```sh
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm dev
```

`pnpm dev` starts Postgres, Redis and S3-compatible storage in Docker, applies migrations, then
runs the API on <http://localhost:3000> and the SPA on <http://localhost:5173> (which proxies
`/api`). Check the API with `curl localhost:3000/health/ready`.

There is no sign-up. Create the first platform admin once, then sign in at
<http://localhost:5173/login> and provision clinics from **Platform › Tenants**:

```sh
pnpm --filter @dcm/api admin:bootstrap --email you@example.com --password 'at-least-10-chars'
```

The command is idempotent: an existing account is promoted, never re-passworded.

Infrastructure listens on non-default host ports so it does not clash with locally installed
services: Postgres `55432`, Redis `56379`, S3 (SeaweedFS) `58333`. Override with
`DCM_POSTGRES_PORT`, `DCM_REDIS_PORT` and `DCM_S3_PORT`, and update `apps/api/.env` to match.

## Everyday commands

| Command                              | What it does                                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                          | ESLint, including module-boundary and RTL/i18n rules                                                      |
| `pnpm typecheck`                     | TypeScript across the workspace                                                                           |
| `pnpm test`                          | Unit tests plus the Testcontainers integration suite (needs Docker)                                       |
| `pnpm build`                         | Production builds                                                                                         |
| `pnpm --filter @dcm/web e2e`         | Playwright: shell smoke tests, the identity, catalog, patients and visit flows (needs `pnpm dev`'s stack) |
| `pnpm --filter @dcm/api db:generate` | Generate a migration (builds `@dcm/contracts` first)                                                      |
| `pnpm --filter @dcm/api db:migrate`  | Apply migrations (as the schema owner)                                                                    |

## Layout

```
apps/api/src/platform   infrastructure: config, cls, db (RLS), events, queue, storage, logging, otel, health
apps/api/src/modules    one folder per bounded context; import other modules only via index.ts
apps/web/src            shell, routes, features/<module>, lib (api client, formatters, i18n)
packages/contracts      Zod schemas, permission catalog, session contract
packages/config         shared tsconfig, ESLint and Prettier config
```
