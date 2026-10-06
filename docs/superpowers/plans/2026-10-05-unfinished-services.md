# Unfinished services — implementation plan

Spec: `docs/superpowers/specs/2026-10-05-unfinished-services-design.md` (U1–U11). Same branch,
`feat/clinical-levels-planning-multivisit`; the user commits at the end. Per task: run only the
affected tests + that package's typecheck. Full lint/typecheck/tests/Playwright and one review of
this change in task 6.

All paths below are under `apps/api/src/modules/clinical/` (API) or
`apps/web/src/features/clinical/` (web) unless they start with `apps/`, `packages/` or `docs/`.

### 1. Contracts, schema, migration

Files: `packages/contracts/src/visits.ts`: `unfinishedAnsweredAt: string | null` on `Visit`;
`packages/contracts/src/clinical-records.ts` (+ spec): `answerUnfinishedInputSchema
{ continue: planId[] }` (max 50, unique), `start` removed from the in-visit plan-treatment input;
`persistence/schema.ts`: `visits.unfinished_answered_at timestamptz null`;
`apps/api/migrations/0031_*.sql`: generated; `application/visit-mapping.ts`,
`persistence/visits.repository.ts`: map the column; web test fixtures that build a `Visit`
(`workspace/workspace.test-utils.tsx`, `start-visit.test-utils.ts`).

Done when: the migration applies fresh and over the dev DB; contracts specs pass; contracts, api
and web typecheck (apart from the `start` callers removed in tasks 2 and 3).

### 2. API: not finished, answer

Files: `application/visit-records.service.ts`:

- `markServiceUnfinished(visitId, serviceId)` (U2): lock the service in the visit; soft-delete it
  (audit `visit_service.unfinished`, before = the service); when it has a plan, put the plan back
  through `PlanUnperformer`, else create one through `RecordWriter.planTreatment` from the
  service's snapshot (procedure, target, surfaces; no catalog re-read, so an item made inactive
  since still works); set the plan's price to the service's base amount; then the private
  `start`. Answers `PlanResult`.
- `answerUnfinished(visitId, { continue })` (U5): for each plan id, lock for the patient,
  `assertInProgress`, insert this visit's session when it has none (audit `treatment_plan.session`
  as `recordSession` does); stamp `unfinished_answered_at` when null; audit
  `visit.unfinished_answered` with the plan ids. Answers the `Visit`.
- Remove `startPlan` and the `start` branch of `planTreatment`.

`persistence/treatment-plans.repository.ts`: `update` accepts `priceAmount`;
`application/record-writer.ts`: a snapshot-based insert beside the catalog-based one if
`planTreatment` cannot take a snapshot; `domain/plan-lifecycle.ts` (+ spec): drop `assertCanStart`
if nothing else uses it; `http/visit-records.controller.ts`:
`POST /visits/:id/services/:serviceId/unfinished`, `POST /visits/:id/unfinished-answer`, both
`@RequirePermission('visit:write')`; the `start` route removed.

Tests: `apps/api/test/integration/multi-visit.int-spec.ts`, rewritten around the new entry: add a
service, edit its price, mark it not finished (service gone, plan `in_progress` at the edited
price, one session, visit completes at total 0 with no ledger charge); visit 2 answered with
continue (session, stamp) and completed still unfinished; visit 3 completes it with one charge on
visit 3; an answer of not today stamps and records nothing, and that visit can be discarded; a
second answer keeps the first stamp; a performed plan marked not finished returns to
`in_progress`, and removing its session returns it to `planned`; the existing undo, amend, cancel
and void cases kept, started through the new method.
`apps/api/test/integration/tenant-isolation-services.int-spec.ts`: tenant A cannot mark tenant B's
service or answer tenant B's visit.

Done when: those specs and the visit-records, corrections and billing-charge specs pass; api
typecheck.

### 3. Web: services card and row menu

