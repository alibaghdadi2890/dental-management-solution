# `audit` module

**Status:** skeleton — module class and `index.ts` only.

## Purpose

Append-only audit log: who/what/when/tenant/before/after for every mutation, fed by a single generic subscriber to all domain events plus explicit entries from application services. Agent tool calls are recorded with `actor_kind = 'agent'`.

## Owns

`audit_log` (planned; `dcm_app` gets INSERT/SELECT only).

## Public API (`index.ts`)

`AuditModule`. Planned: `AuditService` (record, query with cursor pagination).

## Events

- Emits: —
- Consumes: All domain events.

## Depends on

— (consumes events from all)

## Permissions

`audit:read`.
