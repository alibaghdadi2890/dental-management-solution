# ADR-0095: Stock is movements over batches

- Status: Accepted
- Date: 2026-11-19

## Context

"The number on the screen is the number on the shelf, and every change to it has an author and a
reason." A quantity typed over loses both; stock that is only a sum of movements is slow to read
at 100,000 movements and hard to keep from going below zero when two people take the last box.

## Decision

1. A **batch** is one received line, one opening stock entry, or a count's surplus with no batch
   to join: an item, a branch, a lot, an expiry, the quantity received, what it cost, and
   `quantity_left`.
2. A **movement** is one change by a person to one item in one branch — `receive`, `opening`,
   `take_out`, `adjust` (with a reason), `count`, `receipt_edit`, `receipt_void`, `reversal` — and
   its **batch shares** (`inventory_movement_batches`) say which batches it changed and by how much.
3. `quantity_left` is a projection: the sum of the batch's shares, written only by
   `MovementWriter` in the same transaction as the movement. A CHECK keeps it at or above zero.
   On hand is the sum over the item's batches in the branch.
4. A write that takes stock locks the item's batches in the branch (`FOR UPDATE`, in id order;
   several items in item id order), allocates from what it sees and refuses more than is there,
   so of two people taking the last box one succeeds and the other is told what is left.
5. Stock leaves the batch that expires first (no expiry last), then the oldest received, then the
   first recorded; the user may name a batch, which is used first.
6. Movements are never edited or deleted (REVOKE); a take-out may only be marked reversed.

## Consequences

- The Stock list and Today read batches, not movements: fast at the stated volumes.
- Correcting a receipt's quantity is a `receipt_edit` movement; voiding it a `receipt_void`
  movement. The movements always add up to what is on hand.
