# Feature 7: MVP hardening — implementation plan

Status: done (2026-10-06). Migration numbers below are the plan's; the files are 0033 owners,
0034 idempotency, 0035 audit context, 0036 tooth presence and effect, 0037 retire `tooth_status`.

Spec: `docs/superpowers/specs/2026-10-06-mvp-hardening-design.md` (H1–H9, D1–D22). Branch
`feat/mvp-hardening`; the owner commits at the end, slice by slice. Per task: the affected tests
and that package's typecheck. Full lint, typecheck, tests, build, Playwright and one review in
task 13.

Paths are under `apps/api/src/modules/` (API) or `apps/web/src/features/` (web) unless they start
with `apps/`, `packages/` or `docs/`.

## Slice 1 — money safety

### 1. Small fixes (H9)

Files: `apps/api/migrations/0033_owner_practitioner_type.sql` (owners typed `other` → `dentist`);
`docs/modules/auth.md` (dormant `auth_invitations`), `docs/modules/provisioning.md`.
Done when: the migration applies over the dev DB; an integration check in
`users` proves an older owner reads as a dentist.

### 2. Currency lock (H6)

Files: `tenancy/events/tenant-events.ts` (`TenantCurrencyChanging`), `tenancy/index.ts`,
`tenancy/application/tenancy.service.ts` (publish in the transaction when the currency changes);
`billing/application/currency-lock.subscriber.ts` (veto, `TenantCurrencyLockedError` 422
`tenant.currency_locked`), `billing/persistence/ledger-entries.repository.ts` (`any()`),
`billing/application/billing.service.ts` (`currencyLock()`), `billing/http/billing.controller.ts`
(`GET /billing/currency-lock`, `tenant:read`); `packages/contracts/src/billing.ts`
(`currencyLockSchema`); web `platform/tenant-detail/settings-tab.tsx`, `platform/platform-api.ts`,
locales.
Tests: `billing.int-spec.ts` (fresh tenant changes; one entry locks; the read), settings-tab spec.

### 3. Merge re-point in the transaction (H8)

Files: `billing/application/merge-ledger.subscriber.ts` (in-transaction: lock both accounts, move
entries and payments, settle, audit); delete `merge-ledger.worker.ts` and its specs, the queue
registration in `billing.module.ts`, `BillingService.repointMergedEntries`,
`PatientsService.survivorOf` and its fail-fast comment when nothing else uses it.
Tests: the `merge re-point` block of `billing-views.int-spec.ts` rewritten (sum of two opening
balances right after `merge`, chain A→B→C, rollback when the handler throws, a ledger write in
flight); the job waits removed from `billing.int-spec.ts`, `billing-visit-charge.int-spec.ts`,
`tenant-isolation-services.int-spec.ts`.

### 4. Idempotency (H5)

Files: `apps/api/src/platform/http/idempotency-key.ts` (header parser, moved from the payments
controller), `apps/api/src/platform/kernel/request-hash.ts` (+ spec);
`apps/api/migrations/0034_idempotency_keys.sql`; `patients/persistence/schema.ts`,
`patients.repository.ts`, `patients.service.ts` (`create(input, { idempotencyKey })`),
`patients/http/patients.controller.ts`; `billing/persistence/schema.ts`,
`ledger-entries.repository.ts`, `ledger-writer.ts`, `billing.service.ts`
(`createWithOpeningBalance`, `adjustBalance`), `billing.controller.ts`; web
`lib/use-idempotency-key.ts` (+ spec), `patients/patients-api.ts`, `billing/billing-api.ts`,
`patients/panels/patient-form-panel.tsx`.
Tests: one integration block per route (replay, mismatch, two concurrent requests), tenant
isolation of keys; existing HTTP tests of the three routes send a key.

## Slice 2 — adjust balance (H4)

### 5. API and views

Files: `packages/contracts/src/billing.ts` (reason enum, note rule),
`packages/contracts/src/payments.ts` (history item union, statement line reason);
`billing/application/billing.service.ts` (`payment:refund`), `billing.controller.ts`,
`payment-views.service.ts` (history with adjustment rows, statement reason), `docs`.
Tests: `billing.int-spec.ts` (front desk refused, dentist allowed, audit), `payments.int-spec.ts`
or `billing-views` (history, statement, outstanding, a 90-day adjustment in 61–90).

### 6. SPA

