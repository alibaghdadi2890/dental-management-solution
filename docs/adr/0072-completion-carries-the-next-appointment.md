# ADR-0072: Completion carries the next-appointment payload

- Status: Accepted
- Date: 2026-10-30
- Amends: ADR-0065 (#4, the flow after Complete)

## Context

The follow-up must be created atomically with the completion, and `clinical` imports nothing from
`scheduling`.

## Decision

1. `POST /visits/:id/complete` takes an optional `nextAppointment`. `clinical` republishes it on
   `VisitCompleted` without reading it, and `scheduling` creates the follow-up in the transaction. No
   payload is _Skip_.
2. _Book now_ books through `scheduling` before completion, with the live visit as `source_visit_id`.
   The completion carries `bookedAppointmentId` and the follow-up is created `booked`. If completion
   fails the appointment stays: it is a real booking. One cancelled since leaves the follow-up awaiting;
   an appointment of another visit vetoes the completion.
3. Complete visit is two steps, Next appointment then Payment. There is no Summary step, so ADR-0065's
   "the Complete step is the review" stands. The check before Complete still runs first. The All view's
   Visit Summary leads into the same two steps.
4. Checkout on the Today board is three steps: Summary, Next appointment, Payment.

## Consequences

- `clinical` gained `visits.appointment_id` and a few plain reads; it still knows nothing of follow-ups.
- `POST /visits/:id/complete` still accepts no body at all.
