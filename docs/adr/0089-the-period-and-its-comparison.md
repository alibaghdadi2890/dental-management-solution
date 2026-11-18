# ADR-0089: The period, what it is compared with, and the trends

- Status: Accepted
- Date: 2026-11-18

## Context

A running month compared with a whole month always looks worse. The SPA must print the dates while
the cards load, and the API must count the same days.

## Decision

1. One pure function, `resolvePeriod` (`@dcm/contracts`, `dashboards.ts`), used by both. All dates
   are clinic-local.
2. _This month_: the 1st to today, compared with the same days of last month, clamped to its end
   (1–31 Mar vs 1–28 Feb). _This year_: 1 Jan to today vs the same days last year (29 Feb vs
   28 Feb).
3. _Last month_, _Last 3 months_, _Last 12 months_: whole months ending with last month, compared
   with as many whole months before.
4. _Custom_: at most 24 months, never after today. Whole calendar months compare with as many
   months before; any other span with as many days immediately before.
5. Trends ignore the period's length: the 12 months ending with its last month, the 12
   Monday-weeks (the Schedule's week) ending with its last week. Months and weeks before the
   clinic's first are dropped.
6. _Now_ figures ignore the period and carry no comparison.

## Consequences

- A change chip is "—" when there is nothing to compare with (a previous value of 0).
