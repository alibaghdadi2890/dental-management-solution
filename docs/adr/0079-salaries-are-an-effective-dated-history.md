# ADR-0079: A salary is an effective-dated history

- Status: Accepted
- Date: 2026-11-06

## Context

An employee's monthly salary changes over time. The owner wants the history kept (who changed it,
when, from which month). Back-dating is wanted for months not yet paid, but a paid month must keep
what was paid.

## Decision

1. Salaries are append-only rows of `employee_salaries`: amount, currency, effective month, reason
   and who created the row. The runtime role has no `UPDATE` or `DELETE` on them. A change, or a
   correction of a wrong entry, is a new row.
2. The salary for month M is the entry with the latest effective month that is not after M. When two
   entries share that month, the later-created one wins (uuid v7 order).
3. A new entry must take effect **after the employee's last paid month** (409
   `payroll.month_paid`). Earlier unpaid months can be back-dated. The owner chose this on
   2026-11-06 over "any month, paid ones frozen" because it is easier to explain.
4. A payment freezes its base, adjustments and net, so a paid month never follows a later salary.
5. A change of hire date, first payroll month or end date that would leave a paid month outside
   the employment is refused (409 `payroll.paid_outside_employment`).

## Consequences

- The history panel lists every entry, newest first, with who changed it and when.
- `employee_salary.change` is audited with the old and new amounts and the effective month, and is
  visible only to whoever may read payroll (ADR-0080).
