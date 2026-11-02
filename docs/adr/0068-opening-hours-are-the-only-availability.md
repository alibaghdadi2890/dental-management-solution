# ADR-0068: Opening hours are the only availability; materialisation deferred

- Status: Accepted
- Date: 2026-10-30
- Amends: CLAUDE.md §8

## Context

CLAUDE.md §8 expected availability materialised from weekly templates. Feature 14 has one rule per
weekday and no dentist schedule, so there is nothing to expand.

## Decision

1. Each branch has seven rows: open or closed, one `from`–`to`. Default Monday to Saturday,
   08:00–18:00. A branch is seeded by the migration or on `BranchCreated`.
2. Slot search reads them directly: opening hours minus a list of busy-interval lists, on the user's
   slot-length grid, never in the past. Dentist availability is later one more list.
3. Materialisation is deferred to the enhancement that adds dentist schedules.
4. Changing hours never touches an appointment. The grid widens to hold one outside the hours.

## Consequences

- `tenancy` gained `BranchCreated`. Provisioning goes through `createBranch`, so it is covered too.
