# ADR-0033: Closing a checkout without a payment is stored on the visit

- Status: Accepted (amends 0030)
- Date: 2026-10-05

## Context

The checkout handoff (ADR-0030) stores nothing: the queue is the branch's visits of today that
still owe and on which nothing was paid. A visit therefore left the queue only by a payment, a
void, or the end of the day. A front desk user who opened a visit's checkout on the Today board
and chose **Done** without taking a payment (the patient pays later) saw the dialog close and the
card stay: nothing recorded that the desk had dealt with it.

The dentist's **Done**, in the "Visit recorded" dialog right after completion, must keep meaning
the opposite: the visit is handed to the front desk and waits in the queue.

Considered and rejected:

- **A visit status before `completed`** (`ready_for_checkout`). Rejected in ADR-0030 already: the
  charge, the counts and amend/void rely on what `completed` means (ADR-0024).
- **Keeping it in the browser.** Another desk, or a refresh, would show the card again.

## Decision

**A completed visit records when its checkout was closed without a payment.**

- `visits.checked_out_at` and `checked_out_by` (both or neither; only on a finished visit).
- `VisitsService.checkOut(id)` (`POST /visits/:id/checkout`, `payment:write`: whoever may collect)
  stamps them once on a completed or amended visit; a second call changes nothing; a live visit →
  409 `visit.not_completed`. The status and the money are untouched. Audited `visit.checkout`; no
  event, since nothing reacts to it.
- The visits list carries `checkedOutAt`, and the checkout queue leaves out a visit that has it.
- The SPA calls it from **Done** in the Today board's checkout dialog, while the visit still
  waits. `Esc` only closes the dialog. **Done** after a completion calls nothing, whoever clicks
  it: the two are told apart by where the dialog was opened, not by role.

## Consequences

- The amount stays a receivable in Visits → Unpaid and Payments → Outstanding; only the queue and
  the header count change.
- There is no undo: a visit closed by mistake is paid from the patient record or the Payments
  screen like any other receivable.
- A visit that leaves the queue because a payment was taken is not stamped, so `checked_out_at`
  is not "was checked out" in general; it is "closed unpaid".
- `clinical` checks `payment:write`, a permission of `billing`'s vocabulary, without depending on
  `billing`: permissions are one shared catalog (ADR-0010).
