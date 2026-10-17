# Advance payments — design

Date: 2026-10-17. Module: `billing` (plus two reads from `clinical`). ADR-0051, which amends
ADR-0029.

## Why

A patient often takes their treatment plan and pays part or all of it before the work is done.
Plan work is charged only when it is done (ADR-0032), so there is nothing to pay yet, and today the
payment panel refuses any amount above what is owed (`payment.over_outstanding`). The money is a
deposit: the clinic owes the patient the work or the money back. It must show as held for the plan,
cover the plan's charges as they post, and not be eaten by unrelated charges.

## Decisions

- **A1 — An advance is an ordinary payment.** Same receipt sequence, method, ledger entry
  (`payment`, negative) and `payments` row. The balance stays Σ ledger (ADR-0027). An advance is
  made explicitly: `advance` on the payment input. Without it the outstanding cap is unchanged, so
  paying too much by mistake is still refused.
- **A2 — Two kinds of advance.**
  - `plan`: **held for the treatment plan** (the default in the panel when the patient has open plan
    work). The whole payment is held; a held payment is never split into a held part and a free
    part.
  - `credit`: a plain advance. It allocates like any payment (what is owed first, oldest first) and
    the rest stays as credit (ADR-0029, unchanged).
- **A3 — What "the plan" is.** The patient's treatment plan as a whole: every plan item of the
  patient, whatever its priority, including items added after the payment. Held money covers only
  the part of a charge that comes from plan items, and nothing else.
- **A4 — A visit's plan share.** For each charged visit, `billing` stores the sum of the final line
  amounts (base − line discount) of the visit's services that perform a plan item
  (`visit_services.plan_id` is set). It is written when the visit is completed and rewritten when
  it is amended (the checkout discount included, ADR-0030). Held money may cover at most
  `min(plan share, max(net, 0))` of a visit. A visit-level discount therefore counts against the
  rest of the visit's lines first. Opening balances and adjustments have a plan share of 0.
- **A5 — Settle, extended (`domain/allocate.ts`).**
  1. As today: release what a target holds above `max(net, 0)`, and what a source holds above its
     capacity.
  2. New: release what **held** sources hold on a target above its held room
     (`min(plan share, max(net, 0))`), newest first. This happens after an amendment removes or
     cheapens a plan service.
  3. New: held sources, oldest first, cover targets with held room, oldest first, each up to
     `min(outstanding, held room left)`.
  4. As today: the other sources, oldest first, cover any open target, oldest first.

  Held money is used before free credit on plan charges, so free credit stays available for the
  rest.
- **A6 — ADR-0029, amended.** Free credit and open charges still never coexist. Held money may sit
  beside open charges that are not plan work.
- **A7 — When a hold ends.** A hold is stored (`payment_holds`), and once it ends it never comes
  back.
  - **Plan closed:** settle checks, after step 3, whether the patient has any active hold and no
    open plan work left (no item `planned` or `in_progress`, and none performed on a visit that is
    not completed yet). If so, it ends every active hold (`plan_closed`), then settles again, so
    the money left over covers other open charges or stays as free credit. Settle runs on every
    ledger write. `billing` also settles in-transaction on `TreatmentCancelled` and `VisitDiscarded`,
    which can close the plan without a ledger write.
  - **By hand:** "Release to credit" on a held payment, with a reason (`payment:write`). The rest
    of it becomes free credit at once.
  - Refunds and voids need no special case. The rest of a held payment is always refundable
    (policy: no part of an advance is kept). A refund takes the unspent part first (`refundReleases`
    already releases unallocated money first). A void sets the capacity to 0.
- **A8 — Cap on a held advance.** Amount ≤ what the plan still needs = the open plan estimate (the
  price snapshots of the items still to charge, in the tenant currency) + the plan share still
  owed on charged visits − the held money not yet spent. Otherwise 422
  `payment.over_plan_remaining`. A patient with no open plan work cannot make a `plan` advance
  (422 `payment.no_open_plan`). A `credit` advance has no cap beyond a positive amount.
- **A9 — Scope.** An advance pays this patient only: `scope = patient`, with no `targetEntryId`. A
  `plan` advance also has no `contextVisitId` (refine, path `advance`). Household payments are
  unchanged.
