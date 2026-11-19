# ADR-0097: Stock valued at cost, and late pricing

- Status: Accepted
- Date: 2026-11-19

## Context

Stock is worth what was paid for it, receipts may be saved without prices and priced later, and
stock taken out before its receipt is priced must show its cost once it is.

## Decision

1. A batch stores what its `quantity` cost (`amount`, money, null while to price) and the price as
   typed (per pack or per unit). Its unit cost is `amount / quantity`, exact; it is never stored
   rounded.
2. What `n` units of a batch are worth is `round(amount × n / quantity)` to the cent. Stock value
   is that over each batch's `quantity_left`; a movement's cost is that over each of its batch
   shares, computed when read. A batch priced later therefore costs everything it already gave
   out, wherever it is shown.
3. An unpriced batch counts for quantity and not for value. Every value carries, beside it, the
   receipts still to price and the opening batches with no cost.
4. Discount and tax and other charges change what is owed to the supplier (ADR-0098), never what
   stock is worth.

## Consequences

- Rounding is per batch and per share; a total may differ by a cent from a sum of rounded lines,
  never from the batches it reads.
