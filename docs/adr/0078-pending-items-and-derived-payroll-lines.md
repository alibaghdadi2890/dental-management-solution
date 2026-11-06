# ADR-0078: Fixed expenses wait as items made when the clinic next looks; payroll lines are derived

- Status: Accepted
- Date: 2026-11-06

## Context

On the first day of each month (clinic time zone), every active fixed expense should wait for
confirmation, and every employee should have a pending payroll line. Nothing may confirm itself,
and unconfirmed months stay pending until someone handles them. The project runs no job
scheduler and adds no Redis.

## Decision

1. **Fixed expenses: a catch-up, not a job.** Every expenses read or write that shows waiting
   months first runs a catch-up.
   - The catch-up gives each *active* template one item per month, from its `next_month` through
     the current month in the clinic's time zone, then moves `next_month` past it.
   - It runs under an advisory lock per clinic, and `(fixed_expense_id, month)` is unique, so it is
     idempotent.
   - For the clinic, "on the 1st" and "the first time anyone looks that month" are the same.
2. An item **snapshots** the template: name, category, amount, method, payee and branch. A later
   edit of the template changes only months generated after it.
3. A paused template generates nothing. **Resume** moves `next_month` to the current month at the
   latest, so the paused months are skipped. **End** is final. Items already made stay pending
   whatever the template's state.
4. Confirming an item creates a normal `fixed` expense (`source_id` = the item). Voiding that
   expense puts the item back to pending. A skip closes an item, and an undo reopens it.
5. **Payroll lines are derived, not made.**
   - A line exists for every month an employee is employed: from `max(hire month, payroll_from)` to
     their end month, at most the current month.
   - A row is stored only when someone adjusts, skips or pays the line.
   - A pending line reads its base from the salary in force (ADR-0079). A back-dated salary, or an
     end date set later, therefore moves the pending lines with it.
   - A paid line shows what was paid: its payment stores the base, the adjustments and the net.

## Consequences

- No timer, no queue, no cross-tenant sweep. An item appears the first time the clinic looks after
  the 1st, never earlier, and the one item per month is guaranteed by the unique index.
- A read (`GET`) may insert items. That is deliberate and harmless: the inserts are idempotent and
  inside the request's tenant transaction.
- Lines carry no stale copies: removing an employee created by mistake, or changing their dates,
  leaves nothing to clean up.
