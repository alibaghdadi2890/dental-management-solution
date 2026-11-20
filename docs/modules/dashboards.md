# `dashboards` module

**Status:** implemented for feature 19: the Financial and Operational dashboards (ADR-0087 to
ADR-0092).

## Purpose

Two read-only dashboards for the people who run the clinic: what it produced, collected, spent,
is owed and owes; and how the schedule, the chairs, the patients, the plans and the labs are
doing. Every figure is the figure its home screen totals for the same filter, and opens the rows
behind it.

## Owns

No tables (ADR-0087). Nothing is stored or precomputed; viewing is not audited.

## Depends on

`billing`, `clinical`, `scheduling`, `patients`, `expenses`, `payroll`, `compensation`, `labs`
(their summary methods, see each module's page), `tenancy` (currency, time zone, the clinic's
first month) and `users` (dentists' names). No module imports `dashboards`.

## Rules

- **Period** (ADR-0089): `resolvePeriod` in `@dcm/contracts`. _This month_ vs the same days of last
  month; whole months for _Last month_, _Last 3 months_, _Last 12 months_; a custom period of at
  most 24 months ending by today. Trends are the 12 months and 12 Monday-weeks ending with the
  period. An invalid custom period is 422 `validation_failed`.
- **Complete cost** (ADR-0088): expense totals, net result and cost shares only with
  `expense:read` + `payroll:read` + `compensation:manage`; otherwise `null`.
- **Branch**: production (the visit's branch), collections (where the payment was recorded),
  appointments, visits, follow-ups and lab orders filter by it. Clinic-wide money, receivables,
  plan figures and registrations step aside (_All branches only_).
- **Dentist** (Operational only): appointments, visits, plan items, patients (by the visit that
  makes them new or active), lab orders and follow-ups.
- **Capacity** (ADR-0090): opening minutes × active rooms over the days that have passed.
- The only arithmetic of its own (`domain/figures.ts`): the wait from check-in to the start of the
  visit (same clinic day), medians and means.

## Routes

Every route takes `period`, `from`, `to`, `branchId` and (Operational) `dentistId`; the _now_
cards ignore them.

| Route                                      | Permission                             | Card                                                         |
| ------------------------------------------ | -------------------------------------- | ------------------------------------------------------------ |
| `GET /dashboards/financial/money`          | `dashboard:financial`                  | production, collected, discounts, average, months, methods   |
| `GET /dashboards/financial/costs`          | `dashboard:financial` + `expense:read` | expenses (complete cost), by category, cost groups           |
| `GET /dashboards/financial/receivables`    | `dashboard:financial`                  | now: aging buckets, five largest balances by family          |
| `GET /dashboards/financial/dentists`       | `dashboard:financial`                  | production, collected, earned (`compensation:manage`)        |
| `GET /dashboards/financial/services`       | `dashboard:financial`                  | production by service and category                           |
| `GET /dashboards/financial/plans`          | `dashboard:financial`                  | now: accepted not started by priority, proposed              |
| `GET /dashboards/financial/owes`           | `dashboard:financial`                  | now: labs, salaries, dentists, fixed, credit (each its perm) |
| `GET /dashboards/operational/appointments` | `dashboard:operational`                | due by outcome, 12 weeks, room use                           |
| `GET /dashboards/operational/busy-hours`   | `dashboard:operational`                | weekday × hour, booked and no-shows                          |
| `GET /dashboards/operational/visits`       | `dashboard:operational`                | visits, months, wait, lengths by type                        |
| `GET /dashboards/operational/patients`     | `dashboard:operational`                | new, active, came back, months, reasons                      |
| `GET /dashboards/operational/plans`        | `dashboard:operational`                | plan items by stage                                          |
| `GET /dashboards/operational/dentists`     | `dashboard:operational`                | the dentists table                                           |
| `GET /dashboards/operational/labs`         | `dashboard:operational` + `lab:read`   | lab report figures, no costs                                 |
| `GET /dashboards/operational/follow-ups`   | `dashboard:operational`                | follow-ups by state                                          |
| `GET /dashboards/operational/attention`    | `dashboard:operational`                | now: what needs attention (lab lines with `lab:read`)        |

## Drill-downs (added to their own modules)

- Visits: `from`/`to`, `branchId` (`all`), `finished`; `GET /billing/visits/charged` (+
  `/summary`) for _Charged in the period_ and `discounted`.
- Payments: `from`/`to`, `branchId`; `GET /billing/payments/summary`.
- Schedule: the List view, `GET /scheduling/appointments/list`.
- Patients: `cohort` (`first_seen`, `seen`, `proposed`, `accepted` from `GET /clinical/patients`;
  `accepted_unbooked` from `GET /scheduling/patients`; `incomplete` on `GET /patients`).

## Screen

`/dashboard` (sidebar _Dashboard_, with either permission): the Financial and Operational tabs,
one sticky filter row, tiles, the main chart, the breakdowns and the lists. The charts are drawn
by `apps/web/src/components/charts/` (ADR-0091).

## Feature 20a: inventory

- **Financial · What the clinic owes** gains **Suppliers** (`SuppliersService.outstanding`, with
  `inventory:money_read`), equal to the Suppliers tab's total.
- **Financial · Stock** (`GET /dashboards/financial/stock`, `dashboard:financial` +
  `inventory:money_read`): Reports' stock value now (by branch), consumption in the period, the
  top eight items by cost and _Other_, and what is still to price (`InventoryReportsService.stockCard`).
  The SPA sets it aside with a dentist filter.
- **Operational · Needs attention** gains `stockOut`, `stockLow`, `stockExpired`
  (`StockService.attention`: item-branch pairs with that label, for the branch or all), with
  `inventory:read`, null with a dentist filter; each opens the Stock list filtered.
- Supplier payments are already inside Expenses: Expenses, Net result, complete cost and _Where
  the money goes_ do not change.

## Feature 21: the waitlist

- **Operational · Needs attention** gains `openingsToFill`: the openings at least one waiting
  entry fits and nobody left open, the same count as Today's _Openings to fill_. It covers the
  filter's branch (every branch without one) and dentist
  (`SchedulingSummaryService.attention` → `WaitlistOpeningsService.openingsToFill`). It is null
  without `appointment:write_all`, and it opens Today. Nothing else changes on the dashboards.
