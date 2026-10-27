# ADR-0059: A dentist's statement is derived for open months and frozen on close

- Status: Accepted
- Date: 2026-10-25

## Context

A dentist's monthly statement must be explainable line by line from the ledger that already
exists (visit charges, adjustments, reversals, payment allocations). A closed month must never
change. Corrections made later — an amendment, a void, a refund, a visit completed after the
close — still have to reach the dentist.

## Decision

1. **Derived, then frozen.** An open month is computed on every read by a pure function
   (`compensation/domain/compute.ts`). It reads `billing`'s and `clinical`'s building blocks; no
   compensation ledger is stored. Closing a month writes `compensation_periods.snapshot` (every
   line, the totals, the report's figures) and `line_ids` (every line id it counted). A closed
   month is read from its snapshot, never recomputed.
2. **Lines have identities.** Each line is identified by what it comes from:
   - a ledger entry (production);
   - a payment-sourced allocation row (collection);
   - `visit:<id>` and `day:<date>` (per visit, per day), with `:void` reversals;
   - `fixed:<agreement>:<month>`;
   - `threshold:<agreement>:<month>`.

   Each line also has its own month: the entry's effective date, the allocation's local
   creation date, or the visit's date. Its rate is that of the agreement in force on the visit's
   date.

3. **Months close in order.** A dentist's first month is that of their earliest agreement,
   adjustment or payout. Closing month M needs M−1 closed, unless M is the first month. A month
   closes only after it has ended. Only the last closed month may reopen, with a reason. Closed
   months are therefore always a prefix of the dentist's months.
4. **Late entries by id.** A line is late when its own month is closed and no snapshot counted
   its id. It is reported in the first open month, under "Late entries from {month}", with its
   own date. That month's snapshot then counts it. We do not compare `created_at` with
   `closed_at`: a payment that commits just after a close, with a `created_at` before it, would
   be lost. Reopening a month moves its late lines back where they belong.
5. **Per visit and per day corrections.** A visit counted in a closed month and voided later is
   taken back by a `visit:<id>:void` line. A counted day that lost its last visit is taken back
   by `day:<date>:void`. A visit completed after its month closed is paid as a late entry.
   - **Generations.** A visit or day that counts again after being taken back is paid again as
     `visit:<id>:2` (then `:2:void`, `:3`, and so on, up to five times).
   - Imported visits are never charged (ADR-0053) and earn nothing.
6. **Arithmetic.** Bigint cents and exact rationals. Each line is rounded half away from zero,
   and totals are the sum of the rounded lines.
   - **Rates by service.** The charge's lines are pro-rated to its net amount, each takes its
     code's, else its category's, else the default percent. The visit's blended rate then
     applies to its adjustments, its reversal and its collections. An amendment adds no lines,
     so it does not re-blend.
   - **Threshold.** It applies per statement month and per agreement, late lines included:
     share × max(0, base − threshold) / base. It is shown as one "Below minimum base" line.
     A month whose base is zero or less holds only corrections (voids, refunds): they claw back
     in full, with no threshold line.
   - **Fixed amount.** It is pro-rated by the days each agreement covers. Without pro-rating,
     the month's last agreement with a fixed amount pays it once, in full.
7. Adjustments and payouts are append-only and voided with a reason. They and agreement dates
   are refused inside a closed month (`compensation.period_closed`). Writes for one dentist run
   one at a time, under an advisory lock on them.

## Consequences

- A statement and its report are computed per request, bounded by one dentist's or one
  clinic's month. There are no jobs and no caching (C12).
- The opening balance of an open month chains from the last closed snapshot, through the open
  months before it.
