# Feature 4b — implementation plan

Spec: `docs/superpowers/specs/2026-10-01-visits-list-amend-void-design.md`. Branch
`feat/visits-list`; the user commits at the end. Per task: run only the affected tests + that
package's typecheck. Full lint/typecheck/tests/Playwright and one branch review in task 8.

## 1. Clinical: data, domain, amend/void

Files: `packages/contracts/src/{visits,visit-list,clinical-records}.ts`;
`apps/api/migrations/0019_*`; `clinical/persistence/{schema,visits.repository,
visit-amendments.repository,visit-services.repository,treatment-plans.repository}.ts`;
`clinical/domain/{visit-lifecycle,visit-amendment,visit-cursor,visit-range}.ts`;
`clinical/application/visits.service.ts`; `clinical/events/visit-events.ts`; `clinical/index.ts`;
`clinical/http/visits.controller.ts`.

Done when: migration applies on a fresh DB and over 4a data (backfilled numbers); domain specs
cover every D1–D4 rule; `POST /visits/:id/amend|void` work with 403/409 paths; `start` mints
`V-` numbers; counted/voided read changes in place (last visit, summary, history, tooth history,
`voidedVisitIds`); integration specs for amend/void (without billing assertions yet) pass.

## 2. Billing: ledger kinds, reactions, visit money views

Files: contracts `billing.ts`; `apps/api/migrations/0020_*`; `billing/persistence/{schema,
ledger-entries.repository}.ts`; `billing/application/{visit-charge.subscriber,billing.service,
visit-views.service,patient-export.service}.ts`; `billing/http/billing-visits.controller.ts`.

Done when: amend posts an adjustment (none for zero delta), void posts a reversal and is vetoed
when `paidOn > 0`; `charged` / `visitSummary` count all visit kinds; balances, unpaid (+summary)
and export routes answer; the amend/void integration specs assert the ledger and balances;
ledger-constraint spec passes.

## 3. Clinical: list, summary, stats, not-seen

Files: `clinical/application/visits.service.ts` (search, summary, lastVisitFor,
patientIdsSeenSince); `clinical/persistence/visits.repository.ts`;
`clinical/http/{visits,clinical-patients}.controller.ts`; `patients/application/
{patients.service,patient-search.sql}.ts` (`idsNotIn`, guards).

Done when: the consolidated search integration spec, the smoke specs (visit-stats, not-seen +
count, unpaid, export) and the tenant-isolation spec pass.

## 4. Web: Visits page and detail panel

Files: `apps/web/src/features/clinical/visits-list/*`, `features/clinical/visits-api.ts`,
`features/billing/billing-api.ts`, `routes/_app/visits/index.tsx`, `locales/{en,ar,fr}/visits.json`.

Done when: tabs/filters/URL, table, footer pager, export, panel with totals and audit trail
render against the API; filters ↔ URL spec and footer-by-role spec pass.

## 5. Web: amend and void

Files: `features/clinical/visits-list/{amend-*,void-*}.tsx`, mutations in `visit-mutations.ts`.

Done when: amend form spec (dirty state, payload, plan-linked) and void dialog branching spec
pass; list, panel, balances refresh after each.

## 6. Web: record tabs and patients list

Files: `features/patients/record/{record-search,patient-record-page,overview-tab}.tsx`,
`features/clinical/record/{history-tab,visit-history-row,clinical-threads,build-threads,
chart-tab}.tsx`, `features/billing/balance-tab.tsx`, `features/patients/{patients-api,
use-patients-list-data,patients-table,filter-bar,patients-page}.ts(x)`.

Done when: the three tabs render; `visitId` expands a visit; `buildThreads` spec passes; patients
list shows Last visit / Visits and the Not seen view + count.

## 7. 4a follow-ups and error messages

Files: workspace financial bar, plan-section (confirm popover), workspace live-status banner,
fr locale comment, patient-created toast + record `startVisit`, i18n init, `apiErrorMessage` +
`clinical:errors.*` keys, role labels, clinic-name bidi.

Done when: each of the eight items works by hand; `apiErrorMessage` spec passes.

## 8. Finish

Playwright flow (complete → list → amend → balance → void → struck through); docs
(`clinical.md`, `billing.md`, `patients.md`, `roles.md`), ADR-0025, ADR-0026, CLAUDE.md §4;
`pnpm lint`, `pnpm typecheck`, full tests, Playwright; one review over the branch, fix findings.
