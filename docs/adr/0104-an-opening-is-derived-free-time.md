# ADR-0104: An opening is free time around freed time, worked out when read

- Status: Accepted
- Date: 2026-11-19

## Context

Only freed time is an opening: time a dentist was booked for and is no longer. Time that was never
booked is not. Otherwise an empty calendar would flood the list. Nothing may change by itself,
and the clinic has no jobs (no Redis, feature 15 onwards).

## Decision

1. A **freed slot** is a `cancelled` or `rescheduled` row of the branch whose start is still
   ahead. Its dentist must still be active in the branch.
2. An **opening** is a run of the dentist's free time that holds at least 15 minutes of freed
   time. Free time is the branch's opening hours of that day as they are now, after now, minus
   every active appointment of that dentist in any branch. Its `freed` parts are the freed time
   still free inside it.
3. `domain/openings.ts` (`findOpenings`) works this out as a pure function, called on every read.
   Nothing is stored. A restore, a new booking, a change of hours or the clock passing changes the
   answer on the next read.
4. An opening's id is its first freed appointment. A booking in the middle of a freed slot splits
   it into two openings with the same id, so an opening is found by its id and an instant inside it
   (`openingOf`; `?at=` on the routes).
5. _Leave open_ is the only stored fact: `waitlist_left_open` holds freed appointment ids. An
   opening is left open when every freed appointment in it is. A new cancellation that joins it
   brings it back.

## Consequences

- Each read of the openings costs a few queries per branch: freed rows, the dentists' active rows,
  the live entries and the patients' active rows. With 300 entries and 200 openings, the fit is
  about 60,000 cheap checks in memory.
- Openings follow the opening hours as they are now. A dentist schedule (deferred, ADR-0068) will
  be one more busy list.
