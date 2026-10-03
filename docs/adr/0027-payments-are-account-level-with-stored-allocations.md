# ADR-0027: Payments are account-level, with stored derived allocations

- Status: Accepted
- Date: 2026-10-02

## Context

Feature 5 adds payments. A patient owing $1,000 across four visits may pay $500, and the clinic
must still see which visits are paid (the Visits list, the post-visit summary), how old the
unpaid money is (aging) and what a receipt covered. A payment tied to one visit would force the
person at the desk to split money by hand and would break when a visit is amended or voided after
it was paid. The balance must stay a single number derived from the ledger (feature 3, design
Q13).

## Decision

**A payment is a transaction on the patient's account; allocations explain it.**

- Every payment, refund and void posts a ledger entry (`payment` negative, `payment_refund` and
  `payment_void` positive) beside its `payments` row. The balance stays `Σ ledger_entries`.
- **Targets** are what can be paid: an `opening_balance` or `adjustment` above zero, and each
  visit (its `visit_charge`, netted with the visit's corrections). **Sources** are what pays: a
  `payment`, or a credit entry (an `adjustment` or `opening_balance` below zero — a write-off).
- `payment_allocations` rows link a source entry to a target entry. They are append-only and
  signed: a release is a negative row, and a pair's allocation is the sum of its rows. Rows carry
  a kind (`allocation`, `credit_applied`, `release`) and a `manual` flag.
- A payment allocates: the chosen charge (B4, at most its outstanding), then the visit it was
  opened from, then open targets oldest first by charge date (the opening balance counting as
  the oldest). The pure rules live in `billing/domain/allocate.ts`.
- One routine, **settle**, runs in the transaction of every ledger write (opening balance,
  adjustment, visit charge and corrections, payment, refund, void, merge re-point), under a
  per-account advisory lock. It releases what a target holds above its net (amended down,
  voided) and what a source holds above its capacity (voided), newest allocation first, then
  applies every source's free money to open targets oldest first.
- Allocation never limits what can be paid: the only cap is the account's outstanding.
- `paidOn(visitId)` — the void veto of ADR-0026 — counts payment-sourced allocations only.

## Consequences

- Per-visit Paid/Unpaid, aging and receipts read stored facts instead of re-deriving history, and
  the invariant `Σ target outstanding − Σ source unallocated = balance` holds after every write.
- Every ledger writer must call settle; a new kind of entry must decide whether it is a target, a
  source or neither.
- A refund releases the payment's unallocated money first, then its allocations proportionally;
  rounding is by largest remainder.
- Merges move payments with their patient; allocations follow their entries unchanged.
