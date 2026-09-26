# `authorization` module

**Status:** implemented — guards, platform-admin rules, role-based permission resolution.

## Purpose

May you do this. Registers both global guards in a fixed order (session guard from `auth`, then
the permission guard), resolves the caller's permission set into CLS once per request (ADR-0010)
and evaluates it. Deny by default: a route that declares no access is refused. Resource-level
rules will live in `AuthorizationService.can()`.

Evaluation (`RequestContext.hasPermission`): system tasks pass; a platform admin holds every
permission inside a tenant and only `platform:admin` outside one (ADR-0008); clinic users get the
union of their roles' permissions (`RolesService.permissionsForUser`, resolved once per request,
so a role change applies from the caller's next request).

## Owns

No tables.

## Public API (`index.ts`)

`AuthorizationModule`, `AuthorizationService`. Routes declare access with `@Public()`,
`@Authenticated()` or `@RequirePermission()` from `platform/http/route-access.ts`.

## Events

- Emits: —
- Consumes: —

## Depends on

auth, roles

## Permissions

Evaluates all of them.
