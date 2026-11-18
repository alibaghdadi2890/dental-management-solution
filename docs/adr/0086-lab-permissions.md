# ADR-0086: Lab permissions

- Status: Accepted
- Date: 2026-11-11

## Context

Dentists, assistants and the front desk create and follow lab orders every day. Prices, costs and
what the clinic owes each lab are the owner's business. A user without access should see no
prices or balances and get a clean "no access".

## Decision

1. Four permissions in a new capability group `lab`:
   - `lab:read` (_See lab orders_): orders, labels, the Today lane, the directory without prices,
     the reports without costs;
   - `lab:manage` (_Manage lab orders_): create and edit orders and do everything to them;
   - `lab:money_read` (_See lab money_): price lists, costs, accounts, statements, report costs;
   - `lab:money_manage` (_Manage lab money_): register labs, services and prices, set costs,
     opening balances, adjustments, payments and voids.
     `lab:manage ⇒ lab:read`, `lab:money_manage ⇒ lab:money_read`, `lab:money_read ⇒ lab:read`.
2. Defaults: owner and admin hold all four; dentist, assistant and front desk hold `lab:read` and
   `lab:manage`. Migration 0059 only adds them to those system roles in every clinic and to their
   templates. A platform admin holds them like any other non-payroll permission.
3. Without `lab:money_read`, every lab response carries `null` for prices, costs and charges; the
   money routes answer 403. A non-zero cost, remake charge or cancellation charge needs
   `lab:money_manage`.
4. The audit feed hides, without `lab:money_read`, the `lab_service`, `lab_payment` and
   `lab_adjustment` rows, the `lab.opening_balance` and `lab_order.cost` actions, and the stored
   `LabPayment*` events. No other order snapshot holds a price.

## Consequences

- The front desk can cancel a sent order but can't state a charge; the owner adds it later
  through an adjustment if the lab bills it.
