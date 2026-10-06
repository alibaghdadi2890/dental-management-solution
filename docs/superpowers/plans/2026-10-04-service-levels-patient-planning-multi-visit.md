# Service levels, planning outside a visit, multi-visit work — implementation plan

Spec: `docs/superpowers/specs/2026-10-04-service-levels-patient-planning-multi-visit-design.md`
(L1–L3, P1–P7, M1–M7). Branch `feat/clinical-levels-planning-multivisit`, cut after the checkout
work is committed; the user commits at the end. Per task: run only the affected tests + that
package's typecheck. Full lint/typecheck/tests/Playwright and one branch review in task 10.

Migration numbers below were planned before the build; the migrations shipped as 0027–0029 (see
the spec's implementation notes).

Three steps, each usable alone: A (tasks 1–3) service levels, B (tasks 4–6) records outside a
visit, C (tasks 7–9) multi-visit work.

## A. Service levels

### 1. Contracts, schema, migration

Files: `packages/contracts/src/catalog.ts` (+ spec): `CHARGE_UNITS` + `per_mouth`;
`packages/contracts/src/clinical-records.ts` (+ spec): `JAWS` (`upper`, `lower`), `jawSchema`,
`jaw: Jaw | null` on `VisitService` and `TreatmentPlan`, `jaw?` on the add-service and
plan-treatment inputs; `packages/contracts/src/visit-list.ts`: `jaw` on the amendment snapshot's
service; `clinical/persistence/schema.ts`: `chargeUnit` + `per_mouth`, enum `jaw`, `jaw` column and
check `(jaw is not null) = (charge_unit::text = 'per_jaw')` on `treatment_plans` and
`visit_services`; `apps/api/migrations/0027_*.sql`: the enum values alone (`charge_unit` +
`per_mouth`, `plan_status` + `in_progress`, `create type jaw`) — `in_progress` ships here so step C
needs no second enum migration; `0028_*.sql`: generated, plus hand-added updates turning
`per_jaw` into `per_mouth` on `procedures`, `treatment_plans`, `visit_services` before the checks
are added; `clinical/domain/default-catalog.ts` (+ spec): the template's `per_jaw` rows become
`per_mouth`.

Done when: both migrations apply on a fresh DB and over the local dev DB; no row has `per_jaw`
without a jaw; contracts specs pass; contracts and api typecheck.

### 2. API: targets

Files: `clinical/domain/record-rules.ts` (+ spec): `assertTarget` over the three units
(`per_tooth` tooth and no jaw; `per_jaw` jaw and no tooth; `per_mouth` neither);
`clinical/domain/visit-errors.ts` (+ spec): `VisitJawRequiredError` (422 `visit.jaw_required`),
`VisitJawNotAllowedError` (422 `visit.jaw_not_allowed`);
`clinical/application/visit-records.service.ts`: `addService`, `planTreatment`, `performPlan` carry
`jaw`; `clinical/application/{record-mapping,visit-mapping}.ts` and
`clinical/persistence/{visit-services,treatment-plans}.repository.ts`: map `jaw`;
`clinical/domain/visit-amendment.ts` (+ spec): the snapshot keeps `jaw`; a jaw or mouth service
cannot change target in an amend (as per-jaw today).

Tests: `apps/api/test/integration/visit-records.int-spec.ts`: one `levels` block — a per-jaw
service upper and lower as two lines, a per-mouth service, a per-jaw plan performed keeps its jaw,
the four target errors; `catalog.int-spec.ts`: saving a `per_mouth` service.

Done when: those specs and the existing visit, corrections and billing-charge specs pass; api
typecheck.

### 3. Web: jaws & mouth

Files: `features/clinical/workspace/jaws-card.tsx` (+ spec, new): three rows (upper, lower, whole
mouth) listing today's services and open plans at that level from the visit and chart, **Add
service** and **Plan** opening the drawer with a `level` filter;
`workspace/catalog-drawer.tsx` (+ spec): `per_mouth` rows always enabled, `per_jaw` rows render
**Upper** / **Lower** buttons, the `level` filter hides `per_tooth` rows;
`workspace/charting-actions.ts`: `ChartTarget` gains `jaw`; `workspace/drawer-list.ts`: the filter;
`workspace/visit-workspace-page.tsx`: mount the card under the chart;
`workspace/plan-board.tsx` (+ spec): groups keyed by tooth, jaw or mouth with their labels;
`dialogs/visit-summary-dialog.tsx`, `visits-list/{visit-detail-panel,amend-form}.tsx`,
`record/build-threads.ts`: the level label where the tooth label goes (one shared
`useTargetLabel` in `chart/use-chart-settings.ts`); `catalog/catalog-row.tsx`: the unit select's
third option; `locales/{en,ar,fr}/{clinical,catalog,visits}.json`.

Done when: the drawer spec covers the three units and the filter, the jaws-card spec its rows and
buttons; web typecheck.

## B. Records outside a visit

### 4. Contracts, roles, schema

Files: `packages/contracts/src/permissions.ts` (+ spec): `chart:write`;
`apps/api/src/modules/roles/domain/system-roles.ts` (+ spec): owner and dentist;
`packages/contracts/src/clinical-records.ts`: `recordedInVisitId: string | null` on
`DiagnosisRecord` and `TreatmentPlan`, `cancelledInVisitId: string | null`, `groupId` on
`TreatmentPlan`, `PlanGroup` (`id`, `title`, `note`), `planGroupInputSchema`, the patient-level
inputs (`recordPatientDiagnosisInputSchema`, `planPatientTreatmentInputSchema` with `dentistId?`
and `groupId?`, `updatePlanInputSchema { groupId?, note? }`), `groupId?` on the in-visit
plan-treatment input; `packages/contracts/src/chart.ts`: `planGroups` on `PatientChart`;
`clinical/persistence/schema.ts`: both `recorded_in_visit_id` nullable, the cancel check relaxed
(`cancelled ⇒ cancelled_at`; `cancelled_in_visit_id` null unless cancelled), `plan_groups`,
`treatment_plans.group_id` with its composite FK; `apps/api/migrations/0029_*.sql`: generated,
plus the `chart:write` grants for system roles `owner` and `dentist`;
`clinical/events/record-events.ts`: `visitId: string | null` on `DiagnosisRecorded`,
`TreatmentPlanned`, `TreatmentCancelled`.

Done when: the migration applies fresh and over the dev DB; an existing tenant's dentist role
holds `chart:write`; contracts and roles matrix specs pass; contracts and api typecheck (fixing
the consumers of the now-nullable fields).

### 5. API: PatientRecordsService

Files: `clinical/application/patient-records.service.ts` (new): `recordDiagnosis`,
`removeDiagnosis`, `planTreatment`, `updatePlan`, `cancelPlan`, `removePlan`, `createGroup`,
`updateGroup`, `deleteGroup`; each re-checks `chart:write`, runs in one transaction, locks the
patient with `lockForDependentWrite` (P5), resolves the dentist (P4), reuses `assertTarget` and
the catalog snapshot helpers of `VisitRecordsService` (extract them to
`application/record-writer.ts` if they are private there), audits with the in-visit action names
and a null visit, publishes the events, answers `{ chart }`;
`clinical/persistence/plan-groups.repository.ts` (new);
`clinical/persistence/{patient-diagnoses,treatment-plans}.repository.ts`: nullable visit, group;
`clinical/domain/record-rules.ts` (+ spec): `isRemovableOutsideVisit` (no-visit record; a plan
also `planned`), and W13 treats a no-visit record as an older record (P6);
`clinical/domain/visit-errors.ts` (+ spec): `RecordDentistRequiredError`
(422 `record.dentist_required`);
`clinical/application/chart.service.ts`: no-visit records dated by `recorded_at` in the tenant
time zone, `planGroups`; `clinical/application/visit-records.service.ts`: `planTreatment` accepts
`groupId`; `clinical/application/merge-clinical.subscriber.ts`: `plan_groups` move, counted in the
audit; `clinical/http/clinical-patients.controller.ts`: the spec's nine routes with
`@RequirePermission('chart:write')`; `clinical/clinical.module.ts`, `clinical/index.ts`.

Tests: `apps/api/test/integration/patient-records.int-spec.ts` (new, one spec): a no-visit
diagnosis and plan appear on the chart with today's date; P2's refusals (no resolve, reopen,
perform route; removing a visit-recorded record → 409); P4's three cases; archived and merged
patients; groups (create, assign, move, delete ungroups); a visit later resolves the diagnosis and
performs the plan; refused without `chart:write`; `clinical-merge.int-spec.ts`: groups follow the
kept patient; `tenant-isolation-services.int-spec.ts`: tenant A cannot record on, or read groups
of, tenant B's patient; `tenant-isolation.int-spec.ts`: `plan_groups`.

Done when: those specs and the existing chart and visit-records specs pass; api typecheck.

### 6. Web: editable Chart tab

Files: `features/clinical/workspace/charting-actions.ts`: split the interface from its visit-bound
implementation; `features/clinical/record/patient-charting-actions.ts` (new): the patient-bound
implementation (record and remove diagnosis, plan, cancel, remove; the rest absent, so the shared
components hide those actions); `features/clinical/record/patient-records-api.ts` (new): the
mutations, each setting the chart query from `{ chart }`; `record/chart-tab.tsx` (+ spec):
with `chart:write`, the workspace's chart, tooth panel, jaws card, plan board and drawer in
Diagnosis and Plan modes, a dentist picker when the caller is not a dentist, a banner linking to
the patient's live visit; read-only otherwise (as today);
`workspace/tooth-panel/{diagnosis-section,plan-section}.tsx`: render only the actions the
provided `ChartingActions` has; `workspace/plan-board.tsx` (+ spec): named plans first with title
and estimate, **New plan**, a row menu to move a plan between groups;
`record/plan-group-dialog.tsx` (new): title and note; `locales/{en,ar,fr}/clinical.json`.

Done when: the chart-tab spec covers the gating (read-only without `chart:write`, no Perform or
resolve with it, the dentist picker) and the plan-board spec the grouping; web typecheck.

## C. Multi-visit work

### 7. Contracts, schema, domain

Files: `packages/contracts/src/clinical-records.ts` (+ spec): `PLAN_STATUSES` + `in_progress`,
`PlanSession` (`visitId`, `localDate`, `note`), `sessions` and `startedAt` on `TreatmentPlan`,
`start?` on the plan-treatment input, `recordSessionInputSchema { note? }`;
`packages/contracts/src/visits.ts`: `sessions` on `Visit` (plan id, name, target, note);
`packages/contracts/src/chart.ts` (+ spec): tooth state `in_progress` in `deriveChart` (above
`planned`, below treated today);
`clinical/persistence/schema.ts`: `started_in_visit_id`, `started_at` (both or neither),
`treatment_plan_sessions`; `apps/api/migrations/0030_*.sql`: generated;
`clinical/domain/plan-lifecycle.ts` (+ spec, new): `start`, `continue`, `done`, `cancel`,
`undoSession` (first session → `planned`), `undoDone` (sessions → `in_progress`, else `planned`);
illegal transitions throw `PlanNotOpenError` or the new `PlanNotInProgressError`
(409 `plan.not_in_progress`, in `visit-errors.ts` + spec);
`clinical/domain/discard-rule.ts` (+ spec): a session is content (M5);
`clinical/events/record-events.ts`: `TreatmentStarted`.

Done when: the lifecycle, discard-rule and `deriveChart` specs pass; the migration applies;
contracts and api typecheck.

### 8. API: sessions

Files: `clinical/persistence/plan-sessions.repository.ts` (new): upsert, soft delete, by plan ids,
by visit; `clinical/application/visit-records.service.ts`: `startPlan`, `recordSession`,
`removeSession`, `planTreatment` with `start`, `performPlan` and `cancelPlan` from `in_progress`,
all through `plan-lifecycle`; audits `treatment_plan.start` / `.session` / `.session_delete`;
`clinical/application/plan-unperformer.ts`: M4 (used by `removeService` and by amend);
`clinical/application/patient-records.service.ts`: `cancelPlan` from `in_progress`;
`clinical/application/{visit-mapping,record-mapping,chart.service}.ts`: sessions on the visit and
on plans, `in_progress` in the chart, `plannedProcedures` counts both open states;
`clinical/application/visits.service.ts`: `discard` reads the sessions for the rule;
`clinical/http/visit-records.controller.ts`: `POST /visits/:id/plans/:planId/start`, `PUT` and
`DELETE /visits/:id/plans/:planId/session`; `clinical/index.ts`: `TreatmentStarted`.

Tests: `apps/api/test/integration/multi-visit.int-spec.ts` (new, one spec): start in visit 1
(completes at total 0, no ledger charge), continue in visit 2, done in visit 3 with one charge on
visit 3; continue twice in one visit is one session; undo of the first session → `planned`; undo
of done and amend-removal of done → `in_progress`; cancel in progress in a visit and from the
patient record; a visit with only a session cannot be discarded; voiding visit 2 leaves the plan
`in_progress`; `tenant-isolation.int-spec.ts`: `treatment_plan_sessions`;
`tenant-isolation-services.int-spec.ts`: tenant A cannot start or continue tenant B's plan.

Done when: those specs and the existing visit-records, corrections and billing-charge specs pass;
api typecheck.

### 9. Web: in progress

Files: `workspace/charting-actions.ts`: `startPlan`, `continuePlan`, `undoSession`, with toasts
and Undo like perform; `workspace/tooth-panel/in-progress-section.tsx` (+ spec, new): session
count and dates, **Continue today** with an optional note (then "Continued today · Undo"),
**Mark done** with the price, **Cancel**; reused by `jaws-card.tsx` and `plan-board.tsx`;
`workspace/tooth-panel/plan-section.tsx`, `plan-board.tsx`: **Start** beside **Perform now**;
`workspace/catalog-drawer.tsx` (+ spec): the secondary **Start, finish later** action in Add
service mode; `chart/{glyph-style,chart-legend}.ts(x)`, `chart/tooth-glyph.tsx` (+ spec): the
`in_progress` state; `dialogs/visit-summary-dialog.tsx`, `dialogs/visit-checkout.tsx`,
`visits-list/visit-detail-panel.tsx`: a "Work in progress" block of the visit's sessions;
`record/chart-tab.tsx`: in-progress rows read-only apart from **Cancel**;
`locales/{en,ar,fr}/{clinical,visits}.json`.

Done when: the in-progress-section spec covers its three states and gating; the drawer spec the
start action; web typecheck.

## 10. Docs, e2e and review

Files: `docs/adr/0031-records-without-a-visit.md` (revises ADR-0022),
`docs/adr/0032-multi-visit-work-is-charged-when-done.md`, `docs/adr/README.md`;
`docs/modules/{clinical,roles}.md`; `CLAUDE.md` §4 `clinical` row (`plan_groups`,
`treatment_plan_sessions`, records outside a visit); the spec's status and implementation notes;
`apps/web/e2e/visit.spec.ts`: a whole-mouth polishing added from the Jaws & mouth card;
`apps/web/e2e/multi-visit.spec.ts` (new): a dentist plans a root canal on the patient record,
starts it in one visit, marks it done in the next; only the second visit carries the charge.

Done when: lint, typecheck, API tests, web tests (`--maxWorkers=2`) and Playwright pass; one code
review over the branch, findings fixed.
