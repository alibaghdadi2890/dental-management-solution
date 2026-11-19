# ADR-0101: Inventory permissions

- Status: Accepted
- Date: 2026-11-19
- Amends: ADR-0055

## Context

Assistants take stock out and receive deliveries; costs and balances are hidden from those who
only work with stock; the owner may later create an inventory manager role without code.

## Decision

1. Five permissions in a new capability group `inventory`: `inventory:read` (_See stock_),
   `inventory:write` (_Take out and receive_), `inventory:manage` (_Manage inventory_),
   `inventory:money_read` (_See inventory money_), `inventory:money_manage` (_Manage inventory
   money_). Implications: `write ⇒ read`, `manage ⇒ write`, `money_read ⇒ read`,
   `money_manage ⇒ money_read`.
2. Defaults: owner and admin all five; assistant read, write, manage; dentist and front desk read
   and write. A platform admin holds them like any other non-payroll permission. Migration 0062
   only adds them, to system roles and templates.
3. Without `inventory:money_read` every response carries `null` for costs, values, totals and
   balances; attachments can't be opened; money routes answer 403; the Activity feed leaves out
   supplier payments and adjustments, receipt prices, opening balances and opening costs.
4. A price, a discount, charges, _Paid now_ and a one-off purchase need `inventory:money_manage`,
   checked by the receive service on what is sent.

## Consequences

- `roles.int-spec`'s older-role filter leaves out the `inventory:` prefix.
