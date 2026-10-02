# ADR-0026: Billing vetoes a void inside the transaction

- Status: Accepted
- Date: 2026-10-01

## Context

Voiding a visit that has payments allocated to it would leave money attached to a charge that no
longer exists. Feature 4b decided (D19) that such a visit can't be voided until the payments are
refunded or moved. The visit lives in `clinical` and payments will live in `billing` (feature 5).
`billing` already depends on `clinical` (ADR-0024), so `clinical` cannot ask `billing` before
voiding without creating a dependency cycle (CLAUDE.md §4 rule 4).

## Decision

**`billing` refuses the void from its in-transaction reaction.**

- `VisitsService.void` sets the visit `voided` and publishes `VisitVoided` inside its
  transaction.
- `billing`'s `@OnDomainEventInTransaction(VISIT_VOIDED)` handler first checks
  `BillingService.paidOn(visitId)`. Above zero, it throws `VisitHasPaymentsError` (409
  `visit.has_payments`). The throw rolls the whole void back, and the caller gets the error.
- Otherwise it posts the reversal (ADR-0025).
- The SPA reads the visit's paid amount first and shows "Refund payments first" instead of the
  void dialog, so the veto is the server's guarantee, not the normal path.
- Until feature 5, `paidOn` is always zero, so the veto never fires. Feature 5 implements
  `paidOn` from its allocations and the rule applies with no change to `clinical`.

## Consequences

- No new dependency edge: `clinical` still knows nothing of `billing`.
- An in-transaction handler may now refuse the change that published its event, not only add to
  it. Such a refusal must be a `DomainError`, so the caller gets a stable code rather than a 500.
- `paidOn` checks no permission: it runs inside a void the caller was allowed to make.
  `balancesForVisits` is the gated read.
