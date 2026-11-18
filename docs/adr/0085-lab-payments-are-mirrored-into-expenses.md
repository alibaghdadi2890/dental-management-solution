# ADR-0085: Lab payments are mirrored into Expenses

- Status: Accepted
- Date: 2026-11-11
- Extends: ADR-0076

## Context

The owner wants lab payments in the clinic's spending, under _Lab fees_, without typing them
twice, and wants order costs kept out of Expenses: a cost is owed, only a payment is spent.

## Decision

1. Recording a lab payment publishes `LabPaymentRecorded` (payment id, lab name, date, amount,
   currency, method, reference, note); voiding it publishes `LabPaymentVoided`, both in the
   payment's transaction.
2. `expenses` reacts in the transaction (`LabPaymentMirrorSubscriber`): a row with the new source
   **`lab`**, category `lab_fees`, payee = the lab's name. Voiding the payment voids the row with
   the same reason.
3. `lab` rows are read-only from Expenses (`expense.system_row`), visible to everyone with
   `expense:read`, counted in month totals and in Today's expenses card.
4. `lab_fees` stays a normal predefined category, still chosen by hand; the expense form says
   that payments to registered labs are recorded under Labs.
5. Opening balances, adjustments, order costs and charges never reach Expenses. Existing expenses
   are untouched.

## Consequences

- Migration 0059 recreates the `expenses_source` check and the mirror's unique index to include
  `lab`; no row changes.
