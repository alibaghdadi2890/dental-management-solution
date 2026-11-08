# ADR-0080: Expense and payroll permissions, and who sees which rows

- Status: Accepted
- Date: 2026-11-06
- Amends: ADR-0055 (what a platform admin holds in a clinic)

## Context

Expenses and payroll need their own access (feature 17). Salaries are more sensitive than rent. The
owner wants the defaults to be "owner and admin only", granted per role or per person from the
existing screens. A user without access should see no trace of salary amounts, not even a hint that
something is hidden.

## Decision

1. There are four permissions: `expense:read`, `expense:manage`, `payroll:read` and
   `payroll:manage`. Each `manage` implies its `read`. They form two capability groups, `expenses`
   and `payroll`, labelled in three languages.
2. Migration 0058 only adds them to every clinic's `owner` and `admin` roles and to those two
   templates. No other role or grant changes.
3. A platform admin acting in a clinic holds `expense:*`, but never `payroll:*`
   (`RequestContext.hasPermission`, beside `compensation:*`).
4. Rows in Expenses are filtered by source:
   - typed and fixed rows need `expense:read`;
   - _Payroll_ rows also need `payroll:read`;
   - _Dentist compensation_ rows also need `compensation:manage`.

   Rows a caller may not see are left out of lists, totals, the category summary and exports,
   silently. The Today card never shows the mirrored rows, whoever looks.

5. The audit feed hides expense rows without `expense:read`. It hides employee, salary and payroll
   line rows, and the stored `PayrollPayment*` events, without `payroll:read`. Platform Activity
   never shows payroll.
6. In the SPA:
   - Expenses and Payroll are main navigation entries.
   - Today opens for `expense:read` too. Someone who sees expenses but not patients lands on Today.
   - A route opened without the permission shows "No access".

## Consequences

- A clinic can give its accountant expenses without salaries, or payroll without patients.
- Totals differ between users with different permissions, by design and without explanation.
