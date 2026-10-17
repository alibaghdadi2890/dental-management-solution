# Advance payments — implementation plan

Spec: `docs/superpowers/specs/2026-10-17-advance-payments-design.md` (A1–A13). No branch or commit
until the owner asks. Per task: run the affected tests and that package's typecheck. Task 10 runs
full lint, typecheck, tests and build, then one review.

Paths are under `apps/api/src/modules/` (API) or `apps/web/src/features/` (web) unless they start
with `apps/`, `packages/` or `docs/`. Integration specs are in `apps/api/test/integration/`. New
strings go to `apps/web/src/locales/{en,ar,fr}/` (`payments`, `billing`, `printables`, `clinical`)
in the task that adds them.

## 1. Contracts (A1, A2, A9, A10)

- `packages/contracts/src/payments.ts`: `ADVANCE_KINDS`, `advanceKindSchema`, `advance` on
  `paymentInputSchema` with the A9 refine. Also the preview fields and its two errors,
  `fromAdvance` on `allocationLineSchema`, `held` on `patientAccountSchema`,
  `advance`/`heldUnspent`/`releasedAt` on the history, transaction and receipt schemas, and
  `releaseHoldInputSchema`.
- `payments.spec.ts`: the refine (household, target and, for `plan`, the context visit).

Done: contracts tests and typecheck green. The API and web typechecks break only where the new
required fields are not filled yet; tasks 4–8 fill them.

## 2. Clinical reads (A3, A4, A7, A8)

- `clinical/application/visits/visit-facts.service.ts`: `planId` on `chargeFacts` lines, which
  also accept `amended`. New `planWork(patientId)`, open = an item `planned` or `in_progress`, or
  `performed` with its service on a visit not completed or amended. The estimate is the price
  snapshots of those items. Add the repository query it needs in
  `clinical/persistence/treatment-plans.repository.ts` (or the plan repository it lives in).
- Export nothing new from `clinical/index.ts` beyond the type change (the service is exported).
- Extend `clinical` integration coverage in the existing visit-facts spec: `planId`, amended
  visit, `planWork` open/closed cases (live visit with a performed item counts as open).

Done: clinical suites and API typecheck green.

## 3. Domain: settle with held money (A5)

- `billing/domain/allocate.ts`: `AllocationSource.held: boolean`, `AllocationTarget.planShare:
  bigint`. In `settle`, the new step 2 (release above held room, held pairs only, newest first)
  and step 3 (held sources first, up to held room), then the existing pass for the rest.
  `planPayment` is unchanged (a `plan` advance never calls it).
- `billing/domain/allocate.spec.ts`: the five domain cases of the spec. Existing cases keep
  passing with `held: false`, `planShare: 0n` defaults in their fixtures.

Done: domain tests green.

## 4. Schema and migration (A7, A4)

- `billing/persistence/schema.ts`: `paymentHolds`, `visitPlanShares` (columns, CHECKs, RLS
  policy, tenant index).
- `pnpm --filter @dcm/api db:generate` → `apps/api/migrations/0046_*.sql`. Review the SQL for the
  RLS policies and the grants of the runtime role (`dcm_app`): INSERT/SELECT/UPDATE on
  `payment_holds` (no DELETE), and everything on `visit_plan_shares` (a cache).

Done: the migration applies on a fresh database and on the dev database.

## 5. Persistence (A4, A5, A7)

- `billing/persistence/allocations.repository.ts`: `targetsQuery` left-joins `visit_plan_shares`
  for `planShare`. `sourcesOf` marks `held` (a payment with an active hold). `pairsOf` is
  unchanged.
- New `billing/persistence/holds.repository.ts`: `insert(paymentId)`, `activeFor(patientIds)`,
  `release(paymentIds, kind, reason)` (`WHERE released_at IS NULL`, returns the rows released),
  `heldUnspentFor(paymentIds)`.
- New `billing/persistence/plan-shares.repository.ts`: `upsert(visitId, amount, currency)`,
  and Σ the plan share still owed for a patient (for A8).