Files: `billing/adjust/adjust-balance-panel.tsx`, `adjust-draft.ts` (+ specs),
`adjust-balance-provider.tsx` / context beside the payment dialog provider;
`billing/balance-card.tsx`, `billing/balance-tab.tsx` (adjustment row, the "Opening balance"
mislabel), `patients/record/overview-tab.tsx` (⋯ menu),
`billing/payments-screen/payments-page.tsx` (Outstanding ⋯ menu), printables statement, locales.

## Slice 3 — activity (H7)

### 7. Audit context and feed

Files: `packages/contracts/src/audit.ts` (`ACTIVITY_AREAS`, `areaOfAction`, query and entry
fields, + spec); `audit/persistence/schema.ts`, `audit.repository.ts`, `audit.service.ts`;
`apps/api/migrations/0035_audit_context.sql` (columns, indexes, backfill); every `audit.record`
caller that holds a patient or visit id passes it; `LedgerWriter` hides the shadow rows;
`patients` `GET /patients/names`, `clinical` `GET /visits/numbers`.
Tests: `audit.int-spec.ts` (filters, hidden rows, context on a visit's service and a payment),
tenant isolation of the filters.

### 8. Activity screen

Files: `apps/web/src/routes/_app/activity.tsx`, `shell/nav-items.ts`, `audit/activity-page.tsx`,
`activity-filters.tsx`, `activity-api.ts`, `sentence.ts`, `changes.ts`, `use-activity-search.ts`
(+ specs for sentence, changes, URL mapping, gating); "View all activity" in
`patients/activity-timeline.tsx` and `clinical/visits-list/visit-audit-trail.tsx`; locales
`activity.json` × 3, `lib/i18n.ts`.

## Slice 4 — tooth presence (H1–H3)

### 9. Storage, contracts, retirement

Files: `packages/contracts/src/clinical-records.ts`, `chart.ts`, `tooth.ts`, `catalog.ts`
(+ specs); `clinical/persistence/schema.ts`, `tooth-presence.repository.ts` (replaces
`tooth-status.repository.ts`), `procedures.repository.ts`;
`apps/api/migrations/0036_tooth_presence.sql`, `0037_retire_tooth_status.sql`;
`clinical/domain/default-catalog.ts`, `discard-rule.ts`, `presence.ts` (current presence of a
tooth from its rows, + spec); `events/record-events.ts`; `chart.service.ts`,
`merge-clinical.subscriber.ts`, `catalog.service.ts`; the old route, service method and tests
removed.

### 10. API writes

Files: `clinical/application/presence-writer.ts`, `visit-records.service.ts` (`setPresence`,
`removePresence`, hooks in `addService`, `removeService`, `performPlan`,
`markServiceUnfinished`), `visits.service.ts` (`amend`, `void`), `patient-records.service.ts`
(`setPresence`, `removePresence`), controllers.
Tests: `tooth-presence.int-spec.ts` (every acceptance path of the prompt's presence bullets),
`clinical-merge.int-spec.ts`, `clinical-chart.int-spec.ts`, tenant isolation.

### 11. SPA chart and catalog

Files: `clinical/chart/tooth-glyph.tsx`, `glyph-style.ts`, `panel-glyph.tsx`, `chart-legend.tsx`,
`tooth-title.ts`, `chart-preview.tsx` (+ specs); `clinical/catalog/catalog-row.tsx`,
`catalog-draft.ts`, `catalog-layout.ts`, `catalog-page.tsx`; `patients/record/overview-tab.tsx`
(summary line); `dialogs/tooth-history-dialog.tsx`; locales.

### 12. SPA presence controls

Files: `clinical/workspace/tooth-panel/presence-menu.tsx`, `presence-banner.tsx`,
`presence-popover.tsx`, `tooth-panel.tsx`; `workspace/charting-actions.ts`,
`record/patient-charting-actions.ts`, `visit-mutations.ts`, `record/patient-records-api.ts`;
`record/presence-edit-mode.tsx`, `record/chart-tab.tsx` (+ specs); locales.

## 13. Finish

Playwright (`apps/web/e2e/`): `presence.spec.ts` (extraction → missing → undo → implant placement
→ implant mark; Edit presence batch at intake), `payments.spec.ts` (adjust → statement; receipt on
one A4 page), `activity.spec.ts` (filter → expand → link); `catalog.spec.ts` counts for `IMP`.
Docs and ADR-0034 to ADR-0037, CLAUDE.md §4, §10, §12. `pnpm lint && pnpm typecheck && pnpm test
&& pnpm build`, the e2e run, one review of the branch, fixes.
