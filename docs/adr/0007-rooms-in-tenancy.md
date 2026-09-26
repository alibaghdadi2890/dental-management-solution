# ADR-0007: Rooms live in `tenancy`; a room is the bookable unit; no chairs

- Status: Accepted
- Date: 2026-09-26

## Context

The module map listed chairs as a `scheduling` resource, and the design POC shows "chair" columns
and filters. The clinics we serve think in rooms: a visit happens in a room, and a room is what
will be booked. Visits (phase 1) need to pick a room before `scheduling` exists.

## Decision

- `tenancy` owns `rooms` (belongs to a branch; name, optional code, active flag), next to
  `branches`. `TenancyService.listRooms(branchId?)` is exported for later features.
- The room is the physical unit a visit happens in and the unit `scheduling` will treat as a
  bookable resource. There is no chair concept anywhere; the POC's "chair" fields and columns map
  to room.
- Rooms are deactivated, never deleted, and never move between branches. Names and codes are
  unique per branch (case-insensitive). A composite foreign key `(tenant_id, branch_id)` keeps a
  room in its branch's tenant, because foreign-key checks bypass row-level security.

## Consequences

- CLAUDE.md §4 and §8 say "room" instead of "chair"; the appointment state `in_chair` becomes
  `in_room` (the POC's "In chair" label maps to it).
- `scheduling` will depend on `tenancy` for rooms (it already does for tenant settings).
