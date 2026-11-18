# Financial and operational dashboards — design

Feature 19. Written 2026-11-18 from the feature prompt (business requirements, decisions 1–16
taken with the owner, the _Design_ section D1–D8, Parts A–C). There is no Claude Design for this
feature. Everything marked **(my call)** is proposed and open to the owner.

## Problem

The owner wants to know in a few seconds how the clinic is doing, why, and what to do about it,
without adding up Payments, Visits, Expenses and the lab accounts by hand. Every figure must be
the figure its home screen shows for the same filter, and must open the rows behind it.

## Design decisions

- **D1. A new module `dashboards` that owns no tables (ADR-0087).** It depends on `billing`,
  `clinical`, `scheduling`, `patients`, `expenses`, `payroll`, `compensation`, `labs`, `tenancy`
  and `users`, and only calls their exported application services. No module imports it. Each
  owning module gains a **summary** method that takes validated input (period, branch, dentist)
  and returns plain data — the figure its own screen would total:

  | Module         | Summary (new, in its own service)                                                                                                                                                              |
  | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `billing`      | production, visits charged, discounts (via `clinical`'s visit money), collected, refunds, by method, by month, by dentist (the compensation attribution), by service, credit and advances held |
  | `clinical`     | visits done by type and dentist, timers, new / active / returning patients, came back, plan items by stage, plan value by priority, visits left open; the cohort patient lists                 |
  | `scheduling`   | due appointments by status and week, booked hours, busy hours, capacity from opening hours × active rooms, check-in times, follow-ups by state, accepted plans with nothing booked             |
  | `expenses`     | confirmed expenses by category and month (the caller's visible sources), fixed items waiting                                                                                                   |
  | `payroll`      | salaries waiting (pending net, this and earlier months)                                                                                                                                        |
  | `compensation` | earned per dentist for whole months (closed months from their snapshot), unpaid balance                                                                                                        |
  | `labs`         | the report figures and the accounts' outstanding (existing services, reused), the Today lane counts                                                                                            |
  | `patients`     | registrations incomplete, first-visit types of a set of patients                                                                                                                               |

  New dependency edges: only `dashboards → *`. `billing → clinical` and `scheduling → clinical`
  already exist.

- **D2. Period arithmetic is one pure function in contracts (ADR-0089)**, `resolvePeriod(query,
today)`, used by the API (authoritative) and the SPA (to print the dates while cards load).
  All dates are clinic-local `YYYY-MM-DD`.
  - _This month_: 1st → today; compared with the same days of last month, clamped to its end
    (1–31 Mar vs 1–28 Feb).
  - _Last month_: that whole month vs the month before.
  - _Last 3 months_ / _Last 12 months_: the 3 / 12 whole months ending with last month, vs the
    3 / 12 before **(my call: whole months, so a trend never ends in a part month)**.
  - _This year_: 1 Jan → today vs 1 Jan → the same day last year.
  - _Custom_: `from`–`to`, at most 24 months, never after today. Whole calendar months compare
    with the same number of whole months before; any other span with the same number of days
    immediately before.
  - **Trends**: the 12 months ending with the period's last month; the 12 Monday-weeks ending
    with its last week (the Schedule's week starts on Monday). Months before the clinic's first
    month (its creation date) are dropped, so a new clinic's trend starts at its first month.
  - **Now** figures ignore the period.
- **D3. Complete cost (ADR-0088)** = `expense:read` + `payroll:read` + `compensation:manage`.
  _Expenses_, _Net result_, the Expenses series of the main chart, _Where the money goes_ and
  every share of collected are computed only for it; otherwise the API returns no such field
  (`null`) and the SPA renders no card. _Expenses by category_ without complete cost shows the
  categories the caller's Expenses screen shows (its visible sources), without shares. A
  platform admin never holds payroll or compensation, so never has complete cost.
- **D4. Branch (decision 10).** Production (the visit's branch), collections (the payment's
  `branch_id`, recorded where it was taken), appointments, visits, follow-ups and lab orders
  filter by branch. Clinic-wide money steps aside with one line _All branches only_: expenses,
  net result, cost shares, what the clinic owes, **and also receivables and plan value (my call:
  a patient's balance and plan belong to no branch, and a partial total would look like the
  truth)**. On Operational, plan figures (acceptance, the funnel, accepted with nothing booked)
  and registrations incomplete also step aside with a branch **(my call, same reason)**.
- **D5. Dentist (Operational only)**: appointments and visits by their dentist, plans by the
  item's dentist, new/active patients by the dentist of the visit that makes them so, lab
  orders by their dentist, follow-ups by who recommended them. Room use with a dentist is that
  dentist's booked hours over the same capacity.
- **D6. Capabilities (ADR-0092).** `dashboard:financial` (_See financial dashboard_, implies
  `finance:read`) and `dashboard:operational` (_See operational dashboard_). Capability group
  `dashboard`. Owner and admin hold both (migration 0060 adds them to the `owner` and `admin`
  roles of every clinic and to their templates; nothing else changes). The summaries re-check in
  the service: financial ones `finance:read` (the Payments tier) and the dashboard permission;
  operational ones `dashboard:operational`, whatever the caller's visit scope; each part also
  its home permission (expenses `expense:read`, salaries `payroll:read`, compensation
  `compensation:manage`, lab money `lab:money_read`, lab figures `lab:read`).
- **D7. Charts (ADR-0091).** Recharts behind `apps/web/src/components/charts/`; nothing else
  imports it. Recharts draws the time charts (grouped and stacked columns) and the sparklines;
  ranked bars, the segmented bar, the rate list and the weekday × hour grid are plain HTML/CSS
  in the same folder (they need no scale, and stay readable to a screen reader). Colour tokens
  defined once (`chart-tokens.ts`) against theme variables in `styles.css`: four identity
  series (Production, Collected, Expenses, Other), one magnitude ramp, and the Schedule's
  status colours. The colour-blind and contrast check is recorded in the ADR.
- **D8. The quiet mark and the figure tile (ADR-0091).** `InfoMark` (`components/ui/
info-mark.tsx`, on `tooltip.tsx`): a small **!** button that opens its text on hover, focus
  and tap. `FigureTile` (`components/ui/figure-tile.tsx`) promotes the lab `Figure` look: label
  - **!**, value (mono, tabular, `dir="ltr"`), a change chip (arrow + percent, coloured by
    good/bad, neutral grey when neither), an optional sparkline, the whole tile a link. The rule
    "few labels, no helper sentences; explanations behind **!**" goes into CLAUDE.md §13.
- **D9. Live, cached, no snapshots.** Every card is its own query (TanStack Query key
  `['dashboards', tab, card, filters]`, `staleTime` 5 minutes, no refetch on focus). _Updated
  14:32_ is the oldest card's fetch time; the refresh button invalidates the `dashboards` key.
  If a card cannot answer in under a second on the seeded clinic, additive indexes come first.
- **D10. Viewing is not audited; exports are client-side CSV of the table the card shows**,
  like no existing export is audited (none is). _Export CSV_ appears only when the user holds
  the home permission's export right: `finance:read` for financial cards, `expense:read` for
  expense cards; operational cards export counts to whoever sees them.

## Figures (the contract)

All money is summed in cents (`bigint`) and formatted at the edge; rates are computed from
exact amounts. "—" when a denominator is 0 or there is nothing to compare with.

| Figure                      | Definition                                                                                                                                                                                                                                                               | Home screen it equals                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Production                  | Σ visit-kind ledger entries (charge, adjustment, reversal) with `effective_date` in the period                                                                                                                                                                           | Visits › _Charged in the period_ (new view) footer                          |
| Visits charged              | visits with a `visit_charge` entry in the period and no reversal                                                                                                                                                                                                         | —                                                                           |
| Average per visit           | production ÷ visits charged                                                                                                                                                                                                                                              | —                                                                           |
| Discounts                   | over the visits charged: Σ (line base − line final) + visit discount, from the visit as it stands; share = discounts ÷ (discounts + their totals)                                                                                                                        | Visits › charged, _with a discount_ footer                                  |
| Collected                   | Σ payments not voided − Σ refunds, by `paid_at`                                                                                                                                                                                                                          | Payments filtered to the period (new: from–to, branch, total)               |
| Collection rate             | collected ÷ production (may pass 100%)                                                                                                                                                                                                                                   | —                                                                           |
| Expenses                    | confirmed, not voided expenses by `spent_on`, every source (complete cost)                                                                                                                                                                                               | Expenses › History for the range                                            |
| Net result                  | collected − expenses                                                                                                                                                                                                                                                     | —                                                                           |
| Receivables (now)           | `billing`'s aging, as `GET /billing/aging`                                                                                                                                                                                                                               | Payments › Outstanding                                                      |
| By dentist                  | production by the visit's dentist; collected = payment allocations onto visit entries, by the allocation's local date, by the visit's dentist (what the compensation statement counts); _Unallocated_ = collected − Σ dentists. Earned: the compensation report's months | Compensation report / statement                                             |
| By service                  | each visit entry spread over the visit's lines (an entry moves each code from its prorated share before to its share after), so a voided visit nets to zero per code                                                                                                     | —                                                                           |
| Payment methods             | collected by the row's method (refunds subtract on their own method)                                                                                                                                                                                                     | Payments filtered by method                                                 |
| Plan value (now)            | Σ price of plan items `planned` and accepted, by priority (`planPhases` order); apart Σ planned and not accepted                                                                                                                                                         | Patients › _accepted plan_ list                                             |
| Owes (now)                  | labs: Σ outstanding of `GET /labs/accounts`; salaries: pending net of this month and earlier months; dentists: the current month report's `balanceOwed`; fixed: Today's pending items (count, Σ usual amount); credit: Σ unallocated credit + held advances              | Lab accounts, Payroll, Compensation, Expenses › Fixed                       |
| Due appointment             | `starts_at` in the period and before now; `rescheduled` rows never count (the successor does)                                                                                                                                                                            | Schedule › list (new)                                                       |
| No-show / cancel / complete | of due appointments by current status; _unresolved_ = due and still `booked`/`confirmed`/`checked_in`/`in_room`                                                                                                                                                          | Schedule › list, by status                                                  |
| Visits                      | visits `completed` or `amended` with `local_date` in the period, not imported                                                                                                                                                                                            | Visits › _Finished_ (new filter)                                            |
| New patients                | patients whose first visit ever (imported ones included) is in the period                                                                                                                                                                                                | Patients › _first seen_ (new cohort)                                        |
| Active (now)                | patients with a visit (any non-discarded, non-voided) in the last 12 months                                                                                                                                                                                              | Patients › _seen in 12 months_                                              |
| Came back (now)             | of patients first seen 3–6 months ago, the share with a later visit                                                                                                                                                                                                      | —                                                                           |
| Room use                    | booked minutes of due appointments not cancelled ÷ Σ over the period's passed days (opening minutes × active rooms of each branch)                                                                                                                                       | —                                                                           |
| Wait                        | `visit.started_at − appointment.checked_in_at`, same clinic day, positive; median and share > 15 min                                                                                                                                                                     | —                                                                           |
| Visit length                | per visit type: count, mean booked minutes (appointment), mean timer minutes (`duration_minutes`)                                                                                                                                                                        | —                                                                           |
| Plan acceptance             | of plan items recorded in the period (not deleted), the share accepted                                                                                                                                                                                                   | Patients › _proposed plans_                                                 |
| Plan funnel                 | recorded → accepted → started (`started_at` set) → completed (`performed`)                                                                                                                                                                                               | —                                                                           |
| Labs                        | `LabOrderReadsService.reports({ from, to, groupBy: 'lab' })` without costs                                                                                                                                                                                               | Lab › Reports                                                               |
| Follow-ups                  | created in the period: booked, waiting (awaiting, not expired), declined or expired                                                                                                                                                                                      | —                                                                           |
| Needs attention (now)       | unresolved appointments (past, booked/confirmed, ended); live visits started before today; patients with an accepted, not started item and no upcoming active appointment; overdue follow-ups; lab late; lab arrived with no appointment; registrations incomplete       | Schedule (unresolved), Visits (in progress), Patients, Today, Lab, Patients |

Room use counts every due appointment that was not cancelled (a no-show held the chair).

## Drill-down additions (in their own modules)

1. **Visits** (`clinical`, `billing`): `from`/`to` replace the range; `branch` (`all` or a
   branch; default the session's); `finished` (completed/amended, not imported); _Charged in
   the period_ is `GET /billing/visits/charged` + `/summary` (visits with a visit entry dated in
   the range; footer: count, charged, discounts), `discounted` narrows it.
2. **Payments** (`billing`): `from`/`to`, `branch`, and `GET /billing/payments/summary`
   (collected, refunds, net for the filters) shown as the list's total.
3. **Schedule** (`scheduling`): a _List_ view, `GET /scheduling/appointments/list` (dates,
   branch optional, dentist, status incl. `unresolved`, weekday and hour), cursor-paged.
4. **Patients**: cohorts `first_seen`, `seen`, `proposed`, `accepted` (`GET
/clinical/patients`), `accepted_unbooked` (`GET /scheduling/patients`), `incomplete` (`GET
/patients`), with `from`/`to`/`branch`/`dentist` where they apply.
5. **Lab**, **Expenses**, **Payroll**, **Compensation**, **Today**: existing filters suffice.

Not a link **(my call)**: the service _Category_ bars, _Came back_, the new patients' reasons,
the follow-ups bar and _Patient credit_ (no screen lists them yet).

## Screens

`/dashboard?tab=financial|operational&period=&from=&to=&branch=&dentist=` (`staticData.navKey
'dashboard'`). Sidebar entry after Today, shown with either capability. The page: header
(title only), sticky filter row (Period segmented select + Custom dates, Branch select when the
clinic has more than one, Dentist on Operational; at the end the resolved dates "1–18 Nov · vs
1–18 Oct" and _Updated 14:32_ with a refresh icon button), then the tab's grid (12 columns;
tiles `col-span-3` → 6 → 12; charts 6/12; main chart 12, or 8 + attention 4 on Operational).
Print: `@media print` hides the sidebar, filters and menus, shows the clinic, period and print
time.

## Out of scope

As the prompt lists. No assistant tools, no Today change, no restyle of existing screens.
