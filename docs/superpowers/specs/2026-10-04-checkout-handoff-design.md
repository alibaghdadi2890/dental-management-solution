# Checkout handoff — front desk collects and discounts — design

Date: 2026-10-04 · Status: Implemented (2026-10-04); see §Implementation notes

## Goal

Whoever completes a visit can hand the money side to someone else without an extra step. The
front desk sees today's visits that still owe, opens the same checkout dialog the completer saw,
sets or changes the visit discount if allowed, and records the payment. What each person can do
in that dialog comes from their permissions, never from their role.

Completion is unchanged: it still freezes the money and posts the charge in its transaction
(ADR-0024). There is no new visit status.

Owner modules: `clinical` (the checkout discount), `roles` and `contracts` (the permission), the
SPA (queue pill and dialog). `billing` is unchanged apart from accepting an adjustment without a
reason. No new dependency edge.

**Out of scope:** a discount cap per role, a "deferred / pay later" flag that removes a visit from
the queue, push or websocket updates, a role-editing screen, changing who may discount a live
visit (`visit:write`, as today), the "Request a change" workflow.

## Decisions

| #   | Topic             | Decision                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Handoff           | Implicit. A visit is "to collect" when it is `completed` or `amended`, its `local_date` is the tenant's today, it belongs to the session branch and its outstanding is above 0. Derived from `GET /billing/visits/unpaid?range=today`; no state, no table. It leaves the queue when paid, voided, or the day ends (it stays in Visits → Unpaid and Payments → Outstanding). |
| C2  | Permission        | New `visit:discount`: set the visit discount of a completed visit at checkout. Seeded for owner, dentist, front desk; not assistant. The migration grants it to those system roles in every existing tenant.                                                                                                                                                                |
| C3  | Checkout discount | A discount-only change of a completed or amended visit. Same mechanics as amend (ADR-0025): locks patient then visit, refuses a stale `expectedUpdatedAt` (409 `visit.stale`), recomputes and refreezes the money, appends a `visit_amendments` row, publishes `VisitAmended` in the transaction so `billing` posts the delta. Services are never touched.                  |
| C4  | Silent            | The status does not change (`completed` stays `completed`). The reason is optional. The row is `kind = 'checkout_discount'` and does not count in `amendmentCount`, so no "Amended" pill or count. Audited as `visit.discount` with before/after, so the audit trail still shows who changed it and by how much.                                                            |
| C5  | Same day only     | Allowed only while the visit's `local_date` is the tenant's today; later → 409 `visit.checkout_closed`. After that day a discount change is an amendment (`visit:amend`, reason required). This bounds what the silent path can do.                                                                                                                                         |
| C6  | No change         | The same mode and value → 422 `visit.amend_no_change` (existing error); the SPA disables Apply instead.                                                                                                                                                                                                                                                                     |
| C7  | Paid visits       | The service does not refuse a discount on a visit with payments: the negative delta becomes credit through the existing settle. The SPA offers the edit only while the visit owes.                                                                                                                                                                                          |
| C8  | Queue visibility  | The header pill shows for holders of `payment:write` (owner, dentist, front desk), polled every 30 s and on focus, like the live-visit pill. Hidden when the queue is empty.                                                                                                                                                                                                |
| C9  | One dialog        | The post-visit summary becomes the checkout dialog, used both right after completion and from the queue (same `postVisit` history state on the patient record).                                                                                                                                                                                                             |

## Data model (migration 0026)

- `visit_amendments.kind`: enum `visit_amendment_kind` (`amendment`, `checkout_discount`), not
  null, default `amendment`.
- `visit_amendments.reason` becomes nullable; the check becomes
  `kind = 'checkout_discount' and reason is null or char_length(reason) >= 3`.
- Grants: insert `visit:discount` into `role_permissions` for every system role with key `owner`,
  `dentist` or `frontdesk` (`on conflict do nothing`).

## Contracts

