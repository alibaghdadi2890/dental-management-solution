# ADR-0051: An advance payment is held for the treatment plan

- Status: Accepted (amends 0029)
- Date: 2026-10-17

## Context

A patient often takes their treatment plan and pays part or all of it before the work is done.
Plan work is charged only when it is done (ADR-0032), so at the time of payment nothing is owed,
and the payment panel refused any amount above the outstanding (`payment.over_outstanding`).

The money is a deposit: the clinic owes the patient the work or the money back. Plain credit
(ADR-0029) would not do: it covers the oldest open charge at once, so an advance paid for an
implant would quietly pay an unrelated cleaning, and the implant would later look short. Design:
`docs/superpowers/specs/2026-10-17-advance-payments-design.md` (A1–A13).

## Decision

1. **An advance is an ordinary payment**: same receipt sequence, ledger entry and `payments` row,
   so the balance stays Σ ledger (ADR-0027). It is made explicitly (`advance` on the payment
   input, stored on the row). Without it the outstanding cap is unchanged.
2. **Two kinds.** `plan`: the whole payment is **held for the treatment plan**. `credit`: a plain
   advance; it allocates like any payment and the rest is credit (ADR-0029). A held payment is
   never split into held and free parts: a refund would not know which part it takes.
3. **"The plan" is the patient's whole treatment plan**: every plan item, whatever its priority,
   items added later included. Held money covers only the part of a charge that comes from plan
   items: a visit's **plan share** (Σ the final amounts of its lines that perform a plan item),
   stored by `billing` at completion and at each amendment (`visit_plan_shares`, a cache). A visit
   lets held money cover `min(plan share, max(net, 0))`, all held payments together.
4. **Settle, extended.** After the existing releases, held allocations above that room are
   released (an amendment took a plan service off); then held payments, oldest first, cover plan
   charges, before free credit, which then covers the rest as before.
5. **A hold ends once and for all** (`payment_holds`, release columns set once):
   - **the plan closed**: settle, when the patient holds money and has no plan work left to charge
     (no item planned or in progress, none performed on a visit still live), ends every hold and
     settles again. Plan work can end without a ledger write, so `billing` also settles on
     `TreatmentCancelled`, `TreatmentRemoved` (new), `VisitDiscarded` and a `VisitCompleted` at no
     charge, in their transactions;
   - **by hand**: `POST /billing/payments/:id/release` with a reason (`payment:write`).
     What the payment still held becomes free credit at once. Audited `payment.release`;
     `AdvanceReleased`.
6. **Always refundable.** A refund takes the unspent part first and a void cancels it; neither
   needs a case of its own. No part of an advance is kept by policy.
7. **A cap on a held advance**: what the plan still needs = the open plan estimate + its charges
   still owed − held money not spent (`payment.over_plan_remaining`); none without plan work
   (`payment.no_open_plan`). A `credit` advance has no cap. Advances pay this patient only.
8. **Shown as what it is.** The account has `held` beside `credit` (free credit only); the visit
   summary leaves held money out of the total outstanding and reports it; history, Transactions
   and receipts say "Advance"; allocation lines and visit payments carry `fromAdvance`; the plan
   tab and the quote show "Paid in advance" and "Still to pay" to `payment:read`.

## Consequences

- ADR-0029 is amended: **free** credit and open charges still never coexist; held money may sit
  beside open charges that are not plan work.
- `clinical` gains two reads for `billing` (`chargeFacts` lines carry `planId`, and it answers
  for an amended visit; `planWork(patientId, currency)`) and one event (`TreatmentRemoved`). No
  new dependency edge: `billing` already depended on `clinical`.
- The patients list and the patient balance stay Σ ledger, so a patient holding $1,000 who owes
  $50 shows −$950 there; the balance card, the checkout and the account split it.
- A discount at checkout counts against the visit's other lines first (the held room is capped by
  the net). An upfront-payment discount is that checkout discount, never a smaller payment.
- Migration 0046: `payments.advance`, `payment_holds` (the runtime role may update only the
  release columns, and delete nothing) and `visit_plan_shares`, backfilled for the visits charged
  before it.
- The merge re-point never ends a hold (`clinical` may move the plans after it); the next settle
  of the kept account does.
