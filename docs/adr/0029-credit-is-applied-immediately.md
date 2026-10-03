# ADR-0029: Credit is applied immediately

- Status: Accepted
- Date: 2026-10-02

## Context

The payment panel refuses over-payment, so credit (a negative balance) only arises when a
covered charge shrinks: an amendment that lowers a paid visit, or a write-off. The feature 5
prompt said credit is auto-applied to the next charge posted. When other charges are already
open, waiting for the next one would show the account as both in credit and owing.

## Decision

- Credit is the unallocated money of the account's sources. It is shown as a negative balance
  ("Credit $40").
- Settle (ADR-0027) applies it **at once** to open charges, oldest first. What is left waits and
  covers the next charge posted, in that charge's transaction. Each application is a
  `credit_applied` allocation and publishes `CreditApplied`.
- Credit and open charges in the same currency therefore never coexist.
- Only payment-sourced credit can be refunded (a refund on that payment). Credit from a write-off
  is never paid out; it only covers future charges.
- A merge settles the kept account, so one side's credit meets the other side's charges.

## Consequences

- Per-visit statuses and the balance always agree.
- An amendment on one visit can mark another visit paid; the audit trail shows the release and
  the `credit_applied` rows that did it.
