# `payroll` module

**Status:** implemented for feature 17 (Part B). ADR-0077 to ADR-0080; spec
`docs/superpowers/specs/2026-11-06-expenses-and-payroll-design.md`.

## Purpose

The clinic's employees who are not dentists, their monthly salary history, and the monthly run.
A confirmed line is a salary payment. `expenses` mirrors it as a *Salaries* row (ADR-0076).
Dentists are paid through `compensation` (ADR-0077).

## Depends on

- `users`: the linked staff user, its type and active flag (`staffSummaries`), and names
- `tenancy`: currency, time zone, branches, locale
- `audit`

It publishes `PayrollPaymentConfirmed` and `PayrollPaymentVoided`, which `expenses` consumes in the
transaction. It vetoes `TenantCurrencyChanged` once any salary exists. Nothing imports `payroll`
except for those events.

## Tables (migration 0058)

All are tenant tables with RLS.

| Table                 | What                                                                                                          | Rules                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `employees`           | details, `hire_date`, `payroll_from`, branch, `status` (`active`/`left`), `end_date`, `staff_profile_id`        | one live employee per staff profile; removed softly       |
| `employee_salaries`   | amount, currency, `effective_month`, reason, `created_by`                                                     | append-only (no `UPDATE`/`DELETE` for the runtime role)    |
| `payroll_lines`       | a touched line: `(employee, month)`, `pending`/`paid`/`skipped`, skip reason                                  | unique per employee and month; never deleted              |
| `payroll_adjustments` | a pending line's bonuses, deductions (typed positive) and others (signed), with labels                         | replaced as a list                                        |
| `payroll_payments`    | base, adjustments snapshot, net > 0, currency, paid on, method, note, void columns, idempotency               | one live payment per line; only the void columns update   |

## Rules

- **Employed months.** From `max(hire month, payroll_from)` to the end month, and at most the
  current month in the clinic's time zone. The hire and end months show "Joined on …" and
  "Left on …". Nothing is pro-rated.
- **Lines are derived (ADR-0078).** A pending line reads the salary in force. A paid line shows its
  payment. A line has no salary until the first salary entry takes effect.
- **Salaries (ADR-0079).** The salary for a month is the latest entry with an effective month not
  after it (the later-created entry wins a tie). A new entry must take effect after the last paid
  month. Dates may never leave a paid month outside the employment.
- **Net** = base + Σ adjustments, never below zero (`netPay` in contracts). Adjustments that would
  make it negative are refused.
- **Confirm** works on 1 to 50 lines in one transaction under an `Idempotency-Key`. Each line
  carries the net the user saw; a changed line is refused (409 `payroll.stale`). A line with no
  salary, or with a net of zero, can't be paid: skip it instead.
- **Skip** needs a reason; **Undo skip** reverses it. **Void** voids the payment and its expense,
  and the line is pending again.
- **Link (ADR-0077).** Only active non-dentist staff, one employee each. Deactivated or
  turned-dentist users show a notice. **Remove** is allowed only without any stored line.
- One employee's writes run one at a time (an advisory lock).

## Routes

Every read needs `payroll:read`; every write needs `payroll:manage`. A platform admin holds
neither.

| Route                                                                                    | Notes                                            |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `GET/POST /payroll/employees` · `GET/PATCH/DELETE /payroll/employees/:id`                | the patch covers details, the link and the status |
| `GET /payroll/staff`                                                                     | linkable staff                                   |
| `POST /payroll/employees/:id/salaries` · `GET /payroll/employees/:id/export?lang=`       |                                                  |
| `GET /payroll/runs/:month`                                                               | lines, totals, earlier months still pending      |
| `PUT /payroll/runs/:month/lines/:employeeId/adjustments`                                 |                                                  |
| `POST /payroll/confirm`                                                                  | `Idempotency-Key`                                |
| `POST /payroll/runs/:month/lines/:employeeId/skip` · `…/unskip` · `…/void`                | skip and void need `{ reason }`                  |
| `GET /payroll/months?year=` · `GET /payroll/months/export?year=&lang=`                   |                                                  |

## Errors

| Status | Codes                                                                                                                                                                                    |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 422    | `payroll.dentist_not_linkable`, `payroll.invalid_dates`, `payroll.not_employed`, `payroll.no_salary`, `payroll.net_not_positive`, `payroll.net_negative`, `payroll.future_date`, `tenant.currency_locked` |
| 409    | `payroll.user_already_linked`, `payroll.month_paid`, `payroll.paid_outside_employment`, `payroll.line_not_pending`, `payroll.stale`, `payroll.not_removable`, `payroll.idempotency_mismatch` |
| 404    | `payroll.not_found`, `payroll.staff_not_found`, `branch.not_found`                                                                                                                       |

## Audit

The actions are `employee.create | update | link | unlink | leave | rejoin | remove`,
`employee_salary.change` (from, to, effective month) and
`payroll_line.adjust | confirm | skip | unskip | void`. They fall in the `payroll` Activity area,
which only `payroll:read` sees and platform Activity never shows.

## Screens

**Payroll** (`/payroll`) has three tabs:

- **Monthly run**: the month picker, the totals, a banner for earlier months still pending, and
  the lines with Adjust, Confirm (one or several), Skip, Undo skip and Void.
- **Employees**: the list and the employee panel, with details, link, Mark as left, Remove, the
  salary history with Change salary, and the payroll history with export.
- **Year**: the net paid per month, with export.
