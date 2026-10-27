# Dentist compensation — implementation plan

Spec: `docs/superpowers/specs/2026-10-25-dentist-compensation-design.md` (K1–K15).

Ground rules:

- No branch or commit until the owner asks.
- Per task, run the affected tests and that package's typecheck. Task 14 runs the full lint,
  typecheck, tests, build and Playwright, then one review.
- Paths are under `apps/api/src/modules/` (API) or `apps/web/src/features/` (web) unless they
  start with `apps/`, `packages/` or `docs/`. Integration specs are in `apps/api/test/integration/`.
- New strings go to `apps/web/src/locales/{en,ar,fr}/` in the task that adds them. Add a
  `compensation` namespace and register it in `apps/web/src/types/i18next.d.ts`.
- The app is live: migration 0053 only adds. Existing API shapes don't change.

## 1. Contracts (K2, K6–K8, K13–K15)

- New `packages/contracts/src/compensation.ts`. Everything in the spec's Contracts section,
  exported from the package index.
- `components` refinements:
  - at most one of each kind;
  - percents 0–100 with 2 decimals;
  - `perVisit.byType` keys are `VisitType`;
  - `note` is required for adjustment kind `other`;
  - a payout amount is > 0;
  - an adjustment amount is ≠ 0.
- `canReadStatement(actor, profileId)` follows the actor shape of `visit-scope.ts`.
- `compensation.spec.ts` covers:
  - component validation, one case per refinement;
  - every preset parses as a valid component set;
  - `canReadStatement`: manage, own read, other's read, no profile.

Done: contracts tests and typecheck pass.

## 2. Domain: `compensation/domain/` (K6–K11)

- `money.ts`: cents ↔ string, rational share with half-away-from-zero rounding, and pro-rating
  that sums exactly (largest remainder).
- `segments.ts`: the live agreement on a date. Superseded agreements are ignored. Also the
  agreements overlapping a month, and the days each covers.
- `blend.ts`: pro-rate a charge's lines to its net amount, give each line its override percent
  (code, then category, then default), and blend.
- `compute.ts`: `computeStatement(input)` → `Statement` without names. Its input:
  - the month;
  - the anchor's snapshot ids and closing balance;
  - the agreements;
  - the visits, charges and collections (own month in range, plus late candidates);
  - the categories;
  - the adjustments and payouts;
  - the tenant currency.

  What it produces:
  - the earned groups, built per component;
  - the late group, using K10's id rule;
  - the threshold line (K8);
  - `notComputed`;
  - the totals.

- `periods.ts`, pure rules:
  - `assertMonthEnded`;
  - `assertCloseOrder(closedMonths, firstMonth, month)`;
  - `assertReopenable(nextClosed)`;
  - `assertDateOpen(date, closedMonths)`;
  - `firstMonth(agreements, adjustments, payouts)`.
- `agreement-rules.ts`: the K3 and K4 rules: change terms → supersede or end + create;
  `effective_date`; closed months. Also the K5 deactivation plan (which agreement to end, which to
  supersede).
- `compensation-errors.ts`: the error codes of the spec, as `DomainError`s.
- Specs: every bullet of the prompt's "domain tests", plus:
  - every acceptance figure: 120/40/160, 200, −8, 152.38 and the 30.48 % blend, 1,000 + 200,
    30 → 15, 200, 774.19, −200, the late V4 line, opening 60;
  - per-visit and per-day reversals of a closed month;
  - imported visits earn nothing;
  - a late line already in a snapshot is not counted twice;
  - rounding on negative lines.

Done: the domain specs pass with plain Vitest.

## 3. Building blocks (K5, spec "Building blocks")

- `billing/persistence/allocations.repository.ts` + `ledger-entries.repository.ts`: the three
  queries. `billing/application/billing.service.ts`: `visitChargesBetween`,
  `visitCollectionsBetween`, `unattributedCollectionsBetween`. Their docs say "building block,
  like `paidOn`".
- `clinical/application/visits/visit-facts.service.ts`: `completedByDentistBetween`.
  `clinical/application/catalog/catalog.service.ts`: `categoriesByCodes`.
- `users/events/staff-events.ts`: `STAFF_DEACTIVATED`. `users.service.ts` `deactivate`
  publishes it inside its transaction. Export it from `users/index.ts`.
- Move `billing/domain/csv.ts` (and its spec) to `platform/kernel/csv.ts` and update billing's
  imports.
- Integration specs:
  - `billing-compensation-reads.int-spec.ts`, on the payments fixtures: a charge with lines; an
    amendment adjustment; a reversal; a payment allocation; a refund release; credit applied;
    opening-balance collections going to unattributed; the `createdSince` window;
  - a case in `visits.int-spec.ts` for `completedByDentistBetween`: a void, an import, and the
    `changedSince` window;
  - a case in `users.int-spec.ts`: the event is published in the transaction.

Done: those specs and the API typecheck pass.

