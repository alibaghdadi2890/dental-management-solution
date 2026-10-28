# ADR-0063: A correction may move a visit to another day

- Status: Accepted
- Date: 2026-10-28
- Amends: ADR-0062 (decision 2: "The start stays on the visit's `local_date`")

## Context

ADR-0062 let a correction set a finished visit's start and end, but only on the visit's own day:
moving a visit touches its records, its money and its dentist's pay. The clinic needs the date
corrected too — a visit entered the day after it happened, or recorded against the wrong day.

## Decision

1. **The start's day is the visit's day.** A correction's `times` may start on any day that isn't
   in the future (the end is still after the start, within 24 hours, not in the future). The
   visit's `local_date` becomes the start's day in the clinic's time zone. `visit.times_off_day`
   is gone.
2. **The visit's records move with it.** Diagnoses, plans, services and files read the visit's
   date from the visit. `tooth_presences.occurred_on`, the one copy of it, is set to the new day
   for every row the visit recorded.
3. **The ledger keeps its dates.** Ledger entries are append-only (ADR-0024, ADR-0025): the visit's
   charge, and any adjustment, stay on the day they were posted. The patient's balance is a sum,
   so it doesn't change. A statement or report by date shows the charge where it was posted.
4. **Dentist pay vetoes a move across a closed month.** The correction publishes
   `VisitRedated { visitId, patientId, dentistId, from, to }` inside its transaction.
   `compensation` reacts there, under the dentist's lock. It refuses the move when either day is in
   a closed month of the dentist's pay (422 `compensation.period_closed`), which rolls the whole
   correction back. A closed month's snapshot counted the visit's per-visit and per-day pay where it
   was: moving it out would pay it twice, moving it in would change a closed month. Between open
   months the statements simply follow the visit. This is the ADR-0026 pattern: the module that
   would be wronged vetoes in the transaction.
5. **Status and audit as in ADR-0062.** A move with no change to the services or money keeps the
   status and writes no amendment; it is audited `visit.times`, with the dates before and after. A
   move with other changes is an amendment, whose snapshots carry the times. The SPA's correction
   form has a Date field above the start and end; the audit trail shows the days when they changed.

## Consequences

- After a move, the visit's date and its charge's date differ. Reports by visit date (the visits
  list, the patient's history, compensation's per-day pay) follow the visit; reports by money date
  (the ledger, payments, receivables) follow the charge.
- To move a visit in a closed month of its dentist's pay, the owner reopens that month first.
