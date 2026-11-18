# ADR-0084: An order's appointment link follows scheduling's events

- Status: Accepted
- Date: 2026-11-11

## Context

An order is needed for one appointment of the patient. The front desk books, moves, cancels and
completes appointments without thinking about lab work, and the order must keep pointing at the
right appointment, or at none, by itself.

## Decision

1. An order links to at most one appointment (`lab_orders.appointment_id`, no foreign key).
2. `labs` reacts **in the transaction** to `scheduling`'s events:
   - `AppointmentBooked`: every open order of the patient without a link links to it.
   - `AppointmentRescheduled` (a reschedule, or an edit that moves the appointment): the link
     moves to the new appointment.
   - `AppointmentCancelled`, `AppointmentMarkedNoShow` and `AppointmentCompleted`: the link is
     removed; the order waits for the next booking. Completed is added so that work still
     _Arrived_ after the visit (_Not used today_) shows on Today as _Book appointment_.
   - `AppointmentRestored`: nothing.
3. Each change is audited (`lab_order.link`, `relink`, `unlink`) with `by: 'system'` and the cause;
   a person's change says `by: 'user'`.
4. A person may set, change or remove the link at any time. The appointment must be the patient's,
   active and today or later. At creation the form proposes the next appointment with the same
   dentist, else the patient's next one (`GET /lab-orders/proposal`).

## Consequences

- A booking may link several of the patient's open orders at once; the user can move any of them.
- A failure in the reaction rolls back the booking: the handlers only update `labs`' own rows.
