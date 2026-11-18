# ADR-0087: The `dashboards` module owns no tables and asks the modules that hold the facts

- Status: Accepted
- Date: 2026-11-18

## Context

Feature 19 adds a Financial and an Operational dashboard. Every figure on them already has a home
screen (Payments, Visits, Expenses, a compensation statement, the lab reports). Two screens that
disagree by one dollar are the failure to avoid, and CLAUDE.md §4 forbids reading another module's
tables.

## Decision

1. A new module, `dashboards`, owns **no tables**. It depends on `billing`, `clinical`,
   `scheduling`, `patients`, `expenses`, `payroll`, `compensation`, `labs`, `tenancy` and `users`,
   and only calls their exported application services. No module imports it.
2. Each owning module gains **summary** methods in its own service, taking validated input
   (span, branch, dentist) and returning plain data — the figure its own screen totals:
   - `billing` (`BillingSummaryService`): production, visits charged, discounts, collected and by
     method, by month, by dentist, by service, receivables with the largest balances, patient
     credit; the charged view and the payments total that the drill-downs open.
   - `clinical` (`ClinicalSummaryService`): finished visits and their rows, new, active and
     returning patients, _came back_, plan stages, plan value, visits left open, the patient
     cohorts; two ungated building blocks `billing` reads (visit facts, discount facts).
   - `scheduling` (`SchedulingSummaryService`): due appointments by outcome and week, room use,
     busy hours, follow-ups, needs-attention counts, the Schedule's List view, accepted plans with
     nothing booked.
   - `expenses` (`dashboardCosts`, `fixedWaiting`), `payroll` (`waiting`), `patients`
     (`incompleteCount`, `firstVisitTypes`), `labs` (`attention`; the reports and accounts as
     they are), `compensation` (its monthly report as it is).
3. The new dependency edges are only `dashboards → *`. `billing → clinical` and
   `scheduling → clinical` already existed.
4. The dashboard computes only what no screen totals: the wait at check-in, visit lengths and
   medians (`dashboards/domain/figures.ts`).
5. One route per card (`GET /dashboards/financial/*`, `GET /dashboards/operational/*`), so each
   card loads and fails on its own. Viewing is not audited.
6. Live and read only: no snapshots, no jobs. Additive indexes (migration 0060) on visits by
   date, appointments by start and plan items by recording time.

## Consequences

- A figure and its home screen are one query in one module; the integration suite compares them.
- The summaries take plain input and return plain data, ready to become read tools later.
- A slow card does not hold the others.
