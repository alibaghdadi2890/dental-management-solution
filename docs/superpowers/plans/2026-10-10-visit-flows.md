# Feature 10: visit flows — implementation plan

Status (2026-10-10): tasks 1–23 done; 24 (full verification and the review) in progress. Changes
from the plan as written:

- Task 1: `VisitsService` and `VisitRecordsService` were split into separate services with no
  facades (`VisitCorrectionsService`, `VisitListService`, `VisitFactsService`, `VisitFlowService`;
  `ServiceChartingService`, `DiagnosisChartingService`, `PresenceChartingService`,
  `PlanChartingService` over `VisitCharting`); `billing` and `files` import the two they use.
  Only `application/` is foldered; `domain/`, `persistence/` and `http/` stay flat.
- Migrations: `0040` (retire), `0041` + `0042` (medical history, in two steps because drizzle-kit
  asks interactively when a column is added and dropped together), `0043` (visit flows: one
  migration for tasks 10–12).
- Medical history: an option in use answers 409 `medical_option.in_use` (not `catalog.in_use`:
  `patients` cannot import `clinical`'s error).
- The default catalog gained EXAM, EMX, CONS and RCT from the round-3 design.
- `GET …/history-confirmation` answers `{ confirmation }`, so "never" is JSON.
- Task 17: _Not finished_ on a planned item needed the API to start a plan from a session:
  `recordSession` on a `planned` plan now starts it (ADR-0048).
- Task 18: the Treatment summary card's read is retired with it: `GET
/clinical/patients/:id/summary`, `ChartService.summary` and `clinicalSummarySchema` are gone.
  `needs-attention.ts` is covered by the Overview's screen tests, not a spec of its own.
- Task 20: the receipt needed the type on its lines: `chargeRefSchema` gained `visitType`.
- Task 22: the suites written before the flows start a Treatment visit and switch to All
  (`e2e/start-visit.ts`); the three stories are `e2e/visit-flows.spec.ts`.
- After first use (2026-10-12): the worklist is ticked on Today's work, not in the Start popover
  (ADR-0048, migration `0044`); the medical-history chips became type-ahead boxes that add new
  names (`POST /medical-history/options`, ADR-0046); Perform is a permanent, optional step of an
  examination and a consultation, so `resolveStep` and the API's `stepOf` are gone (ADR-0044).
- The carried diagnoses of the Plan step (D23) are kept in `sessionStorage` per visit, so a reload
  keeps them.

Spec: `docs/superpowers/specs/2026-10-10-visit-flows-design.md` (D1–D34) over the feature 10
prompt (V1–V18) and the round-3 design. Branch `feat/visit-flows`; the owner commits at the end.
Per task: the affected tests and that package's typecheck. Full lint, typecheck, tests, build,
Playwright and one review in task 24.

Paths are under `apps/api/src/modules/` (API) or `apps/web/src/features/` (web) unless they start
with `apps/`, `packages/` or `docs/`. Integration specs are in `apps/api/test/integration/`.
Every new string goes to `apps/web/src/locales/{en,ar,fr}/` in the task that adds it.

## Slice 1 — retire and reshape

No new behaviour. Ends with every remaining suite green.

### 1. Split `clinical` (D32)

Moves only; no logic change. `clinical/application/` becomes:

- `visits/`: `visit-lifecycle.service.ts` (start, pause, resume, notes, discount, discard,
  complete, get, live), `visit-corrections.service.ts` (amend, checkout discount, checkout, void),
  `visit-facts.service.ts` (`chargeFacts`, `visitMoney`, `numbersFor`, `refsFor`), `visit-mapping.ts`.
- `records/`: `visit-services.service.ts`, `visit-diagnoses.service.ts`,
  `visit-presence.service.ts`, `patient-records.service.ts`, `record-writer.ts`,
  `presence-writer.ts`, `record-mapping.ts`.
- `plan/`: `visit-plans.service.ts` (plan, perform, cancel, remove, unfinished, sessions),
  `plan-unperformer.ts`.
- `catalog/`: `catalog.service.ts`, `catalog-seeding.subscriber.ts`.
- `reads/`: `chart.service.ts`, `visit-list.service.ts` (search, summary, stats).
- `merge-clinical.subscriber.ts` stays at the root.

`VisitsService` and `VisitRecordsService` stay as thin exported facades over these (billing,
files and the controllers keep their imports). `domain/`, `persistence/` and `http/` get the same
five folders; `persistence/schema.ts` stays one file (drizzle-kit's glob).
Done when: api typecheck, lint (boundaries) and every clinical integration spec pass unchanged;
no application file is above ~400 lines.

### 2. Retire plan groups (D20)

Files: `clinical/persistence/schema.ts`, delete `plan-groups.repository.ts`,
`treatment-plans.repository.ts`, `records/patient-records.service.ts`, `record-writer.ts`,
`record-mapping.ts`, `reads/chart.service.ts`, `merge-clinical.subscriber.ts`,
`http/…/patient-records.controller.ts`; `packages/contracts/src/clinical-records.ts`, `audit.ts`;
web: delete `clinical/record/plan-group-dialog.tsx`, edit `patient-records-api.ts`,
`patient-charting-actions.ts`, `workspace/charting-actions.ts`, `workspace/plan-board.tsx` (flat
list for now), `audit/sentence.ts`; specs and locale keys that name groups.
Done when: `rg -i "plan.?group|groupId"` finds nothing outside migrations and old specs/plans/ADRs.

### 3. Retire the unfinished prompt (D12)

Files: `clinical/plan/visit-plans.service.ts` (− `answerUnfinished`), the visit-records
controller, `visits.repository.ts`, `visit-mapping.ts`, schema; contracts `visits.ts`,
`clinical-records.ts`, `audit.ts`; web: delete `clinical/dialogs/unfinished-dialog.tsx`,
`workspace/unfinished-card.tsx`, `unfinished-row.tsx`, `unfinished.ts`,
`visit-unfinished-lines.tsx` if only the prompt uses it; edit `visits-api.ts`,
`visit-mutations.ts`, `workspace/visit-workspace-page.tsx`, `record/chart-tab.tsx`,
`audit/sentence.ts`. `multi-visit.int-spec.ts` keeps Not finished / Continue / Complete and loses
the answer cases. Continue stays reachable from the tooth panel until task 14.
Done when: the multi-visit and visit-records specs pass; no "unfinished answer" string is left.

### 4. Migration `0040_retire_groups_and_prompt`

Files: `apps/api/migrations/0040_…sql` + snapshot + journal (drizzle-kit generate, reviewed).
Drops `plan_groups`, `treatment_plans.group_id`, `visits.unfinished_answered_at`.
Done when: applied to the local database; the integration container migrates from empty.

## Slice 2 — medical history

### 5. Contracts

Files: `packages/contracts/src/patients.ts` (+ spec): `MEDICAL_OPTION_KINDS`,
`medicalHistoryOptionSchema`, its batch input, `medicalHistorySchema`,
`medicalHistoryInputSchema`, `FIRST_VISIT_TYPES`; patient schemas + `medicalHistory`,
`firstVisitType`, − `medicalAlerts`; list row + `allergyNames`, `conditionNames`.
Done when: the spec covers: a "none" flag with items of its kind is refused; not asked is the
empty value; duplicate option ids are refused.

### 6. Storage and rules

Files: `patients/persistence/schema.ts` (D25, D26, D31), new `medical-options.repository.ts`,
`patient-medical-items.repository.ts`, `patients.repository.ts`, `patient-search.sql.ts`;
`patients/domain/medical-history.ts` (+ spec: `normaliseHistory`, `mergeHistories` D30, the
default lists), `domain/patient.ts`, `merge.ts` (+ spec), `patient-errors.ts`;
`apps/api/migrations/0041_medical_history.sql`.
Done when: domain specs pass; the migration drops `medical_alerts` and creates both tables with
RLS and composite foreign keys.

### 7. Services and routes

Files: `patients/application/medical-options.service.ts` (list, save batch, delete → 409
`catalog.in_use`, deactivate, seed default), `medical-options-seeding.subscriber.ts`
(`TenantProvisioned`), `patients.service.ts`, `patient-mapping.ts`, `patient-changes.ts` (history
in the audit before/after, by name), `http/medical-options.controller.ts`, `patients.module.ts`,
`index.ts`.
Tests: `patients.int-spec.ts` (create and update with history, the flag rule, an inactive option
stays on the patient, merge union), new `medical-options.int-spec.ts` (batch, in-use delete,
seed, `catalog:write` only), `tenant-isolation-services.int-spec.ts` (options and items).
Done when: those pass.

### 8. SPA

Files: new `patients/medical-history/` (`medical-options-api.ts`, `history-chips.tsx`: the two
chip rows with None and the Medication line, used by the create panel and later by Intake;
`alert-chips.tsx`: red and amber chips for headers and rows); `patients/patient-form.ts`,
`patient-form-fields.tsx`, `panels/patient-form-panel.tsx` (First visit tiles, _Create patient_ /
_Create and start {type}_ — the second navigates with the type for task 13), `merge-draft.ts`,
`panels/merge-panel.tsx`, `patients-table.tsx`, `panels/quick-view-panel.tsx`,
`record/record-header.tsx`, `clinical/workspace/visit-header.tsx`;
`clinical/catalog/catalog-page.tsx` + new `catalog/history-lists-tab.tsx` (V14: inline add,
rename, deactivate, the services' batch-save pattern); `audit/changes.ts`.
Done when: form, merge-draft and header specs pass; adding "Sulfa" in the Catalog shows it in the
create panel.

## Slice 3 — visit flow API

Each of tasks 10–12 ships its own migration (`0042_visit_flows`, `0043_plan_priority`,
`0044_seen_on`), with the fixed values of D33 for existing dev rows.

### 9. Step model (D1–D8)

Files: `packages/contracts/src/visit-flow.ts` (+ spec), `index.ts`.
Done when: the spec covers every type's steps; the Treatment step appearing and going in an
examination (D4); `resolveStep` falling back; each `doneSteps` rule and its undo; the three
branches of `suggestVisitType`.

### 10. Visit columns, start, flow writes

Files: `clinical/persistence/schema.ts` (`visit_type`, `current_step`, `view_mode`, `reason`,
pain fields, confirmation, `visit_plan_items`; `procedures.added_on_visit_type`,
`typical_sessions`; `visit_services.auto_added`), `visits.repository.ts`, new
`visit-plan-items.repository.ts`, `procedures.repository.ts`;
`clinical/domain/visits/discard-rule.ts` (+ spec, D15), `visit-errors.ts`;
`application/visits/visit-lifecycle.service.ts` (start per D10, D11, D14), new
`visits/visit-flow.service.ts` (`setStep`, `setView`, `setReason`, `setComplaint`,
`confirmHistory` and undo, `skipWorkItem` and undo), `reads/start-options.service.ts` (D16),
`catalog/catalog.service.ts` and `domain/catalog/default-catalog.ts` (+ spec: Added on for
Examination, Emergency examination, Scaling & polishing; 3 sessions on root canal),
`events/visit-events.ts` (`VisitStarted.type`, `MedicalHistoryConfirmed`), controllers,
contracts `visits.ts`, `catalog.ts`, `audit.ts`; `apps/api/migrations/0042_visit_flows.sql`.
Tests: `visits.int-spec.ts` — start per type adds the automatic service and nothing else;
`planIds` outside a treatment → 422; a hygiene visit picks per-mouth plans; discard with only the
untouched automatic service; step, view, reason, complaint round-trip; pain on a non-emergency →
422; confirmation needs `chart:write` and a live visit; skip and undo. `catalog.int-spec.ts` —
Added on only on `per_mouth`; clearing it stops the pre-add.
Done when: those and the tenant-isolation suite (new writes) pass.

### 11. Plan priority, acceptance, link (D17–D19, D23, D24)

Files: schema (`priority`, `accepted_at`, `accepted_by`, `estimated_sessions`),
`treatment-plans.repository.ts`, `domain/plan/plan-lifecycle.ts` (+ spec: priority only while
open; acceptance withdrawn only while planned; start and perform accept),
`plan/visit-plans.service.ts`, `records/patient-records.service.ts`, `record-writer.ts`,
`record-mapping.ts`, `events/record-events.ts`, controllers; contracts `clinical-records.ts`
(`PLAN_PRIORITIES`, `planPhases` + spec).
Tests: `patient-records.int-spec.ts`, `visit-records.int-spec.ts` (in a visit only this visit's
plan is re-prioritised with `visit:write`), `multi-visit.int-spec.ts` (session number and
estimate in `startOptions`).
Done when: those pass.

### 12. Seen on (D21, D22)

Files: schema (`seen_on`, `seen_on_file_id`), `patient-diagnoses.repository.ts`,
`records/visit-diagnoses.service.ts`, `records/patient-records.service.ts`,
`events/record-events.ts` (`DiagnosisEvidenceCited`), `reads/chart.service.ts`
(`diagnosesCitingFiles`, `historyConfirmation`, `lastVisit` type filter), `clinical/index.ts`;
`files/application/evidence-veto.subscriber.ts`, `files.module.ts`.
Tests: `visit-records.int-spec.ts` — cite the patient's file; another patient's file → 422 and
nothing written; an archived file stays cited. Tenant isolation: another tenant's file id → 422.
Done when: those pass; `docs/modules/files.md` names the reaction.

## Slice 4 — flow screens

### 13. Start visit (V1)

Files: `clinical/start-visit-popover.tsx` (+ spec), `use-starting-visit.ts`, `visits-api.ts`,
new `clinical/flow/visit-type-tiles.tsx`, `flow/plan-pick-list.tsx`.
Done when: the spec covers the suggested badge, Treatment revealing the rows with urgent and
in-progress pre-checked, a type pre-selected from the create panel, Start disabled without a
dentist.

### 14. Stepper shell (V2, screen 2)

Files: new `flow/use-visit-flow.ts` (steps, current, done from the contracts functions; step and
view mutations), `flow/visit-stepper.tsx` (+ spec: arrows, Enter, `aria-current`),
`flow/flow-footer.tsx`, `flow/steps-all-toggle.tsx`, `workspace/visit-header.tsx` (type, reason
line), `workspace/visit-workspace-page.tsx` (renders `flow/step-view.tsx` or the existing layout
for All).
Done when: a paused visit reopens on its stored step and view; All shows today's workspace with
the stepper still navigating.

### 15. Intake and Complaint (V3, V4)

Files: `flow/steps/intake-step.tsx`, `flow/history-card.tsx` (uses `history-chips.tsx`, the
Confirmed checkbox, the amber line), `flow/reason-field.tsx`, `flow/last-visit-card.tsx`,
`flow/open-treatment-list.tsx`, `flow/steps/complaint-step.tsx`, `flow/pain-slider.tsx`.
Done when: specs cover the confirmed and unconfirmed states and "Not rated" until moved.

### 16. Examine, Findings, Plan (V5–V7, screens 3–4)

Files: `flow/evidence-strip.tsx` (the files queries, feature 8's upload panel pre-filled),
`flow/steps/examine-step.tsx`, `workspace/tooth-panel/findings-panel.tsx` (findings mode; the All
panel untouched), `flow/seen-on-select.tsx`, `flow/steps/findings-step.tsx`,
`flow/carried-diagnoses.ts` (+ spec, D23), `flow/steps/plan-step.tsx`, `flow/proposal-card.tsx`,
`flow/priority-control.tsx`, `flow/phase-panels.tsx`; `files/viewer/` (the diagnoses citing the
image).
Done when: the diagnosis toast's _Plan treatment_ lands on Plan with that card focused; a carried
diagnosis shows one card and none once planned.

### 17. Today's work, Perform, Complete (V8–V10)

Files: `flow/steps/today-step.tsx`, `flow/work-card.tsx`, `flow/steps/perform-step.tsx`,
`flow/planned-today-rows.tsx` (Complete, Not finished, Undo, Before / After photo),
`flow/last-hygiene-line.tsx`, `flow/steps/complete-step.tsx`, `flow/this-visit-summary.ts`
(+ spec: the four sections, empty ones omitted, the Next visit line),
`workspace/todays-services.tsx` ("added automatically").
Done when: the summary spec passes; Complete visit runs the existing completion unchanged.

## Slice 5 — record, lists, printables, docs

### 18. Patient record (V11, V12)

Files: `patients/record/overview-tab.tsx` (six cards; Treatment summary and Patient information
out), `patients/record/needs-attention.ts` (+ spec), `patient-record-page.tsx` (tab order),
new `clinical/record/treatment-plan-tab.tsx`, `plan-phase-table.tsx`,
`clinical/workspace/plan-board.tsx` (by priority), `record/record-header.tsx` (the "not
confirmed" line).
Done when: the needs-attention spec gives the acceptance's three rows in order and "Nothing needs
attention"; changing a priority moves the row and both totals.

### 19. Today board, Visits list (V15)

Files: `today/chair-lane.tsx`, `checkout-lane.tsx`, `clinical/live-visit-pill.tsx`,
`clinical/visits-list/visits-table.tsx`, `visits-search.ts` (+ spec), `visit-detail-panel.tsx`;
API `reads/visit-list.service.ts`, `visit-search.sql.ts`, contracts `visit-list.ts`.
Test: `visits-list.int-spec.ts` gains the type filter.

### 20. Printables (screen 8)

Files: `billing/printables/quote-document.tsx` (phases, per-phase totals, one phase by query
parameter), `receipt-document.tsx`, `invoice-document.tsx`, `apps/web/src/routes/print/`;
API `billing/application/visit-views.service.ts` (type from `numbersFor`).

### 21. Audit sentences (V17)

Files: `audit/sentence.ts` (+ spec), `audit/changes.ts`, `locales/*/activity.json`: type and
reason at start, history confirmation, priority, acceptance, the automatic service, Seen on,
history edits. `visit.step` has no feed sentence (spec, narrowings).

### 22. Playwright

Files: `apps/web/e2e/`: Treatment continue, new-patient Examination end to end, Emergency (the
prompt's three stories); the existing flows updated for the start popover.

### 23. Docs

Files: `docs/adr/0044`–`0049` + `README.md`; `docs/modules/clinical.md`, `patients.md`,
`files.md`, `billing.md`, `audit.md`, `roles.md`; `CLAUDE.md` (module map rows for `clinical`,
`patients`, `files`; §13 flow folder; the POC sentence in §1).

### 24. Verify and review

Full lint, typecheck, unit, integration, build and Playwright; walk the prompt's acceptance list
in the running app; one code review over the branch; fix what it finds.
