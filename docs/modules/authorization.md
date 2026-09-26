# `authorization` module

**Status:** skeleton — module class and `index.ts` only.

## Purpose

May you do this. One evaluation function `can(actor, permission, resource?)`, exposed as a `@RequirePermission()` decorator + global guard (deny by default; health and auth routes are the only exceptions), an injectable `AuthorizationService` for application services, and the guard for agent tools (phase 2). Resource-level rules live here.

## Owns

No tables.

## Public API (`index.ts`)

`AuthorizationModule`. Planned: `AuthorizationService`, `RequirePermission`, `Public`.

## Events

- Emits: —
- Consumes: —

## Depends on

roles

## Permissions

Evaluates all of them.
