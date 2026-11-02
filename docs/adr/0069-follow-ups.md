# ADR-0069: Follow-ups: due date, window, derived expiry, reopening

- Status: Accepted
- Date: 2026-10-30

## Context

"No patient leaves the clinic without the next step being either booked or on someone's list." A
follow-up is the dentist's recommendation, one per visit.

## Decision

1. Statuses are `awaiting`, `booked`, `declined`, `done`. _Patient will call_ is a tag.
2. `due_on` is the visit date plus the timing. `window_from` starts as the due date, or the visit date
   without one. `expired` is derived at read: awaiting, and past `window_from` plus the tenant's window,
   so a Settings change applies at once.
3. Only cancel and no-show reopen a follow-up. A reschedule moves the link and keeps it booked: "the
   link moves" and "rescheduling-away reopens it" cannot both hold, and the patient still has a time.
4. Reopening moves `window_from` to the reopen date when that is later. Otherwise a follow-up cancelled
   after its window would leave the list unseen, breaking the rule above.
5. Follow-ups belong to the source visit's branch. A voided visit leaves its follow-up alone.
6. Archiving a patient declines their awaiting follow-ups. A merge moves them to the kept patient.

## Consequences

- A follow-up can stay on the list longer than the prompt's formula alone, after a late cancellation.
