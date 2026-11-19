# ADR-0098: A receipt is owed; only a payment is an expense

- Status: Accepted
- Date: 2026-11-19
- Extends: ADR-0076, ADR-0085

## Context

Supply money must be counted once: a delivery is what the clinic owes its supplier, and only a
payment is spent. The _Dental supplies & materials_ category stays open by hand.

## Decision

1. A supplier's account is computed: opening balance + each priced live receipt's total (lines −
   discount + tax and other charges) from its date received + charges − credits − live payments.
   A receipt with a line to price is not owed yet and is listed apart.
2. Payments go to the account, never to a receipt. `SupplierPaymentRecorded` and
   `SupplierPaymentVoided` are published in the payment's transaction; `expenses` writes or voids
   a read-only row with the new source **`supplier`**, category `supplies`, payee = the supplier's
   name, in the same transaction.
3. A **one-off purchase** is a receipt with a typed payee and no supplier: priced and paid when it
   is recorded (`inventory:money_manage`). Its payment is a supplier payment with no supplier, so
   it is mirrored the same way; voiding the receipt voids it.
4. A manual expense recorded or edited into `supplies` that resembles a live `supplier` row (the
   same payee, case and spaces ignored, or the same amount within three days either side) is
   refused with 409 `expense.resembles_supplier_payment` until sent again with
   `allowResemblance`. It is answered from `expenses`' own rows; `expenses` does not read
   inventory.
5. Opening balances, adjustments, receipts and stock movements never reach Expenses.

## Consequences

- Migration 0062 recreates the `expenses_source` check and the mirror's unique index with
  `supplier`; no row changes. Expenses, Net result and complete cost need no change: supplier
  payments are already inside Expenses.