- **A10 — How it is shown.**
  - Account (`GET /billing/patients/:id/account`): `held` (held money not yet spent) beside
    `credit`, which now means free credit only. `balance` stays Σ ledger. The balance card shows
    "Owes 50.00 · Paid in advance 1,000.00 (treatment plan)" instead of one netted number.
  - History, Transactions, receipt: a payment carries `advance: 'plan' | 'credit' | null` and, for a
    held one, `heldUnspent` and `releasedAt`. The receipt title says "Advance payment". A held
    receipt adds "Held for the treatment plan".
  - Allocation lines carry `fromAdvance: boolean` (the source is a held payment). The visit summary
    and the checkout show "Covered by advance".
  - Treatment plan (the record's Plan tab and the printed quote), for users with `payment:read`:
    "Paid in advance" (`held`) and "Still to pay" = max(open plan estimate − held, 0). The SPA puts
    the account read and the chart read together. `clinical` does not read `billing`.
- **A11 — Unchanged by policy.**
  - An upfront-payment discount is the checkout discount (ADR-0030) on the charge, never a smaller
    payment. Nothing new to build.
  - Plan prices are snapshots, so the hold follows the items that are left. Nothing new to build.
  - Tax is out of scope.
- **A12 — Events and audit.** `PaymentRecorded` gains `advance`. New `AdvanceReleased { paymentId,
  patientId, currency, amount, kind: 'plan_closed' | 'manual' }`. Audit `payment.release` (reason
  for `manual`; `after.kind`), area `billing`, about the patient. Held money covering a charge is an
  `allocation` (new payment) or `credit_applied` row as today; `CreditApplied` still fires.
- **A13 — Merge.** Holds are keyed by payment, so they follow the re-pointed payments. The kept
  account's settle (ADR-0036) applies A5 and A7 to the merged plan.

## Contracts

- `payments.ts`: `ADVANCE_KINDS = ['plan', 'credit']`, `advanceKindSchema`.
  - `paymentInputSchema` gains `advance: advanceKindSchema.optional()` and the A9 refine.
  - `paymentPreviewSchema` gains `advance`, `held` (what this payment would hold),
    `planRemaining` (the A8 cap, null unless `plan`). `error` gains `payment.over_plan_remaining`
    and `payment.no_open_plan`.
  - `allocationLineSchema` gains `fromAdvance`.
  - `patientAccountSchema` gains `held`.
  - `paymentHistoryItemSchema`, `transactionSchema`, `receiptSchema` gain `advance`, `heldUnspent`,
    `releasedAt`.
  - `releaseHoldInputSchema = { reason }`.
- Route: `POST /billing/payments/:id/release` → `paymentWriteResultSchema`, `@RequirePermission(
  'payment:write')`.
- `clinical` (`VisitFactsService`, `visit:read`, which every system role holds):
  - `chargeFacts` lines gain `planId`, and it also answers for an `amended` visit.
  - New `planWork(patientId) → { open: boolean, estimate: string, currency }`.

## Schema (migration 0046)

- `payment_holds` (tenant RLS): `payment_id` (PK with `tenant_id`, FK to `payments`), `released_at
  timestamptz null`, `released_kind text null` (`plan_closed` | `manual`), `released_by uuid null`,
  `release_reason text null`, timestamps. CHECK: the three release columns are all null or all
  set (`release_reason` only for `manual`). It is written once at record. The only update allowed
  is the release, while `released_at` is null (repository plus `WHERE released_at IS NULL`).
- `visit_plan_shares` (tenant RLS): `visit_id` (PK with `tenant_id`), `amount numeric(12,2) >= 0`,
  `currency`, timestamps. A derived cache row: upserted, never read for history.

## Errors

| Code                              | HTTP | When                                                     |
|-----------------------------------|------|----------------------------------------------------------|
| `payment.over_plan_remaining`     | 422  | A `plan` advance above what the plan still needs (A8)   |
| `payment.no_open_plan`            | 422  | A `plan` advance with no open plan work                  |
| `payment.not_held`                | 409  | Release of a payment that is not held, or already released |
| validation (`advance`)            | 400  | Advance with household scope, a target, or (plan) a context visit |

## Tests

- Domain (`allocate.spec.ts`): held covers only plan share; held before free; release above held
  room after an amendment; free credit never touches what held money reserved; a refund takes the
  unspent held money first.
- Integration (`billing-advance.int-spec.ts`): both kinds of advance and the caps; a plan visit
  covered at completion; a non-plan visit left open beside held money; the last plan item done →
  the rest is released and covers the open charge; the last item cancelled → the same; a manual
  release; a refund and a void of a held payment; an amendment removing a plan service; the
  idempotent replay; a merge.
- Tenant isolation: both new tables and the release route.
- Playwright: the payments flow records a held advance, completes a plan visit, sees it "Covered
  by advance".
- SPA: the panel's advance mode (draft and dialog branches), the balance card breakdown.

## Implementation notes

What changed while building, against the decisions above:

- **`payments.advance`** (`plan` | `credit`, nullable) is stored on the payment. A `credit`
  advance otherwise leaves no trace, and history, Transactions and receipts need to say "Advance".
  It is also compared on an idempotent replay.
- **`TreatmentRemoved`**, a new `clinical` event, is published when a plan still `planned` is
  removed (in its visit, or on the record). Removing the last item on the record otherwise ended
  plan work with no event and no ledger write, so the hold would have stayed until the next one.
  `billing` settles on it with the other closing events.
- **The account carries `planRemaining`** (the A8 cap, null without plan work), so the payment
  panel checks the amount as it is typed, with no preview round-trip. The cap formula is one
  domain function, `planRemaining`, used by the account and by `record`.
- **The visit summary** leaves held money out of `totalOutstanding` and `previous`, reports it as
  `held`, and marks each payment `fromAdvance`. Without that, the checkout would show a patient
  holding $1,000 and owing $50 as being $950 in credit.
- The preview's `held` is 0 when it reports an error.
- Review fixes:
  - `planWork` checks no permission (like `paidOn`), because settle and the account read call
    it whatever the caller holds.
  - The merge re-point settles with `closeHolds: false`, because `clinical`'s handler may move the
    dropped patient's plans after it. The next settle closes holds if the plan really is done.
  - The plan-closure handlers take the account lock before looking for holds, so they don't race
    a plan advance being recorded.
  - A voided or fully refunded held payment no longer counts as an active hold, so there is nothing
    to release and no zero-amount release is audited.
  - Migration 0046 backfills the plan shares of visits charged before it.
  - "Still to pay" on the plan tab and the quote is `planRemaining`, the same figure the panel
    caps at.
  - The balance card reads `held` from the visit summary, and loads the account only when the
    patient has no visit.
