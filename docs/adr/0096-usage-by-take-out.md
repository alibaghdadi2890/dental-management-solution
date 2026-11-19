# ADR-0096: Usage is recorded by taking stock out

- Status: Accepted
- Date: 2026-11-19

## Context

The owner decided that usage is recorded by taking stock out, not deducted from a visit's
services, and that any assistant may take stock out. A wrong tap must be easy to undo, and a
later correction must leave a trace.

## Decision

1. A take-out is one or several items, each a `take_out` movement, in one request with an
   `Idempotency-Key`. A row of the Stock list takes one pack (or one unit) with one more tap.
2. Its author may **undo** it the same clinic day (`inventory:write`); later, someone with
   `inventory:manage` **reverses** it with a reason. Either writes a `reversal` movement that puts
   the units back into the batches the take-out left and marks the take-out reversed, once (a
   unique index on `reverses_id`).
3. More than is on hand is refused with what the system has (409 `inventory.not_enough_stock`);
   from there _Report wrong count_ marks the item _To count_. Taking from a batch past its expiry
   is refused with 409 `inventory.expired_batch` until the request says `allowExpired`.
4. Only take-outs are reversed; a wrong adjustment is corrected by a _Correction_.

## Consequences

- Consumption is take-outs net of their reversals, by the day each happened.
