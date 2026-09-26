# ADR-0005: Toolchain version pins

- Status: Accepted
- Date: 2026-09-26

## Context

At scaffold time the latest majors were NestJS 12, TypeScript 7 and pnpm 12. Key dependencies had
not caught up: `nestjs-zod` supports NestJS ≤ 11 and `typescript-eslint` supports TypeScript < 6.1.

## Decision

- NestJS 11.2 (CLAUDE.md requires 11+), TypeScript 6.0, pnpm 10.
- API compiles to CommonJS with SWC (decorator metadata); `tsc --noEmit` type-checks.
- Postgres 17 locally and in tests; BullMQ 5 with ioredis 5.
- ESLint 10 flat config; boundaries enforced with `eslint-plugin-boundaries` 7 and
  `eslint-plugin-import-x` (`no-cycle`).

## Consequences

Revisit when `nestjs-zod` supports NestJS 12 and `typescript-eslint` supports TypeScript 7.
