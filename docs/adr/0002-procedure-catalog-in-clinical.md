# ADR-0002: Procedure catalog lives in `clinical`

- Status: Accepted
- Date: 2026-09-26

## Context

Visits record services performed, so the catalog is needed in phase 1, while `scheduling` (which
owned the catalog for durations) is not. The POC's Catalog screen is a clinical/pricing concern
(code, name, category, per-tooth vs per-jaw, price, active).

## Decision

`clinical` owns the per-tenant procedure/service catalog. Performed services store the catalog id
plus a snapshot of code, name and price. The dependency direction becomes
`scheduling → clinical` (durations are read from the catalog); `clinical` depends only on
`patients` and `users`. Scheduling reacts to `VisitCompleted` rather than clinical reacting to
appointment events, which would create a cycle.

## Consequences

- No mostly-empty `scheduling` module in phase 1.
- CLAUDE.md §4 module map and §8 updated accordingly.
