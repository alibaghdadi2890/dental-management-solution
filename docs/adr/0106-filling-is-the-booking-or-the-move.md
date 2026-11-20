# ADR-0106: Filling an opening is the existing booking or move, without overrides

- Status: Accepted
- Date: 2026-11-19

## Context

_Book_ on a row of _Fill_ must do exactly what booking and moving already do: lineage, follow-up,
planned items, the lab order's link, conflicts, the column rule, events and audit. It must never go
through a warning, even for a user who may override. Two people filling the same opening must not
both succeed, and a retried request must not book twice.

## Decision

1. `POST /scheduling/waitlist/:id/fill` takes `openingId`, `startsAt`, an optional `roomId` and
   `confirmed`, and requires an `Idempotency-Key`. Everything happens in one transaction
   (`AppointmentsService.runFill`):
   - A replay of the key returns the first result. The key and the hash of the fill request are
     stored on the appointment row the fill creates, as a booking's are (ADR-0037).
   - The locks follow one order, the order of every write that places time: the patient
     (`FOR SHARE`), the appointment being moved, the patient's waitlist lock, then the dentist's
     advisory lock (`AppointmentsService.lockSchedule`).
   - The entry is locked. It must be waiting and not expired.
   - The opening is worked out again. The start must still be one the entry may take, otherwise
     `409 waitlist.opening_taken`.
   - With an appointment, the fill is the move (`moveForWaitlist` → `moveRow`). It goes to the
     opening's dentist and is confirmed when ticked. A room picked by hand that is taken at the
     new time is replaced by _Auto_'s choice, and the confirmation says so.
   - Without one, the fill is the booking (`bookForWaitlist` → `bookRow`). It takes the entry's
     reason, type, duration and planned items, room _Auto_, and the entry's follow-up when that
     is still awaiting.
   - Both run with `override: false`, whatever the caller holds. The entry becomes `booked`, and
     the new row's `waitlist_entry_id` remembers where it came from.
2. The SPA reads a refusal (`waitlist.opening_taken`, or the booking's own dentist conflict) as the
   slot finder's "just taken", and refreshes the list.
3. A fill that moves an appointment frees its old time. The confirmation's toast says who fits it,
   with _Fill_. Cancels and other moves do the same (`useFreedTimeToast`).

## Consequences

- Booking, moving, editing, resizing and restoring take the same dentist lock. Two writes for
  one dentist therefore run one at a time, and neither misses the other's uncommitted row. A
  dentist overlap is still not a database constraint (ADR-0067): an override goes through it on
  purpose, and a fill never does.
- The single lock order (appointment, then waitlist, then dentist) keeps a fill and a cancel or move
  of the same appointment from deadlocking.
- `book` and the move were split into an outer request and an inner, in-transaction step, so the
  fill reuses them without a second code path.
