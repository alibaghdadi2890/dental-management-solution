# ADR-0099: A count while work continues

- Status: Accepted
- Date: 2026-11-19

## Context

Counting a shelf takes time and the clinic does not stop meanwhile. A count that overwrites the
quantity would lose what was taken out after the line was counted, or count it twice.

## Decision

1. One open count per branch (a partial unique index). It lists the active items in scope.
2. Saving a line stamps `system_then`, the quantity on hand at that moment, next to what was
   counted. Lines are saved as the user goes; one left empty changes nothing.
3. _Apply_ turns each counted line into a `count` movement of `counted − system_then`, applied to
   the stock as it is now: a shortage leaves the batches that expire first and never more than is
   there; a surplus joins the newest batch. It runs in one transaction with an `Idempotency-Key`
   and clears _To count_ for the counted items.
4. An item that never had a batch in the branch takes its count as **opening stock**: an
   `opening` movement and batch, with the cost (with inventory money), lot and expiry typed on the
   line. Opening stock is never a receipt: no supplier, nothing owed, no expense.

## Consequences

- Example: counted 690 when the system said 700; a box of 100 leaves before Apply; Apply records
  −10 and leaves 590.
