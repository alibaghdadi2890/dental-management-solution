# ADR-0090: Capacity is opening hours × active rooms

- Status: Accepted
- Date: 2026-11-18

## Context

Room use needs a capacity. Dentist schedules do not exist yet (ADR-0068): the only availability is
each branch's weekly opening hours, and the bookable unit is the room.

## Decision

1. Capacity of a day = the branch's opening minutes that weekday × its active rooms; of a period,
   the sum over the days that have passed (before today). Without a branch, every active branch.
2. Booked = the minutes of the appointments due on those days that were not cancelled (a no-show
   held the chair).
3. There is no use rate per dentist; dentists are compared on booked hours. With a dentist
   selected, room use is that dentist's booked minutes over the same capacity.

## Consequences

- When dentist schedules arrive, capacity becomes theirs and this ADR is superseded.
