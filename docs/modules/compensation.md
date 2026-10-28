# `compensation` module

**Status:** implemented for feature 13b: agreements, monthly statements, adjustments, payouts,
closing months, the report and the dentist's own statement (ADR-0058 to ADR-0060).

## Purpose

How the clinic pays each dentist, and what it owes them month by month.

- **Agreements** are effective-dated component sets (ADR-0058).
- The **statement** is computed from the ledger for open months and frozen when the month is
  closed (ADR-0059).
- Only the clinic manages it. A dentist reads their own statement (ADR-0060).

## Depends on

- `users` (dentists' names, `StaffDeactivated`)
- `clinical` (`VisitFactsService.compensationFacts`, `CatalogService.categoriesByCodes`)
- `billing` (`visitChargesBetween`, `chargeLinesFor`, `visitCollectionsBetween`,
  `unattributedCollectionsBetween`)
- `patients` (names on lines)
- `tenancy` (currency, time zone, locale)
- `audit`

No module imports `compensation`. It reacts to `StaffDeactivated` in the deactivation's
transaction.

## Tables (migration 0053)

All tenant tables have RLS, and none is ever deleted from.

| Table                      | What                                                                                                                                          | Updatable columns (runtime role)                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `compensation_agreements`  | an agreement: preset, `components` jsonb, dates, visibility, note; exclusion `compensation_agreements_no_overlap` (`btree_gist`) on live rows | `effective_to`, `ended_*`, `end_reason`, `superseded_*`, `supersede_reason` |
| `compensation_adjustments` | dated, signed, kind, note, idempotency key + hash                                                                                             | the void columns                                                            |
| `compensation_payouts`     | dated, positive, method (text, the payments' methods), reference, note, idempotency                                                           | the void columns                                                            |
| `compensation_periods`     | a closed (or reopened) month: `snapshot` jsonb, `line_ids`, close/reopen columns, last idempotency key                                        | status, snapshot, line ids, close/reopen and idempotency columns            |

## Rules

### Statement lines

| Line       | Source                                                 | Its own month      | Rate from                     |
| ---------- | ------------------------------------------------------ | ------------------ | ----------------------------- |
| Production | visit-kind ledger entries                              | `effective_date`   | agreement on the visit's date |
| Collection | payment-sourced allocations onto visit entries, signed | local `created_at` | agreement on the visit's date |
| Per visit  | completed, non-voided, non-imported visits             | the visit's date   | —                             |
| Per day    | days with such visits                                  | that day           | —                             |
| Fixed      | pro-rated by the days the agreement covers             | the month          | —                             |

- A visit with no agreement on its date earns nothing. Its billed lines are listed under
  "Without an agreement".
- Lines in another currency are listed under "Not computed".
- **Rates by service** blend over the visit's lines, pro-rated to the net amount: an entry at
  the lines before it (a charge at its own), a collection at the visit's latest lines. A
  correction that changed the lines and so the rate earns E(after) − E(before), the net so far at
  each state's rate, and shows its effective rate (ADR-0062). The
  **threshold** applies per statement month and per agreement. When the base is zero or less,
  the corrections claw back in full. An unprorated fixed amount is paid once, by the month's last
  agreement that has one.
- Every line has a stable id. A closed month stores the ids it counted.
- **Late entries:** a line of a closed month that no snapshot counted is reported in the first
  open month. This includes per-visit and per-day reversals of visits voided after the close.

### Periods

- Months close in order, from the dentist's first month, and only once they have ended.
- Only the last closed month reopens, with a reason.
- Adjustments, payouts and agreement dates are refused inside a closed month.

### Concurrency and retries

- A dentist's writes run one at a time (an advisory lock on them).
- Adjustments, payouts, close and reopen take an `Idempotency-Key`.

## Routes

Every route needs `compensation:manage` unless stated.

| Route                                                                              | Notes                                                |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `GET/POST /compensation/dentists/:profileId/agreements`                            | list (newest first), create                          |
| `POST …/agreements/change-terms`                                                   | ends or supersedes the current one, creates the next |
| `POST …/agreements/:id/end`                                                        | `{ date, reason? }`                                  |
| `GET …/statement?month=` · `GET …/statement/export?month=&lang=`                   |                                                      |
| `POST …/adjustments` · `POST …/adjustments/:id/void`                               | `Idempotency-Key` on record; void needs `{ reason }` |
| `POST …/payouts` · `POST …/payouts/:id/void`                                       | the same                                             |
| `POST …/periods/:month/close` · `POST …/periods/:month/reopen`                     | `Idempotency-Key`; reopen needs `{ reason }`         |
| `GET /compensation/report?month=` · `GET /compensation/report/export?month=&lang=` |                                                      |
| `GET /compensation/me/statement?month=` · `GET /compensation/me/months`            | `compensation:read`; own only                        |

## Errors

| Status | Codes                                                                                                                                                                                                |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 422    | `compensation.overlap`, `compensation.period_closed`, `compensation.effective_date`, `compensation.month_not_ended`                                                                                  |
| 409    | `compensation.previous_period_open`, `compensation.next_period_closed`, `compensation.already_closed`, `compensation.not_closed`, `compensation.not_reversible`, `compensation.idempotency_mismatch` |
| 404    | `compensation.not_found`, `agreement.not_found`                                                                                                                                                      |
| 403    | `forbidden`                                                                                                                                                                                          |

## Events

`AgreementCreated`, `AgreementEnded`, `AgreementSuperseded`, `AdjustmentRecorded`,
`AdjustmentVoided`, `PayoutRecorded`, `PayoutVoided`, `PeriodClosed`, `PeriodReopened`.

- Each event is ids and minimal facts.
- Each action is also audited as `compensation.*`, with resource type `compensation_*` and the
  dentist's name in `after`. Activity shows it in the **Compensation** area, only to whoever has
  `compensation:manage`.

## Screens

- **Settings › Staff › a dentist › Compensation.** The agreement card, its history, and New
  agreement / Change terms / End agreement.
- **Compensation** (`/compensation`). The month's report, and each dentist's statement with
  Add adjustment, Record payout, Close month / Reopen and Export.
- **My statement** (`/my/statement`). The dentist's own months, read-only.