## 4. Schema and migration 0053 (K2–K4, K9, K12)

- `compensation/persistence/schema.ts`: the four tables, each with `tenantIsolationPolicy()`.
  - `compensation_agreements`:
    - the K2 columns;
    - `ended_by`, `ended_at`, `end_reason`;
    - `superseded_at`, `superseded_by`, `supersede_reason`;
    - `created_by`;
    - a check `effective_to >= effective_from`.
  - `compensation_adjustments`:
    - `staff_profile_id`, `kind`, `amount`, `currency`, `effective_date`, `note`, `created_by`;
    - idempotency key + hash, with a unique index;
    - `voided_at`, `voided_by`, `void_reason`.
  - `compensation_payouts`:
    - `amount > 0`, `currency`, `paid_on`, `method` (text + check), `reference`, `note`,
      `created_by`;
    - idempotency;
    - the void columns.
  - `compensation_periods`:
    - `staff_profile_id`, `month char(7)`, `status` (`closed | reopened`), `snapshot jsonb`;
    - `closed_at`, `closed_by`, `reopened_at`, `reopened_by`, `reopen_reason`;
    - `idempotency_key`, `idempotency_hash`;
    - unique `(tenant_id, staff_profile_id, month)`.
  - Indexes on `(tenant_id, staff_profile_id)` and on the date columns.
- `apps/api/migrations/0053_compensation.sql`:
  - generated with drizzle-kit, then edited by hand;
  - `CREATE EXTENSION IF NOT EXISTS btree_gist`;
  - the exclusion constraint `WHERE superseded_at IS NULL`;
  - grants in the 0046 pattern. For agreements, `UPDATE` only on the end and supersede columns.
    For adjustments and payouts, only the void columns. For periods, status, snapshot, the
    close/reopen columns and the idempotency columns. No `DELETE` anywhere.
- Apply it to the local dev DB, then check `drizzle-kit check` and the journal.

Done: the migration applies cleanly on a fresh Testcontainers DB and on the dev DB.

## 5. Service, routes, subscriber (K3–K5, K9–K15)

- `compensation/persistence/*.repository.ts`: agreements, adjustments, payouts, periods. Rows are
  mapped to domain types.
- `compensation/application/statement-reader.ts` (internal). It gathers the inputs: the anchor
  and snapshots; the building-block windows (`createdSince` = the anchor's `closed_at` minus one
  day); names via `users` and `patients`. It runs the months from the anchor + 1 forward to the
  opening balance and returns the statement.
- `compensation/application/compensation.service.ts`. The prompt's methods, with the K13 check
  on `statement`, the K14 rule on `myStatement` / `myMonths`, and the K12 idempotency.
  - Every mutation calls `requirePermission('compensation:manage')`.
  - Each mutation is audited with `about()` unset, and publishes its event.
  - `closePeriod` takes a lock on the dentist (advisory lock, or `FOR UPDATE` on the period
    row), computes, and writes the snapshot. The same lock is held by adjustments, payouts,
    ending and superseding for that dentist.
- `compensation/application/deactivation.subscriber.ts`: `@OnDomainEventInTransaction(STAFF_DEACTIVATED)`,
  which calls `CompensationService.endForDeactivation` (no permission check; documented).
- `compensation/http/compensation.controller.ts` and `my-compensation.controller.ts`: the
  prompt's routes. `@RequirePermission` on each. `Idempotency-Key` through `idempotencyKey()`.
  CSV through `platform/kernel/csv.ts` with the billing export header pattern.
- `compensation/events/compensation-events.ts`, `compensation.module.ts` and `index.ts` (the
  module only).
- `authorization/application/authorization.service.ts`: `can('compensation:read', { profileId })`
  goes through `canReadStatement`.
- Register `CompensationModule` in the app module.

Done: typecheck passes, and the module is in the boundaries config.

## 6. Audit filters (K15)

- `audit/persistence/audit.repository.ts`: a `withoutCompensation` filter, `resource_type like
'compensation\_%'` or (`resource_type = 'event'` and `action = any(COMPENSATION_EVENTS)`). It
  applies:
  - in the tenant feed, when the caller lacks `compensation:manage`;
  - always, in `GET /platform/audit`.
- Cases in `audit.int-spec.ts` (dentist, finance-only custom role, owner) and in
  `platform-audit.int-spec.ts`.
- Activity sentences for the nine actions, in the web `audit` namespace (en/ar/fr).

Done: those specs pass.

## 7. API integration and isolation tests

- `compensation.int-spec.ts`. One file, grouped by the prompt's acceptance sections, on
  `Asia/Beirut` USD fixtures:
  - collection vs billed (with supersede);
  - the discount;
  - overrides;
  - threshold;
  - per visit and per day;
  - pro-rating and rent;
  - payout, close, late entry, refused adjustment, reopen and next-closed;
  - close order and month not ended;
  - visibility (403, 404, hidden, no `compensation:read`, front desk, platform admin);
  - the report and its CSV smoke test;
  - deactivation;
  - idempotency replay and mismatch.
