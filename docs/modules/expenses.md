# `expenses` module

**Status:** implemented for feature 17 (Part A). ADR-0076, ADR-0078 and ADR-0080; spec
`docs/superpowers/specs/2026-11-06-expenses-and-payroll-design.md`.

## Purpose

What the clinic spends. An expense is always a payment that already happened: there are no bills
or payables.

- **Categories**: the predefined list, *Other*, the two reserved categories, and the clinic's own.
- **Expenses**: typed, confirmed from a fixed expense, or mirrored from a salary payment or a
  dentist payout (read-only).
- **Fixed expenses**: monthly templates whose months wait for confirmation.
- The history, the summary by category, the year month by month, the CSV export, and Today's
  *This month's expenses* card.

## Depends on

- `tenancy` (currency, time zone, branches, locale)
- `users` (the dentist named on a mirrored payout)
- `audit`
- the events of `payroll` (`PayrollPaymentConfirmed`, `PayrollPaymentVoided`) and `compensation`
  (`PayoutRecorded`, `PayoutVoided`), consumed in their transactions (ADR-0076)
- `TenantProvisioned` (seeds the categories, after the commit) and `TenantCurrencyChanged` (vetoed
  once any expense or fixed expense exists)

Nothing imports `expenses`.

## Tables (migration 0058)

All are tenant tables with RLS.

| Table                 | What                                                                                                                         | Rules                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `expense_categories`  | `key` (predefined, `other`, `salaries`, `dentist_compensation`) or a custom `name`; `active`                                 | unique key; unique `lower(name)`; a custom one never used may be deleted          |
| `expenses`            | date, category, amount > 0, currency, method, payee, reference, description, branch, `source`, `source_id`, `source_month`, void columns, idempotency | never deleted; unique per payroll payment or payout; one live row per fixed item |
| `fixed_expenses`      | the template: name, category, amount, method, payee, branch, note, `first_month`, `next_month`, `status`                     | never deleted                                                                     |
| `fixed_expense_items` | one month of a template, a snapshot of it; `pending` / `confirmed` / `skipped`; the expense that confirmed it               | unique `(fixed_expense_id, month)`; never deleted                                 |

## Rules

- **Categories (D7).** Predefined ones are deactivated, not renamed. *Other* and the reserved ones
  never change. A custom name is unique case-insensitively against custom names and every
  translation of the keyed ones. *Other* needs a description. The reserved ones are never chosen
  by hand.
- **Expenses.** Dated at most today (clinic time zone). Typed and confirmed rows are edited, with
  an audit of the changed fields, and voided with a reason. Mirrors are refused (409
  `expense.system_row`). Voiding a fixed row puts its month back to pending.
- **Catch-up (ADR-0078).** Every read or write that shows waiting months first gives each active
  template its items up to the current month. Pause skips months, resume restarts at the current
  month, and end is final.
- **Confirm** works on 1 to 50 items in one transaction, each with its own amount, date, method and
  so on, under an `Idempotency-Key`. **Skip** takes an optional reason, and **Undo skip** reverses
  it.
- **Visibility (ADR-0080).** `payroll` rows need `payroll:read`, and `compensation` rows need
  `compensation:manage`. Hidden rows are left out of lists, totals and exports. The dashboard
  counts only `manual` and `fixed`.

## Routes

Every read needs `expense:read`; every write needs `expense:manage`.

| Route                                                                     | Notes                                                                       |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `GET/POST /expenses/categories` · `PATCH/DELETE /expenses/categories/:id` |                                                                             |
| `GET /expenses?from&to&categoryId&branchId&method&q&includeVoided&cursor` | page with `total` and `byCategory` over the whole filter                    |
| `GET /expenses/year?year=` · `GET /expenses/export?…&lang=`               |                                                                             |
| `POST /expenses` · `PATCH /expenses/:id` · `POST /expenses/:id/void`      | record takes an `Idempotency-Key`                                           |
| `GET /expenses/dashboard`                                                 | this month (typed and fixed only), 8 latest, every waiting month            |
| `GET /expenses/pending` · `POST /expenses/pending/confirm`                | confirm takes an `Idempotency-Key`                                          |
| `POST /expenses/pending/:id/skip` · `…/unskip`                            |                                                                             |
| `GET/POST /expenses/fixed` · `GET/PATCH /expenses/fixed/:id`              |                                                                             |
| `POST /expenses/fixed/:id/pause` · `…/resume` · `…/end`                   |                                                                             |

## Errors

| Status | Codes                                                                                                                                                                                         |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 422    | `expense.category_name_taken`, `expense.category_inactive`, `expense.category_reserved`, `expense.description_required`, `expense.future_date`, `tenant.currency_locked`                     |
| 409    | `expense.category_locked`, `expense.category_in_use`, `expense.system_row`, `expense.voided`, `expense.item_not_pending`, `expense.fixed_status`, `expense.idempotency_mismatch`             |
| 404    | `expense.not_found`, `expense.category_not_found`, `branch.not_found`                                                                                                                         |

## Audit

The actions are `expense.record | update | void`,
`expense_category.create | rename | deactivate | reactivate | delete`,
`fixed_expense.create | update | pause | resume | end` and
`fixed_expense_item.confirm | skip | unskip`. They fall in the `expenses` Activity area. A
confirmation also writes a hidden `expense.record`.

## Screens

- **Today**, the *This month's expenses* card.
- **Expenses** (`/expenses`), with four tabs:
  - **History**: what waits, the filters in the URL, the category chips, the list with its
    footer total, and Record, Edit, Void and Export;
  - **Year**;
  - **Fixed expenses**: the template panel, with its months and Confirm, Skip, Undo skip, Pause,
    Resume and End;
  - **Categories**, for `expense:manage`.
