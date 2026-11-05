# ADR-0075: Editing an appointment, and restoring a cancelled one

- Status: Accepted
- Date: 2026-11-05
- Amends: ADR-0066 (the lifecycle: `cancelled` was terminal)

## Context

The front desk asked for three things on the calendar: undo a cancel, book easily into the slot a
cancelled appointment leaves, and edit an appointment in the booking form. Until now a cancel was
final, a cancelled card took a lane of its column, and the only edits were the drag, the resize, the
room and Confirm; the reason and the visit type could not change at all.

## Decision

1. **Restore.** `cancelled → booked`, or `→ confirmed` when it had been confirmed (a cancel keeps
   `confirmed_at`). The same row: the cancel reason and who closed it are cleared, and the audit log
   keeps the history (`appointment.restore`, `AppointmentRestored`). Open while the start is ahead
   (`canRestore` in `@dcm/contracts`), for `appointment:write` and the column, as Cancel.
2. It is placed as a move to the same time: an _Auto_ room is chosen again, a room picked by hand
   that is now taken refuses (the user's choice), the patient booked elsewhere refuses, and the
   dentist and hours warnings need the override. A linked follow-up still awaiting is booked again;
   one booked by another appointment, declined or done is no longer this appointment's.
3. **Edit.** `PATCH /scheduling/appointments/:id` takes the whole booking form (dentist, start,
   duration, reason, type, room, _Confirmed with patient_), with an `Idempotency-Key`. The same start
   and dentist change the row in place (`appointment.edit`, `AppointmentEdited` with what changed);
   another start or dentist is a reschedule, a new row in the lineage with the form's values (CLAUDE.md
   §8: history is never rewritten). Open when a move is, under the same rules, with two exceptions
   for an edit that keeps its time: the warnings it was booked through need no override again (only
   a room clash is new), and its room choice may be `none`, kept for check-in. Only a move stores the
   key, because only a move creates a row; an edit in place repeated sets the same values again.
4. **The calendar.** A cancelled card is a strip at its column's end, outside the lanes, so the rest of
   its slot books on a click; overlapping cards narrow only where they meet a strip. The layout is a
   custom `dayLayoutAlgorithm` in `schedule-calendar.tsx`, from the pure `layOutDay`. Editable cards
   carry a small Edit button, shown on hover and focus (always without hover); it is the only way
   in, the popover has none.

## Consequences

- A moved appointment still starts unconfirmed (feature 14); in the panel the box unticks itself when
  the date, time or dentist changes, and a confirmed appointment cannot be unconfirmed there.
- A cancel by merge ("Duplicate after merge") can be restored only if the kept patient is free then.
