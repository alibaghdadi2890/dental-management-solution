# Feature 9: chart marks — implementation plan

Status: done (2026-10-08). New files beyond the plan: `chart/service-mark.tsx` (the lists' chip),
`chart/use-tooth-render.ts` (the hook every caller draws a tooth through) and
`chart/chart.test-utils.ts`. The sixteen-colour ring check is a component spec, not Playwright
(spec, implementation notes).

Spec: `docs/superpowers/specs/2026-10-08-chart-marks-design.md` (D1–D22) over the feature 9
prompt (M1–M16). Branch `feat/chart-marks`; the owner commits at the end. Per task: the affected
tests and that package's typecheck. Full lint, typecheck, tests, build, Playwright and one review
in task 13.

Paths are under `apps/api/src/modules/clinical/` (API) or `apps/web/src/features/clinical/` (web)
unless they start with `apps/`, `packages/` or `docs/`.

## Slice 1 — contracts and API

### 1. Mark contracts

Files: `packages/contracts/src/marks.ts` (+ spec), `index.ts`, `catalog.ts` (+ spec rows).
Done when: contracts tests pass (`leastUsedMarkColor` ties and nulls; inputs accept missing
fields; priority 0–9).

### 2. Derived tooth state

Files: `packages/contracts/src/clinical-records.ts` (`procedureId`, `toothDiagnosisSchema`,
`toothServiceSchema`, `ToothState` lists, `planInProgress`, `patientChartSchema.marks`),
`chart.ts` (`marks`, `liveVisit`, lists, sort), `chart.spec.ts`.
Done when: the chart spec covers lists, D11 sort, inactive items, a missing mark (D12),
whole-tooth items, `planInProgress` under a service treated today; existing cases still pass.

### 3. Catalog storage

Files: `persistence/schema.ts`, `procedures.repository.ts`, `diagnoses.repository.ts`,
`catalog-store.ts`; `domain/default-catalog.ts` (+ spec: every diagnosis and per-tooth service
has a colour, the others none); `application/catalog.service.ts` (D6, audit fields),
`catalog-seeding.subscriber.ts`; `apps/api/migrations/0039_chart_marks.sql` + snapshot + journal.
Tests: the catalog integration spec gains: create without a colour → least-used; `per_jaw` with a
colour → stored null; update keeps an unsent colour; the audit row names the change.
Done when: those pass, the api typecheck passes, and the migration has been applied to the local
database with the backfill checked by a query (D21).

### 4. Chart read

Files: `application/chart.service.ts` (marks, `liveVisit`), `record-mapping.ts` (`procedureId`),
`procedures.repository.ts` / `diagnoses.repository.ts` (`marksByIds`, deleted rows included).
Tests: `apps/api/test/integration/clinical-chart.int-spec.ts`: marks for every referenced id; a
deactivated service still has its mark and its tooth lists it; `patient-records.int-spec.ts` and
the tenant-isolation suite stay green.

## Slice 2 — SPA

### 5. Palette, icons, chip

Files: `apps/web/src/styles.css` (64 tokens, D1–D3), `chart/mark-icons.tsx`, `chart/mark-chip.tsx`,
`chart/palette.spec.ts` (D4), `apps/web/src/locales/{en,ar,fr}/clinical.json` and `catalog.json`
(colour names, icon names, view labels, legend titles, helper texts).
Done when: the contrast spec passes for all 16 keys.

### 6. ToothRender

Files: `chart/tooth-render.ts` (+ spec), `chart/use-chart-marks.ts`, `chart/use-chart-view.ts`
(+ spec); delete `chart/tooth-title.ts` and its spec.
Done when: the table spec passes for view × mode × presence, M3–M7, M9, band overflow, highlight
and the title (M14).

### 7. Glyphs

Files: `chart/glyph-style.ts` (sizes M8, `FILL`/`EDGE` reduced to `planned` and `none`, the
in-progress ring), `chart/tooth-glyph.tsx`, `panel-glyph.tsx`, `presence-glyph.tsx` (D15, D16),
`fit-cell-size.ts` (+ spec), `tooth-glyph.spec.tsx`.
Done when: the glyph spec passes per view with the `data-*` attributes of the prompt; no
derivation is left in the glyph files; `cellMark` is gone from contracts if unused.

### 8. Chart, switch, legend, highlight

Files: `chart/dental-chart.tsx` (builds a `ToothRender` per tooth, dots, `highlight` prop),
`chart/chart-view-switch.tsx`, `chart/legend-items.ts` (+ spec), `chart/chart-legend.tsx`,
`chart/use-chart-highlight.ts`, `workspace/chart-card.tsx`, `workspace/use-chart-keyboard.ts`
(Esc order, D18), `record/chart-tab.tsx`, `workspace/visit-workspace-page.tsx` (`marks`,
`liveVisit` into `deriveChart`), `dental-chart.spec.tsx`, a legend spec (groups omitted when
empty, "+N more", `aria-pressed`, highlight on and off).

### 9. Other chart surfaces

Files: `apps/web/src/features/patients/record/overview-tab.tsx` and
`apps/web/src/features/files/tooth-field.tsx` (compact, M9), `chart/chart-preview.tsx`,
`dialogs/tooth-history-dialog.tsx`, `workspace/tooth-panel/tooth-panel.tsx` (text chips under the
glyph), `completed-section.tsx` and `workspace/todays-services.tsx` (chip before the name).

### 10. Catalog page

Files: `catalog/catalog-draft.ts` (+ spec: fields, dirty tracking, least-used on add and on
switching to `per_tooth`, nulled otherwise), `catalog-layout.ts` (Mark column), `catalog-row.tsx`,
`catalog/mark-pickers.tsx` (colour popover with the priority stepper, icon popover; Radix
Popover), `catalog-page.tsx` (header cell), `catalog-page.spec.tsx` (pickers hidden for `per_jaw`,
choosing marks the row dirty).

## Slice 3 — finish

### 11. Playwright

`apps/web/e2e/chart-marks.spec.ts`: set colours and icons in the Catalog → the three views on a
seeded patient → reload keeps the view; live visit: add a filling → today tone, legend line,
highlight, Esc; the sixteen-colour ring walk (D20).

### 12. Docs

ADR-0042 (chart marks live on catalog items and recolour retroactively), ADR-0043 (chart view is a
per-user browser preference; chart mode stays tenant-level), `docs/adr/README.md`,
`docs/modules/clinical.md` (marks, palette, `ToothRender`), `CLAUDE.md` (§1: the dental chart
supersedes the POC chart; §13: `ToothGlyph` renders a `ToothRender`).

### 13. Verification and review

Full lint, typecheck, unit + integration tests, build, Playwright; one review over the diff.
