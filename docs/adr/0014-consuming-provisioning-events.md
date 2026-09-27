# ADR-0014: Modules may consume `provisioning`'s events

- Status: Accepted
- Date: 2026-09-27
- Amends: ADR-0009

## Context

Feature 2 seeds a default service and diagnosis catalog into every new clinic "on
`TenantProvisioned`" (C3). ADR-0009 and CLAUDE.md §4 say nothing may depend on `provisioning`.
To subscribe, `clinical` has to import the event name and type from `provisioning/index.ts`.

We considered two alternatives:

- Call `CatalogService.seedDefaultCatalog()` directly inside the provisioning transaction, as is
  done for system roles (A5). This would be atomic, but it adds a `provisioning → clinical` edge
  and a direct service call made for a side effect (§4 rule 3). The roles exception exists only
  because the owner's role assignment needs the roles to exist first. The catalog has no such
  need.
- Have `tenancy` emit a `TenantCreated` event. That event fires before the owner and roles exist.
  It would also add a `clinical → tenancy` edge for an event, not for a real need.

## Decision

"Nothing depends on `provisioning`" means **nothing calls its services**. Other modules may import
its **events** (name + type) from `provisioning/index.ts` and react to them. `provisioning` stays
at the top of the graph, and no module is below it through a service call.

A reaction runs after the provisioning commit, in a context rebuilt from the event:
`actorKind: 'system'`, the event's tenant and request id. It catches and logs its own failures, so
the event still reaches the audit subscriber. Catalog seeding does not go through BullMQ (§9):
it is fast and idempotent. A crash between the commit and the handler is recovered by the
platform admin's "Seed default catalog" button (`POST /catalog/seed-default`), which does the same
idempotent work.

## Consequences

- `clinical` consumes `TenantProvisioned` (`CatalogSeedingSubscriber`).
- CLAUDE.md §4 now says "Nothing calls `provisioning`; its events may be consumed".
- Reactions that must not be lost after a crash still use a BullMQ job per §9. This event-only
  rule does not relax that.