Files: `visits-api.ts`, `visit-mutations.ts` (+ spec): `markUnfinished`, `answerUnfinished`;
`startPlan` removed; `workspace/charting-actions.ts`: `markUnfinished(service)` (toast with Undo, which
calls `performPlan` so the service returns); **Complete** is today's `performPlan`, unchanged; `continuePlan`, `undoSession`, `removeUnfinished(plan)` (remove this visit's
session; then `removePlan` when the plan was recorded in this visit); `startTreatment` and
`startPlan` removed; `record/patient-charting-actions.ts`: the same removals;
`workspace/unfinished.ts` (+ spec, new, pure): from the chart's plans and the visit id, the three
lists — to continue (in progress, no session here), worked on here (in progress, session here),
and the carried-forward total;
`workspace/service-row-menu.tsx` (+ spec, new): the three-dot menu, items by row state (service:
Not finished, Remove; unfinished here: Not today or Remove; to continue: Continue, Cancel);
`workspace/todays-services.tsx` (+ spec): takes the chart; the To continue block, the mixed rows
in order added, the badge, **Complete** on unfinished rows worked on here, the footer's "Charged
today" and "Carried forward"; rendered when the visit has services or the patient unfinished work;
`workspace/visit-workspace-page.tsx`: pass the chart; `workspace/catalog-drawer.tsx` (+ spec):
**Start, finish later** removed; `workspace/tooth-panel/plan-section.tsx`,
`workspace/plan-board.tsx` (+ spec): **Start** removed, `in_progress` plans no longer listed, the
count and estimate over `planned` only; `workspace/tooth-panel/{tooth-panel,area-panel}.tsx`: the
target's unfinished work listed with today's treatment, with the same row;
`workspace/tooth-panel/in-progress-plan.tsx` (+ spec): deleted;
`locales/{en,ar,fr}/clinical.json`: new keys, the Start and in-progress keys removed.

Done when: the `unfinished`, row-menu and todays-services specs pass (items per state, ordering,
totals, hidden without `visit:write`); the drawer and plan-board specs pass without Start; web
typecheck.

### 4. Web: popup and records of each visit

Files: `dialogs/unfinished-dialog.tsx` (+ spec, new): the list with a ticked checkbox each,
**Continue** (disabled with none ticked) and **Not today**; Escape and the scrim do nothing, so
the question is answered; `workspace/visit-workspace-page.tsx`: open it when `canWrite`,
`visit.unfinishedAnsweredAt === null` and the to-continue list is not empty;
`dialogs/visit-summary-dialog.tsx` (+ spec), `dialogs/post-visit-summary-dialog.tsx`,
`dialogs/visit-checkout.tsx`: the groups "Finished today" and "Not finished · continues next
visit" from the visit's sessions; `visits-list/visit-detail-panel.tsx` (+ spec),
`record/history-tab.tsx`, `dialogs/tooth-history-dialog.tsx`: a visit's unfinished work as
"started / continued, not finished · no charge", read from the chart's plans (`sessions` by visit
id; a voided visit's read as voided); `record/chart-tab.tsx` (+ spec): unfinished work in a
read-only block above the plan board, with **Cancel**; `locales/{en,ar,fr}/{clinical,visits}.json`.

Done when: the dialog spec covers its three show conditions and both answers; the summary and
detail-panel specs the new lines; web typecheck.

### 5. Docs

Files: `docs/modules/clinical.md`: the two routes, the removed `start`, the column;
`docs/superpowers/specs/2026-10-04-service-levels-patient-planning-multi-visit-design.md`: one
implementation note pointing to the new spec; the new spec's status and implementation notes.
CLAUDE.md needs no change: no table, module edge or rule changes.

### 6. e2e and review

Files: `apps/web/e2e/visit.spec.ts`: the multi-visit flow becomes — a root canal added in visit 1
and marked not finished; visit 2 opens with the popup, answered Continue, completed unfinished;
visit 3 completes it; only visit 3 carries the charge and the history shows the three visits.

Done when: lint, typecheck, API tests, web tests (`--maxWorkers=2`) and Playwright pass; one code
review over this change, findings fixed.