- `permissions.ts`: `visit:discount`.
- `checkoutDiscountInputSchema`: `{ expectedUpdatedAt, discount: { mode, value }, reason? }`
  (reason 3–500 characters when given; the discount schema is amend's).
- `VisitAmended.reason` becomes `string | null`.

## API

`POST /visits/:id/checkout-discount` (`visit:discount`) → `{ visit }`.

`VisitsService.setCheckoutDiscount(id, input)` re-checks `visit:discount`. It shares one private
routine with `amend` (lock, freshness, `planAmendment`, update, append, event); the two differ in
the permission, the status they write, the row kind, the audit action and the C5 date rule.
`planAmendment` is called with the visit's current services unchanged. `countsFor` counts
`kind = 'amendment'` only.

`billing`: `VisitChargeSubscriber` posts the `visit_charge_adjustment` as today, with a null
reason when none was given.

`roles`: `domain/system-roles.ts` and its pinning test; `docs/modules/roles.md` matrix.

## SPA

**Checkout pill** (`features/billing/checkout-pill.tsx`, in the app header beside the live-visit
pill): "Checkout · n". A menu of the queue (patient, visit number, outstanding), oldest first;
choosing one opens that patient's record with `postVisit` set, which opens the dialog.

**Checkout dialog** (the reworked `PostVisitSummaryDialog`):

- Header and the three blocks as today.
- Discount row: with `visit:discount`, on the visit's day, while the visit owes, an **Edit**
  control turns the row into the mode toggle and value (the workspace's `DiscountControl`
  presentation) with **Apply** and an optional reason field. Applying refreshes the visit, the
  summary and the queue. Otherwise the row is read-only.
- Footer by permission and state:
  - owes, `payment:write`: **Record payment** (existing dialog, this visit first), **Print
    invoice**, **Pay later**.
  - owes, no `payment:write` (assistant): **Done**, with the hint "Front desk will collect".
  - nothing owed: **Done**, **Print invoice**.

Strings in `en`, `ar`, `fr`.

## Flows covered

| Who completes | Discount                                              | Payment                                                                    |
| ------------- | ----------------------------------------------------- | -------------------------------------------------------------------------- |
| Dentist       | Dentist, live (today) or in the dialog                | Dentist in the dialog, or closes it and front desk collects from the queue |
| Dentist       | Front desk, in the dialog                             | Front desk                                                                 |
| Assistant     | Assistant live, or front desk / dentist in the dialog | Front desk or dentist from the queue                                       |

## Tests

- Domain: `planAmendment` with unchanged services and a changed discount (exists; add the
  discount-only case if missing).
- Integration (`clinical` + `billing`, one spec): checkout discount keeps the status, appends a
  `checkout_discount` row, posts the adjustment, leaves `amendmentCount` at 0; refused without
  `visit:discount`, on a stale `updatedAt`, on a visit of an earlier day, on a live or voided
  visit; a paid visit ends with credit.
- Tenant isolation: tenant A cannot discount tenant B's visit.
- Roles: the matrix test; the migration's grants on an existing tenant.
- SPA: the dialog's branching by permission and state; the pill's visibility and count.
- Playwright: dentist completes and closes; front desk opens the queue, applies a discount,
  records the payment; the queue empties.

## Implementation notes

- The pill is `features/clinical/checkout-pill.tsx`, not under `features/billing`: it reuses the
  visits list's queries, and `clinical` already imports `billing` in the SPA.
- The pill's label is not pluralised ("Checkout · 3"), so it is one string per language.
- The discount editor is its own component (`dialogs/checkout-discount-editor.tsx`) and previews
  the new visit total with the shared `visitMoney`; `DiscountControl` now takes any
  `{ value, setValue }`.
- `amend` and `setCheckoutDiscount` share `VisitsService.recharge`.

- **Print invoice** is in the footer in every state, the assistant's included.
- The pill reads one page of 50; a branch with more owing visits in a day shows the newest 50.
- The audit trail reads a checkout discount as "Discount set at checkout", with the totals and the
  reason when given.
- Not done: a test of the migration's grants on an existing tenant. The integration database is
  migrated empty, so there is no tenant for the statement to act on; it was checked by reading.

- Superseded the same day by the Today board (`2026-10-04-today-board-design.md`): the pill is
  now a link to `/today` with no menu, and the front desk checks out from the board's panel; the
  dialog's body and actions are shared with it.

## Docs

ADR-0030 (the checkout discount is a silent, same-day amendment under its own permission);
`docs/modules/clinical.md`, `billing.md`, `roles.md`; CLAUDE.md §4 `clinical` row
(`visit_amendments` now also holds checkout discounts).
