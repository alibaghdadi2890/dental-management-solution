# ADR-0081: The `labs` module, and how lab data reaches other screens

- Status: Accepted
- Date: 2026-11-11

## Context

Feature 18 adds dental laboratories, the lab work ordered for patients, and what the clinic owes
each lab. The prompt asks for a new module that no existing module imports, except `expenses`,
which mirrors lab payments as it mirrors salaries and payouts. Yet lab data must appear on
screens other modules own: the patients list (a label and a filter), the booking panel (a
warning), the calendar, Today, the patient record and the visit.

## Decision

1. A new module, `labs`, owns `labs`, `lab_services`, `lab_order_counters`, `lab_orders`,
   `lab_order_items`, `lab_order_trips`, `lab_order_files`, `lab_payments` and `lab_adjustments`.
   It depends on `patients`, `users`, `tenancy`, `clinical` (a visit's patient and number, plan
   items), `scheduling` (appointments, opening hours, the appointment events), `files`
   (attachments) and `audit`.
2. Only `expenses` imports `labs`, for `LabPaymentRecorded` and `LabPaymentVoided` (ADR-0085).
3. Lab data reaches other modules' screens without a new edge:
   - **The patients list filter** _Has open lab order_ is served by `GET /labs/patients`, which
     runs `PatientsService.search` restricted to the patients with an open order, the way
     `GET /billing/patients` serves the owing view (4b). `GET /patients` answers `lab=open` with
     422 `validation_failed`.
   - **The booking warning** is the SPA's: the booking, move and edit screens compare the chosen
     day with the patient's open orders (`GET /lab-orders/open`). It is advisory, needs no
     override, and so needs no server-side enforcement in `scheduling`.
   - **Labels, Today's lane, the record and the visit** read `labs` routes from the SPA.
4. Reads `labs` needs from other modules are ungated building blocks read under its own checks:
   `AppointmentsService.refs`, `upcomingFor` and `openWeekdays`; `FilesService.refs`;
   `VisitFactsService.planOwners`.
5. Order numbers come from a per-tenant counter, shown `L-000123` like visit numbers.

## Consequences

- A later assistant tool that books an appointment will not see the lab warning unless it reads
  `labs` itself; the warning never blocks, so nothing is lost.
- `scheduling` gained exports (its booked, rescheduled, no-show and completed events) but no
  dependency.
