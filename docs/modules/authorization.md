# `authorization` module

**Status:** implemented — guards, platform-admin rules, role-based permission resolution.

## Purpose

May you do this. Registers both global guards in a fixed order (session guard from `auth`, then
the permission guard), resolves the caller's permission set into CLS once per request (ADR-0010)
and evaluates it. Deny by default: a route that declares no access is refused.

Evaluation (`RequestContext.hasPermission`): system tasks pass; a platform admin holds every
permission inside a tenant but `compensation:*` (ADR-0055), and only `platform:admin` outside one
(ADR-0008); clinic users get their active roles' permissions and their per-user grants
(`RolesService.permissionsForUser`; everything for an owner), resolved once per request, so a
change applies from the caller's next request.

**Visit scope**, the first resource-level rule (ADR-0055): `visit:read` is the caller's own visits
(their staff profile is the dentist, or they started it), `visit:read_all` every visit. The rule
is the pure `canReadVisit` / `visitScopeOf` of `@dcm/contracts`, which the SPA applies too.
`resolveForRequest` also puts the caller's staff profile id in the context, and modules apply the
rule through `RequestContext.visitScope()` without depending on this module;
`AuthorizationService.can(permission, visit?)` delegates to it.

## Owns

No tables.

## Public API (`index.ts`)

`AuthorizationModule`, `AuthorizationService`. Routes declare access with `@Public()`,
`@Authenticated()` or `@RequirePermission()` from `platform/http/route-access.ts`.

## Events

- Emits: —
- Consumes: —

## Depends on

auth, roles, users (the caller's staff profile id)

## Permissions

Evaluates all of them.
