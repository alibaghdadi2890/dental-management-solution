# ADR-0010: The resolved permission set is carried in the request context

- Status: Accepted
- Date: 2026-09-26

## Context

CLAUDE.md §6 requires every mutating application service to re-check permissions, and offers an
injectable `AuthorizationService` for it. `tenancy`, `users` and `roles` sit below
`authorization` (which depends on `roles`), so importing it from them would create cycles. The
same holds for the `@RequirePermission()` decorator every controller uses.

## Decision

- `authorization` resolves the caller's permission set once per request (permission guard; later
  job and agent-tool entry points) and stores it in CLS next to the tenant.
- `RequestContext.hasPermission(p)` in `platform/cls` is the single evaluation every layer uses:
  system tasks pass; a platform admin holds every permission inside a tenant and only
  `platform:admin` outside one (ADR-0008); everyone else is decided by the resolved set; deny by
  default. `requirePermission(p)` throws `PermissionDeniedError` (`403 forbidden`).
- Route access is plain metadata in `platform/http/route-access.ts`: `@Public()`,
  `@Authenticated()` and `@RequirePermission(p)`. The global permission guard enforces it and
  denies routes that declare nothing; a unit test checks every controller route declares one.
- `AuthorizationService.can()` wraps `hasPermission` and is where resource-level rules will live.

## Consequences

- Any module can re-check without a dependency on `authorization`; the permission catalog stays in
  `@dcm/contracts`, which `platform` may import.
- Code that runs outside a request must establish CLS (as jobs already must) before calling
  services; without resolved permissions, everything is denied.