Done: API typecheck green (exercised by task 6's suite).

## 6. Application: record, settle, release (A1, A2, A5, A7, A8, A12, A13)

- `billing/application/visit-charge.subscriber.ts`: upsert the plan share from `chargeFacts`
  before the settle, in `onVisitCompleted` and in `onVisitAmended` (re-read `chargeFacts`).
- `billing/application/settlement.ts`: pass `held`/`planShare` through. After the pass, if active
  holds exist and `planWork(patientId).open` is false, release them (`plan_closed`), audit, publish
  `AdvanceReleased`, and settle again.
- New `billing/application/plan-closure.subscriber.ts`: `@OnDomainEventInTransaction` on
  `TREATMENT_CANCELLED` and `VISIT_DISCARDED`, which settles the patient's account (lock first).
- `billing/application/payments.service.ts`:
  - `preview`/`record` branch on `advance`. `credit`: skip the outstanding cap.
  - `plan`: check `planWork` (no open work → `payment.no_open_plan`) and the A8 cap. Write the
    entry, the `payments` row and the hold, then `settle` with the new source id. No `planPayment`.
  - `PaymentRecorded.advance`, and `advance` in the idempotency hash.
- New `release(paymentId, input)` in `payments.service.ts`: `payment:write`, account lock, 409
  `payment.not_held`, release `manual`, settle, audit `payment.release`, `AdvanceReleased`.
- `billing/domain/payment-errors.ts`: the three errors. `billing/events/payment-events.ts`:
  `ADVANCE_RELEASED`.
- `billing/http/billing-payments.controller.ts`: `POST /payments/:id/release`.
- `billing/application/payment-views.service.ts` and `patient-views.service.ts`: `held` on the
  account, `credit` limited to free sources, `advance`/`heldUnspent`/`releasedAt` on history,
  Transactions and receipt, `fromAdvance` on allocation lines. The visit summary
  (`visit-views.service.ts`) adds the covered-by-advance amount.
- New `billing-advance.int-spec.ts`: the spec's integration cases (write the failing cases
  first). Add the two tables and the release route to the billing tenant-isolation suite.
  Re-run the existing payments, settle, merge and visit-charge suites.

Done: billing and clinical integration suites, isolation suite and API typecheck green.

## 7. Payment panel (A1, A2, A8, A9)

- `billing/payments/payment-draft.ts`: an `advance` field (`null | 'plan' | 'credit'`), defaulting
  to `'plan'` when "Pay in advance" opens and the patient has open plan work, else `'credit'`.
  It also builds the request. `payment-draft.spec.ts`.
- `billing/payments/record-payment-dialog.tsx`: a "Pay in advance" action that switches modes,
  the hold choice ("Hold for the treatment plan" / "Keep as credit"), the "The plan still needs X"
  line from the preview, and the two errors mapped to the amount field. In advance mode the visit
  pick and household scope are hidden. `record-payment-dialog.spec.tsx`: the mode branches and the
  errors.
- Strings in `payments`.

Done: web tests and typecheck green.

## 8. Account, history, release, receipts (A7, A10)

- `billing/balance-card.tsx`: "Owes X · Paid in advance Y (treatment plan)". Free credit keeps its
  note.
- `billing/balance-tab.tsx` (history) and `billing/payments-screen/payments-page.tsx`: an
  "Advance" badge, held unspent, "Released" with its date. A "Release to credit" action with a
  reason dialog (`payment:write`; reuse the refund dialog's reason field pattern).
- `billing/payments-api.ts`: the release mutation and the cache invalidation it needs (account,
  transactions, visit balances).
- `billing/printables/receipt-document.tsx`: the "Advance payment" title and the held line.
- Visit summary and checkout (where allocation lines and the visit summary show today):
  "Covered by advance".
- Strings in `billing`, `payments`, `printables`.

Done: web tests and typecheck green.

## 9. Treatment plan (A10)

- `clinical/record/treatment-plan-tab.tsx` and `billing/printables/quote-document.tsx`, with
  `usePermission('payment:read')`: "Paid in advance" and "Still to pay" under the estimate, from the
  account read. Totals still come from `planPhases` (CLAUDE.md §13).
- `treatment-plan-tab.spec.tsx`: shown with the permission and an advance, hidden without.
- Strings in `clinical`, `printables`.

Done: web tests and typecheck green.

## 10. Docs, verification, review

- `docs/adr/0051-advance-payments-are-held-for-the-treatment-plan.md`. ADR-0029 gets a
  "Status: Amended by ADR-0051" line.
- `docs/modules/billing.md`: owned tables, settle steps, the release route, errors, events.
  `docs/modules/clinical.md`: `planWork`, `planId` on charge facts. CLAUDE.md §4 `billing` row
  (advance payments, holds) and §12 is unchanged (the payment route already requires a key).
- Playwright: extend the payments flow (spec's acceptance case).
- Full `pnpm lint`, `pnpm typecheck`, `pnpm test` (web with `--maxWorkers=2`), `pnpm build`, the
  Playwright suite. A manual pass in the app: held advance, plan visit covered, unrelated visit
  left open, cancel the last item → released, manual release, refund.
- One review over the working-tree diff.

Done: everything green; changes left uncommitted for the owner.
