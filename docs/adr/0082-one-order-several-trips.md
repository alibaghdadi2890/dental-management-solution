# ADR-0082: One order, several trips, and one step back

- Status: Accepted
- Date: 2026-11-11

## Context

A case may go to the lab more than once: a try-in then the next stage, an adjustment, a remake.
The owner wants it to stay one order with one number, judged trip by trip against the date the
lab promised. People make mistakes when they mark things, and nothing may close by itself.

## Decision

1. An order has a **status** (`to_send`, `at_lab`, `arrived`, `done`, `on_hold`, `remake`,
   `cancelled`) and an ordered list of **trips** (`lab_order_trips`).
2. _Mark sent_ (from `to_send` or `remake`) opens a trip with the sent date, how it left, a
   reference, and `promised_on = expected_on = sent + expected wait` in calendar days. _New
   expected date_ moves `expected_on` only; reports judge the lab on `promised_on`.
3. _Mark received_ (from `at_lab`, one date for up to 50 orders) closes the trip.
4. What happens to arrived work is the trip's **outcome**: `next_stage` or `adjustment` (back to
   `to_send`), or `remake` (status `remake`, with a reason and who bears it). _Fitted_ makes the
   order `done`. The next _Mark sent_ opens the next trip under the same number.
5. _Hold_ (from `to_send` or `at_lab`) keeps the status it came from; _Resume_ returns there. An
   order on hold is never late.
6. **Undo, one step back**, each audited: sent → the status before (the open trip is removed);
   received → `at_lab`; done → `arrived`; an outcome → `arrived`; cancel → the status it was
   cancelled from. The undo steps open to an order are returned with it (`undoable`).
7. Trip dates can be corrected, never in the future, received on or after sent. A corrected sent
   date moves the promised and expected dates by the same number of days.
8. The rules are pure functions in `labs/domain/order-status.ts`; illegal moves are 409
   `lab_order.transition`.

## Consequences

- Reports count per trip (turnaround, punctuality) and per order (remake and adjustment rates).
- Undo sent is the one place a trip row is deleted; everything else is kept.