- `tenant-isolation.int-spec.ts` / `tenant-isolation-services.int-spec.ts`: the four tables and
  every `CompensationService` method.

Done: these and every existing API suite pass.

## 8. Web: data and Staff tab (prompt §1)

- `compensation/compensation-api.ts`: query and mutation hooks, typed from contracts. The
  mutations send an `Idempotency-Key`.
- `compensation/agreement-words.ts`: a component set → plain words ("40 % of collected amounts ·
  Implants 30 %"). It has a spec.
- `compensation/agreements-tab.tsx`: the current agreement card, the history (ended and
  superseded struck through), and the New / Change terms / End actions.
- `compensation/agreement-panel.tsx`: the 440 px right panel.
  - Preset tiles, then the fields of each component.
  - Custom shows collapsible sections, each with an Add switch.
  - Rates by service rows (catalog search or category).
  - A 422 `compensation.overlap` / `effective_date` error shows on the date field.
  - It has a spec: the preset pre-fills, validation, the overlap error, and change terms on the
    first day (the supersede wording).
- `platform/tenant-detail/user-panel.tsx`: an optional `extraTab` prop. `tenancy/settings-page.tsx`
  passes the Compensation tab with `compensation:manage` and practitioner type `dentist`.

Done: web typecheck and the new specs pass.

## 9. Web: Compensation report and statement (prompt §2)

- Route files `apps/web/src/routes/_app/compensation/index.tsx` (`?month`) and
  `compensation/$profileId.tsx` (`?month`), like `payments/`.
- `compensation/month-picker.tsx`.
- `compensation/report-page.tsx`: the KPI cards, the table, the muted Unattributed row, the
  status pills, Export CSV.
- `compensation/statement-view.tsx`: shared with task 10. It holds the header, the four cards,
  Earned by component, Late with the "from {month}" eyebrow, Adjustments, Payouts, Not computed,
  and the blended-rate tooltip. Voided rows are struck through, with the reason on hover. A
  negative closing reads "Dentist owes the clinic".
- `compensation/statement-page.tsx`: the owner actions.
  - `adjustment-panel.tsx` and `payout-panel.tsx`;
  - the close and reopen confirm dialogs (reopen needs a reason);
  - export.
  - The `period_closed`, `previous_period_open`, `month_not_ended` and `next_period_closed`
    errors are mapped to messages.
- Check that the print stylesheet gives an acceptable printout of the statement.
- Specs: the report row click and URL month mapping, and the close/reopen dialog branching.

Done: web typecheck and the specs pass.

## 10. Web: My statement and nav (prompt §3)

- Route `apps/web/src/routes/_app/my/statement.tsx` (`?month`, limited to `/me/months`).
- `compensation/my-statement-page.tsx`: `statement-view` read-only, with the Provisional note.
- `apps/web/src/shell/nav-items.ts`: `compensation` (manage) after `payments`, and
  `myStatement` (read). `sidebar.tsx` hides `myStatement` until `/me/months` is non-empty.
  `nav-icons.tsx` gets two icons.
- Specs: `nav-items.spec.ts` (platform admin sees neither; front desk sees neither), and the
  sidebar's data-gated item.

Done: web typecheck and the specs pass.

## 11. i18n

- Fill `compensation` in en/ar/fr: presets, components, kinds, errors, statement labels, empty
  states (including "imported history earns nothing" for the first month).
- Check RTL mirroring on the three screens.

Done: the i18n key-parity check (if present) and typecheck pass.

## 12. Playwright

- `apps/web/e2e/compensation.spec.ts`, two flows:
  - owner: an agreement → visits → a payment → the statement → a payout → close → a late
    entry in the next month;
  - the dentist's own statement: lines and the provisional note, no other dentist.

Done: both flows pass locally.

## 13. Docs

- ADR-0058, _Agreements are effective-dated component sets_: supersede, ending, deactivation.
- ADR-0059, _The statement is derived for open months and frozen on close_: late entries by id,
  months closed in order, threshold per statement month, rounding.
- ADR-0060, _Compensation is clinic-managed only_: the platform admin is excluded (including
  Platform Activity); `canReadStatement`.
- `docs/modules/compensation.md`: the tables, rules, routes, permissions and the building blocks
  it consumes.
- `billing.md`, `clinical.md` and `users.md`: the new reads and the event. `audit.md`: the filter.
- CLAUDE.md §4: a `compensation` row in the module map, and `compensation` under the modules
  that react to `users` events.
- Update `docs/adr/README.md`.

## 14. Final

- Run the full `pnpm lint`, `typecheck`, `test`, the API integration suites, `build` and
  Playwright.
- Do one review over the working tree.
- Report, and ask whether to commit (the feature-10 three-commit shape).
