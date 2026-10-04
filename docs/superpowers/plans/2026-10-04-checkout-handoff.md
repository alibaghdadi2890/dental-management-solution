# Checkout handoff — implementation plan

Spec: `docs/superpowers/specs/2026-10-04-checkout-handoff-design.md` (C1–C9). Branch
`feat/checkout-handoff`; the user commits at the end. Per task: run only the affected tests + that
package's typecheck. Full lint/typecheck/tests/Playwright and one branch review in task 6.

## 1. Contracts and roles

Files: `packages/contracts/src/permissions.ts` (+ spec): `visit:discount`;
`packages/contracts/src/visit-list.ts`: `checkoutDiscountInputSchema`
(`{ expectedUpdatedAt, discount, reason? }`, reusing amend's discount schema and `reasonSchema`)
and its type, exported from the index; `apps/api/src/modules/roles/domain/system-roles.ts`
(+ spec): the permission for dentist and front desk (owner has all).

Done when: contracts spec and the roles matrix spec pass; contracts and api typecheck.

## 2. Persistence

Files: `clinical/persistence/schema.ts`: `visitAmendmentKind` enum (`amendment`,
`checkout_discount`), `visit_amendments.kind` not null default `amendment`, `reason` nullable,
check `visit_amendments_reason_length` replaced by
`(kind = 'checkout_discount' and reason is null) or char_length(reason) >= 3`;
`clinical/persistence/visit-amendments.repository.ts`: `append` takes `kind` and
`reason: string | null`, `countsFor` counts `kind = 'amendment'` only;
`apps/api/migrations/0026_checkout_discount.sql`: generated with drizzle-kit, plus a hand-added
statement granting `visit:discount` to every `roles` row with `system` and key in
(`owner`, `dentist`, `frontdesk`), `on conflict do nothing`.

Done when: the migration applies on a fresh DB and over the local dev DB; an existing tenant's
front desk role holds `visit:discount`; the append-only grants of `visit_amendments` are intact.

## 3. Clinical service and route

Files: `clinical/application/visits.service.ts`: extract amend's body into one private routine
(lock patient then visit, `correct`, `assertFresh`, `planAmendment`, update, append, audit,
`VisitAmended`), parameterised by status to write, row kind, audit action and reason;
`amend` calls it unchanged in behaviour; new `setCheckoutDiscount(id, input)`: requires
`visit:discount`, passes the visit's current services untouched, keeps the status, kind
`checkout_discount`, audit `visit.discount`, refuses a visit whose `localDate` is not the
tenant's today; `clinical/domain/visit-errors.ts` (+ spec): `VisitCheckoutClosedError`
(409 `visit.checkout_closed`); `clinical/events/visit-events.ts`: `VisitAmended.reason` is
`string | null`; `clinical/http/visits.controller.ts`: `POST /visits/:id/checkout-discount`
with `@RequirePermission('visit:discount')`; `billing/application/visit-charge.subscriber.ts`:
only the doc comment (the entry's `reason` is already nullable).

Tests: `clinical/domain/visit-amendment.spec.ts`: the discount-only case if missing;
`apps/api/test/integration/visit-corrections.int-spec.ts`: one `checkout discount` block —
status kept, `checkout_discount` row, adjustment posted with a null reason, `amendmentCount` 0,
audit `visit.discount`; refused without the permission, stale, on an earlier day's visit, on a
live and on a voided visit, unchanged discount; a fully paid visit ends with credit;
`tenant-isolation-services.int-spec.ts`: tenant A cannot discount tenant B's visit.

Done when: those specs and the existing amend/void specs pass; api typecheck.

## 4. Web: checkout dialog

Files: `apps/web/src/features/clinical/dialogs/post-visit-summary-dialog.tsx` (+ spec): the
discount row's Edit → mode toggle, value, optional reason, Apply (with `visit:discount`, the
visit's day is the tenant's today, the visit owes); footer by permission and state (Record
payment / Print invoice / Pay later; Done + "Front desk will collect" without `payment:write`;
Done + Print invoice when nothing is owed); `features/clinical/visits-list/visits-list-api.ts`:
`checkoutDiscount` mutation, invalidating the visit, the summary and the queue;
`workspace/discount-control.tsx`: reuse its presentation (split the input from the live save
hook only if it can't be reused as is); `locales/{en,ar,fr}/clinical.json`.

Done when: the dialog spec covers the branching (four permission/state cases, Apply disabled when
unchanged, API error shown); web typecheck.

## 5. Web: checkout pill

Files: `apps/web/src/features/billing/checkout-pill.tsx` (+ spec): `GET
/billing/visits/unpaid?tab=all&range=today` with balances, 30 s poll and on focus, shown with
`payment:write` and a non-empty queue, menu oldest first (patient, visit number, outstanding),
selecting navigates to the patient record with `state.postVisit`; `shell/app-header.tsx`;
`features/billing/billing-api.ts`: the queue query and its key; `locales/{en,ar,fr}/shell.json`.

Done when: the pill spec covers visibility by permission, the count and the navigation; recording
a payment from the dialog removes the visit from the menu.

## 6. Docs, e2e and review

Files: `docs/adr/0030-checkout-discount-is-a-silent-same-day-amendment.md`;
`docs/modules/{clinical,billing,roles}.md`; `CLAUDE.md` §4 `clinical` row; the spec's status and
implementation notes; `apps/web/e2e/checkout.spec.ts`: a dentist completes and closes, front desk
opens the pill, applies a discount, records the payment, the pill disappears.

Done when: lint, typecheck, API tests, web tests (`--maxWorkers=2`) and Playwright pass; one
code review over the branch, findings fixed.
