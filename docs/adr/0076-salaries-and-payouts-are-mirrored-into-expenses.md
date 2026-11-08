# ADR-0076: Expenses and payroll are two modules; salaries and payouts are mirrored into expenses

- Status: Accepted
- Date: 2026-11-06

## Context

Feature 17 adds what the clinic spends (expenses) and pays its non-dentist staff (payroll). The
owner wants total spending to be complete: a confirmed salary and a dentist payout must appear in
Expenses. They must never be counted twice and never be typed by hand. Payroll is more sensitive
than rent, so the two have separate permissions (ADR-0080). Compensation already exists and must
not change how it computes anything.

## Decision

1. There are two new modules. `expenses` owns `expense_categories`, `expenses`, `fixed_expenses`
   and `fixed_expense_items`. `payroll` owns `employees`, `employee_salaries`, `payroll_lines`,
   `payroll_adjustments` and `payroll_payments`.
2. **Mirrors through events, in the transaction.** Confirming a payroll line publishes
   `PayrollPaymentConfirmed`. `compensation` already publishes `PayoutRecorded`. `expenses`
   subscribes to both with `@OnDomainEventInTransaction` and writes a read-only row in the
   reserved category (_Salaries_ or _Dentist compensation_). The voiding events
   (`PayrollPaymentVoided`, `PayoutVoided`) void the row with the same reason.
   - `PayoutRecorded` and `PayoutVoided` gain the facts the mirror needs: amount, currency, method,
     reference and the void reason.
   - So `expenses` depends on `payroll` and `compensation` for their events, and neither depends on
     `expenses`.
3. A mirror carries `source = payroll | compensation` and `source_id` = the payment or payout id,
   unique per source. `expenses` refuses to edit or void it (409 `expense.system_row`). Correcting
   it is done where it came from.
4. A mirror is not audited a second time: the payroll confirmation or the payout is the audit
   record.
5. Migration 0058 back-fills one row per existing payout, voided payouts as voided. It is a
   one-off SQL read across modules, run as the schema owner; at runtime `expenses` only learns of
   payouts from events.
6. No queue and no job (Redis is not to be added).

## Consequences

- Total spending is one list. Who sees a mirrored row follows its permission (ADR-0080).
- A failure writing the mirror rolls the payment back, so the two never drift apart.
- A later source of spending (e.g. inventory purchases) mirrors the same way, without a new
  dependency from `expenses` into it beyond its events.
