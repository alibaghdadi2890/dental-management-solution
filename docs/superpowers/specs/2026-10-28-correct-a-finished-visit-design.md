# Correct a finished visit — design

Date: 2026-10-28. ADR-0062 (this replaces the earlier, uncommitted "correct times" ADR-0062).

## Ask

A dentist or an admin corrects a finished visit's mistakes: the start and end times, a wrong
tooth, a wrong service. The correction is the source of truth: the patient's balance follows it.
A replaced service is charged at the new service's catalog price, unless a price was typed.
In the UI, "Amend" becomes **Correct** ("Correct visit", status "Corrected").

## Decisions

- **C1. One action.** Amend (`POST /visits/:id/amend`, `visit:amend`) is extended. There is no
  separate times action: `visit:edit_times`, `POST /visits/:id/times` and migration `0055` are
  removed. Code names stay `amend`; only the words users see change, so stored grants are untouched.
- **C2. What a correction may change.**
  - The times: `times: { startedAt, completedAt }`, optional, under the ADR-0062 rules (same local
    day, end after start, at most 24 h, not in the future). Pauses are dropped and the duration is
    recomputed.
  - Existing services: tooth and surfaces as before; a `price` (sets base = price, line
    discount = 0); removal.
  - New services: `{ procedureId, toothCode?, jaw?, surfaces?, price? }`. Each is an active catalog
    service in the visit's currency, at its catalog price unless `price` is given. It is placed
    under the recording rules (`assertTarget`), has no plan link, and applies its tooth effect.
  - The visit discount, as before.
- **C3. Permissions.** `visit:amend`. A typed price or a discount change also needs `visit:discount`,
  as anywhere else (ADR-0055). The visit scope applies.
- **C4. Status and history.**
  - A change to services, prices or discount: the visit becomes `amended` ("Corrected"), one
    `visit_amendments` row is written, audited `visit.amend` and `VisitAmended` is published. The
    snapshots include the times when they changed too.
  - Times alone: the status stays, no amendment row and no event; audited `visit.times`.
  - Nothing changes → 422 `visit.amend_no_change`.
- **C5. Imported visits.** Only their times may be corrected. Anything else → 409 `visit.imported`.
  The list item gains `imported`.
- **C6. Ledger.** As before, the difference is posted as a `visit_charge_adjustment` on the day of
  the correction. It now carries **lines: the visit's services after the correction**, the same
  shape as a charge's lines. The plan share is stored even when the difference is zero.
- **C7. Compensation.** A visit's states are its entries that carry lines, each giving the
  cumulative net amount. A production entry whose lines differ from the state before it, at a
  different rate, earns E(after) − E(before), where E(s) = net × the rate of s's lines. Any other
  entry earns its amount × the rate of the state before it (the charge: its own). Collections use
  the visit's latest state. For visits never corrected, the result is identical to today.
- **C8. Accepted edge cases.**
  - A correction that leaves the total unchanged posts nothing (the ledger refuses 0). A swap
    between two services at the same price with different rates therefore doesn't change the
    dentist's pay.
  - The rate shown on a corrected line is its effective rate (earned / base).

## SPA

- The detail panel's ⋯ menu and the times form go. **Correct visit** opens one form:
  - a Times section (start and end on the visit's day);
  - the services: tooth and surfaces, price (editable with `visit:discount`), remove;
  - **Add service**: the catalog picker; then a tooth, a jaw, or nothing, depending on how the
    service is charged;
  - the visit discount.

  Save confirms before → after with a reason.

- An imported visit's form shows the times only.
- Wording: Correct / Corrected / Correcting in en, ar and fr, including the list tab, the status
  pill, the trail, the Activity feed, the roles label and errors.

## Tasks

1. Contracts: `amendVisitSchema` (kept | added lines, `price`, `times`), `imported` on the list
   item. Remove `editVisitTimesSchema` and `visit:edit_times`.
2. Clinical domain: `planAmendment` (added lines, prices, `changed`), `planVisitTimes` returns
   null when unchanged. Specs.
3. Clinical service and controller: the `amend` flow per C2–C5. Remove `editTimes` and its route.
4. Billing: adjustment lines and plan share (C6). Compensation: feed + `compute` (C7). Specs.
5. Remove migration 0055 and the roles changes; clean the dev DB.
6. Integration tests: correction flows (money, ledger lines, times, imported, permissions) and
   compensation rates after a replacement. Tenant isolation.
7. SPA: draft, form, panel, wording. Specs.
8. Docs: ADR-0062 rewritten, clinical, billing, compensation and roles pages, CLAUDE.md.
9. Full typecheck, lint, tests and Playwright visit flow.
