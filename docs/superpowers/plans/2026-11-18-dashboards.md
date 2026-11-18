# Financial and operational dashboards — implementation plan

Spec: `docs/superpowers/specs/2026-11-18-dashboards-design.md` (D1–D10).

Ground rules: nothing is committed until the owner asks; per task the affected tests and that
package's typecheck, everything at the end, then one review. The app is live: migration 0060
only adds (permissions, indexes); existing API shapes only gain optional fields. No queue, job
or Redis.

## 1. Contracts

- `permissions.ts` + `capabilities.ts`: `dashboard:financial` (⇒ `finance:read`),
  `dashboard:operational`, group `dashboard`.
- New `dashboards.ts`: period presets, `dashboardQuerySchema`, `resolvePeriod`, `monthsEnding`,
  `weeksEnding`, `rateOf`, `changeOf`, every card's response schema.
- Additions: visit filters (`from`, `to`, `branchId`, `finished`), charged query/summary,
  transaction filters (`from`, `to`, `branchId`) + summary, appointment list query, patient
  `cohort` filters.
- Done: `dashboards.spec.ts` (periods: running month, clamping, whole months, custom, 12-month
  and 12-week windows, zero denominators).

## 2. Roles and migration 0060

- `system-roles.ts` unchanged (owner/admin take `GRANTABLE_PERMISSIONS`).
- `0060_dashboards.sql`: the two permissions for `owner`/`admin` roles and templates; indexes
  `ledger_entries (tenant_id, effective_date) where visit_id is not null`, `appointments
(tenant_id, starts_at)`, `visits (tenant_id, local_date)`, `treatment_plans (tenant_id,
recorded_at)`. Journal + snapshot.
- Done: migration applies to the dev DB.

## 3. Owning-module summaries

- `billing/application/summary.service.ts` (+ `persistence/summary.repository.ts`,
  `domain/service-split.ts` with a spec).
- `clinical/application/reads/clinical-summary.service.ts` (+ repository queries).
- `scheduling/application/scheduling-summary.service.ts` (+ `domain/capacity.ts` with a spec).
- `expenses`, `payroll`, `compensation`, `labs`, `patients`: summary methods on their services.
- Done: typecheck; existing suites green.

## 4. `dashboards` module

- `domain/` (pure: change chips data, median, shares), `application/financial.service.ts`,
  `operational.service.ts`, `http/dashboards.controller.ts`, `index.ts`, register in
  `app.module.ts`.
- Done: `dashboards.int-spec.ts` — the acceptance clinic: every figure equals its home screen's
  total; complete cost; platform admin; Jamie sees no money; branch steps aside; tenant
  isolation.

## 5. Drill-down filters

- Visits (`from`/`to`/`branch`/`finished`, charged view), Payments (`from`/`to`/`branch`,
  summary), Schedule list view, Patients cohorts. API routes + SPA screens.
- Done: the dashboards int-spec drills (Payments total = Collected, charged footer = Production).

## 6. SPA shell and shared parts

- `components/ui/info-mark.tsx`, `components/ui/figure-tile.tsx`, `components/charts/*`
  (Recharts added to `apps/web`), nav entry, route `/dashboard` + search parser, session
  landing unchanged.
- Done: specs for the search parser and the tile's chip colour.

## 7. Financial and Operational tabs

- `features/dashboards/*`, locales en/ar/fr, print styles.
- Done: page renders on the seeded clinic; role gating spec.

## 8. Docs, e2e, review

- ADR-0087 to ADR-0092, `docs/modules/dashboards.md`, pages of the modules that gained a summary
  or filter, `CLAUDE.md` module map and §13.
- `apps/web/e2e/dashboards.spec.ts`: owner → Financial → Collected → Payments → Back →
  Operational → an attention line.
- Full lint, typecheck, tests, format check; review over the working tree.
