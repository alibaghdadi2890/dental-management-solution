# ADR-0105: Who fits an opening, and in what order

- Status: Accepted
- Date: 2026-11-19

## Context

A freed time must reach the patient who asked for it first. The front desk calls down a list, so
the list must be fair, and it must leave out whoever cannot come.

## Decision

1. `domain/waitlist-fit.ts` (`startsFor`) gives every start an entry may take in an opening. If it
   gives none, the entry does not fit. These are the rules:
   - The branch is the opening's. The entry names the opening's dentist or _Any dentist_.
   - Each start is a freed part's start or on the 15-minute grid of the clinic-local day. The
     grid comes from the local clock, so a DST change keeps it.
   - The whole appointment lies inside the opening, overlaps freed time, and lies inside
     _Between_. The day is one of the chosen _Days_, and not before _Not before_.
   - An opening today needs _Same day_.
   - With an appointment, the start is earlier than that appointment. Without one, the day is on
     or before _Until_.
   - The patient has no other active appointment overlapping the span. The appointment being
     brought forward does not count.
   - The length is the appointment's, or the entry's own.
2. The default start is the freed slot's own start when it is valid. The other starts follow in
   time order.
3. The order (`domain/waitlist-order.ts`) is: _Urgent_ first, then entries not tried today, then
   whoever was added first. The uuid v7 id breaks ties, because it follows the application's clock
   and not the database's.
4. An entry whose patient has lab work expected after the opening still fits. The SPA lists it
   last, with the lab mark and the existing booking warning. That warning belongs to the SPA
   (ADR-0081), and `scheduling` cannot read `labs`, because `labs` depends on it.

## Consequences

- The domain tests cover adjacent appointments, the grid, DST, closed days, the edge of the
  opening hours, midnight in the clinic's zone, every fit rule and the order.
- A call's outcome only moves an entry down for the rest of the day. Calls are not logged; the
  entry keeps its last attempt.
