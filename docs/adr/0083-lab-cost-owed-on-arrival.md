# ADR-0083: A lab order's cost is owed from its first arrival; the account is computed

- Status: Accepted
- Date: 2026-11-11

## Context

The clinic owes a lab for work it received, not for work it ordered. The lab's invoice may differ
from the price list, prices change over time, and some clinics start recording while they already
owe their labs. Lab money must be counted once: only a payment is an expense.

## Decision

1. An order's **cost** is the estimate (Σ price × quantity of its priced items, prices snapshot
   when ordered) until someone with `lab:money_manage` sets it; from then on it is kept
   (`cost_set_by_hand`). Editing the items recalculates an estimate, never a hand-set cost.
2. The cost is **owed from `first_received_on`**, the day the work first arrived. Undoing that
   arrival clears it.
3. The **account** of a lab is never stored. It is computed from: the opening balance (amount and
   date), the delivered orders at their cost, clinic-borne remake charges (on the day of the
   remake), cancellation charges, adjustments (a charge adds, a credit subtracts) and live
   payments. `outstanding = owed − paid`; it may be negative.
4. **In progress:** orders with a trip and no first arrival, not cancelled, at their estimated
   cost; not part of the outstanding amount.
5. **Cancelling:** free before any trip. Work sent and never delivered may still be charged
   (default 0), owed on the cancel date. After a first arrival the delivered cost stays owed and
   nothing more is asked.
6. The opening balance is a replace (`PUT`), so a retry never duplicates. Payments and
   adjustments take an `Idempotency-Key`. A payment is voided with a reason, never deleted; an
   adjustment is append-only (a wrong one is corrected by its opposite).

## Consequences

- A cost edited after delivery changes the balance in the past; the audit keeps the before and
  after (`lab_order.cost`).
- The statement for a period is the balance before it, then each movement with a running balance.
