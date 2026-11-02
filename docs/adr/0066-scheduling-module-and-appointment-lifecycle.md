# ADR-0066: The `scheduling` module and the appointment lifecycle

- Status: Accepted
- Date: 2026-10-30

## Context

Feature 14 ships the calendar, booking and follow-ups. CLAUDE.md §4 and §8 reserved a `scheduling`
module with resources, availability templates and a waitlist; this run needs far less.

## Decision

1. `scheduling` owns `appointments`, `follow_ups`, `branch_opening_hours` and `scheduling_settings`.
   It depends on `tenancy`, `users`, `patients`, `clinical` and `audit`. Nothing imports it.
2. An appointment reserves a dentist (staff profile) and optionally a room of a branch for
   `[starts_at, ends_at)`. There is no resource table: a later dentist schedule or equipment adds one.
3. The lifecycle is a Postgres enum and a pure state machine: `booked → confirmed → checked_in →
in_room → completed`, with `cancelled`, `no_show` and `rescheduled` as terminal branches.
   `in_room` is also reachable from `booked` or `confirmed` (a visit started from it, an implicit
   check-in). `checked_in → confirmed` is Undo check-in, needed because `checked_in` cannot be
   cancelled. `in_room → checked_in` is a discarded visit.
4. `unresolved` is derived (`booked` or `confirmed`, and over). No job changes a status.
5. A move inserts a new row with the same `lineage_id` and marks the old one `rescheduled`; a resize
   changes the same row's end. A moved appointment starts `booked`: the patient has not agreed to
   the new time.
6. `scheduling` reacts in the transaction to `VisitStarted`, `VisitLinkedToAppointment`,
   `VisitDiscarded`, `VisitCompleted`, `PatientArchived`, `PatientsMerged`, `BranchCreated` and
   `StaffDeactivated`. Two of these are vetoes: a patient with upcoming appointments is not archived,
   and a dentist with open appointments is not deactivated.
7. A deactivated dentist has no calendar column. Because of the veto, none of their appointments is
   open; their closed ones leave the calendar and stay on the patient record.

## Consequences

- A start from an appointment is never gated by the column: a colleague may start the visit.
- Front desk checks in and a dentist or assistant starts the visit, as `visit:write` already says.
