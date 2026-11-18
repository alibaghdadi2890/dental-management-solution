# ADR-0088: Cost figures need complete cost

- Status: Accepted
- Date: 2026-11-18

## Context

Expenses hide salary rows without `payroll:read` and dentist payouts without
`compensation:manage` (ADR-0080). A total of what the caller may see would look like the truth
while leaving those out.

## Decision

1. **Complete cost** is holding `expense:read`, `payroll:read` and `compensation:manage`.
2. _Expenses_, _Net result_, the Expenses series of _Money in and out_, _Where the money goes_
   and every share of collected are computed only with complete cost. Otherwise the API returns
   `null` for them and the SPA renders no card: never a smaller total.
3. _Expenses by category_ without complete cost lists the categories the caller's Expenses screen
   shows (its visible sources), without shares.
4. A platform admin acting in a clinic holds neither payroll nor compensation (ADR-0080), so never
   has complete cost.
5. Clinic-wide money (expenses, net result, cost shares, what the clinic owes, receivables and
   plan value) has no branch: with a branch selected the card shows _All branches only_.

## Consequences

- Nothing on the page hints that more exists for whoever lacks complete cost.
