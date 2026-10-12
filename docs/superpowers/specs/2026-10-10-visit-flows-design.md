# Feature 10: visit flows — design

Source: the feature 10 prompt (core model, V1–V18, screens 1–10, acceptance) and the round-3
design (`https://claude.ai/artifact/7ez55HCDnZDVZXaZ9Acbtp`). This page records only what the
prompt leaves open or what the code contradicts, as decisions D1–D34, and the contracts. Where a
decision narrows or re-reads the prompt it says so. Owner modules: `clinical`, `patients`, `files`,
`billing`. No new module and no new permission. One new reaction: `files` vetoes a diagnosis's
image link inside `clinical`'s transaction (D21); `files` already imports `clinical`.

The application has no deployed data. Retired concepts are dropped with their data, with no
backfill beyond a fixed value for new required columns (D33).

## Decisions

### Visit type and steps

| #   | Topic                            | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Type keys                        | `examination` · `emergency` · `treatment` · `hygiene` · `consultation` (`VISIT_TYPES`, Postgres enum `visit_type`). `visits.type` is required and never changes after start.                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D2  | Step keys                        | `intake` · `complaint` · `examine` · `findings` · `plan` · `today` · `perform` · `complete`. A label belongs to the pair (type, step): `plan` reads "Proposal" in a consultation, `perform` reads "Treat now" in an emergency and "Treatment" in an examination or consultation (D4).                                                                                                                                                                                                                                                                                                                                              |
| D3  | Step model is pure               | `packages/contracts/src/visit-flow.ts`: `stepsOf(type, facts)`, `stepLabelKey(type, step)`, `resolveStep(type, facts, stored)`, `doneSteps(type, facts)`, `suggestVisitType(facts)`. The API and the SPA call the same functions.                                                                                                                                                                                                                                                                                                                                                                                                  |
| D4  | Treatment step in an examination | **From the design, not in the prompt's table.** An examination or consultation has `perform` before `complete` while the visit holds a service that was not added automatically, or a session. It is derived, not stored; it goes when that work is removed.                                                                                                                                                                                                                                                                                                                                                                       |
| D5  | Stored step                      | `visits.current_step` (text, CHECK against the keys) and `visits.view_mode` (`steps` \| `all`). The step is stored by key. A stored step the visit no longer has (D4) resolves to the nearest earlier step. Both are last write wins, like notes (W6).                                                                                                                                                                                                                                                                                                                                                                             |
| D6  | Done is derived                  | **Re-reads "recorded in it".** The design keeps a flag per step, set while the step was open. Here a step is done when the visit holds what that step records, so an Undo removes the tick and a second device agrees. `intake`: history confirmed or a reason. `complaint`: reason, pain or since. `examine`: a diagnosis or presence recorded in this visit, or a file linked to it. `findings`: a diagnosis of this visit. `plan`: a plan made in this visit. `today`: a worklist item performed, continued or skipped. `perform`: a service not added automatically, or a session. `complete` is never ticked on a live visit. |
| D7  | Files in `doneSteps`             | The API does not know a visit's files (`clinical` cannot import `files`). `doneSteps` takes `fileCount` as a fact; the SPA passes it from the files query. The API never needs the ticks: the Today board shows the current step only.                                                                                                                                                                                                                                                                                                                                                                                             |
| D8  | Suggested type                   | The prompt's rule, not the design's: `treatment` when the patient has an open plan (planned or in progress); else the patient's `firstVisitType` when they have no counted visit; else `examination`.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D9  | Reason and complaint             | `visits.reason` (text, ≤ 500), `pain_score` (smallint 0–10, null = not rated), `pain_since` (enum `today` \| `days_1_3` \| `about_a_week` \| `longer`). CHECK: pain fields are null unless the type is `emergency`. Editable while the visit is live.                                                                                                                                                                                                                                                                                                                                                                              |

### Starting a visit and today's work

| #   | Topic                     | Decision                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D10 | One start call            | `start({ patientId, dentistId, roomId?, type, reason?, planIds? })`. In its transaction it adds the automatic service (D14) and the worklist (D11). `planIds` is accepted only for `treatment` (422 `visit.plans_not_allowed`); each must be the patient's open plan (422 `visit.plan_invalid`). A resumed visit ignores all of it.                                                                                               |
| D11 | Worklist                  | New table `visit_plan_items` (`visit_id`, `plan_id`, `skipped_at?`, `added_by`), primary key (visit, plan), composite foreign keys, hard delete. It is what "From the plan, for today" picked. _Not today_ sets `skipped_at`; its undo clears it. A hygiene visit picks the patient's open per-mouth plans by itself (design). It is not visit content: a visit with only a worklist can be discarded.                            |
| D12 | Sessions                  | Picking an in-progress plan logs nothing (**the design logs the session at start**). _Not finished_ on a row logs this visit's session, as today. `answerUnfinished`, `visits.unfinished_answered_at`, the unfinished card and dialog are deleted.                                                                                                                                                                                |
| D13 | "Session n of m"          | **Open point, see the end.** `n` is the plan's sessions before this visit + 1. `m` needs an estimate that nothing stores today and the design only seeds. Decision: `procedures.typical_sessions` (smallint 2–20, nullable), a "Sessions" field in the Catalog service row; copied to `treatment_plans.estimated_sessions` when planned. Without it the label is "session n". The default catalog sets 3 on root canal treatment. |
| D14 | Automatic service         | `procedures.added_on_visit_type` (nullable; one of the four types, never `treatment`), CHECK: only on a `per_mouth` service. Several services may name the same type; all are added, in code order. `visit_services.auto_added boolean`. Added at the catalog price at start, audited `visit_service.create` with `auto: true`. An inactive service is skipped.                                                                   |
| D15 | Discard                   | The discard rule ignores automatic services whose price and discount are untouched: such a visit is still empty. Other content rules are unchanged.                                                                                                                                                                                                                                                                               |
| D16 | `startOptions(patientId)` | One read for the popover: `{ suggestedType, plans }`, the open plans sorted in-progress first, then by priority, each with its session number and estimate. Replaces nothing in `startDefaults`.                                                                                                                                                                                                                                  |

### Treatment plan

| #   | Topic             | Decision                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D17 | Priority          | `treatment_plans.priority` (enum `urgent` \| `high` \| `elective`, required). The plan inputs require it; the SPA offers `high` first, as the design does. It changes while the plan is open (409 `plan.not_open`).                                                                                                                                                                                                            |
| D18 | Acceptance        | `accepted_at`, `accepted_by` (both or neither). `setAcceptance(planId, accepted)`: withdrawn only while `planned`. Starting or performing a plan that is not accepted accepts it, by the same actor: work done was agreed to.                                                                                                                                                                                                  |
| D19 | Who               | Priority and acceptance on the record: `chart:write`. In a visit, `visit:write` sets the priority of a plan made in that visit (it is charting in the visit, like the plan itself); nothing else.                                                                                                                                                                                                                              |
| D20 | Plan groups       | `plan_groups`, `treatment_plans.group_id`, their service methods, routes, audit actions, the dialog and the plan board's grouping are deleted. The quote and every plan list group by priority.                                                                                                                                                                                                                                |
| D21 | Seen on           | `patient_diagnoses.seen_on` (`clinical_exam` \| `image`, nullable = not said) and `seen_on_file_id` (set iff `image`). `clinical` publishes `DiagnosisEvidenceCited { recordId, patientId, fileId }` in the transaction; `files` handles it with `@OnDomainEventInTransaction` and refuses a file that is not this patient's live file (422 `record.evidence_invalid`). The pattern of ADR-0026. An archived file stays cited. |
| D22 | Viewer            | `ChartService.diagnosesCitingFiles(patientId)` → record ids, names and teeth per file id. `files` does not store the link; the SPA joins the two reads.                                                                                                                                                                                                                                                                        |
| D23 | Carried diagnoses | "Open from before, not planned" is derived: an active diagnosis recorded before this visit with no open plan linked to it. _Plan treatment_ is SPA state for the visit (the Plan step shows a card for it); nothing is stored until a treatment is chosen, which creates the plan with that `diagnosisRecordId`.                                                                                                               |
| D24 | Plan link         | `planTreatment` takes an optional `diagnosisRecordId` (the patient's active diagnosis on that tooth; 422 otherwise). Without it the rule of today applies (the tooth's latest active diagnosis).                                                                                                                                                                                                                               |

### Medical history

| #   | Topic        | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D25 | Owner        | `patients`. Lists: `medical_history_options` (`kind` `allergy` \| `condition`, `name`, `active`, soft delete; unique lower(name) per tenant and kind among live rows). A patient's items: `patient_medical_items` (patient, option), composite foreign keys, hard delete.                                                                                                                                                                     |
| D26 | Answers      | `patients.no_known_allergies`, `no_conditions` (booleans), `medication` (text). Not asked = no items and the flag false. The service refuses a flag together with items of its kind. "None known" and "None" are these flags, never list rows. `medical_alerts` is dropped.                                                                                                                                                                   |
| D27 | Lists        | Seeded on `TenantProvisioned` (ADR-0014) and by `POST /medical-history/options/seed-default` while both lists are empty. Read with `patient:read`, saved in one batch with `catalog:write`. An option a patient has cannot be deleted, only deactivated (409 `medical_option.in_use`: `patients` cannot import `clinical`'s error); an inactive option stays on the patients who have it and leaves the pickers. Renaming renames everywhere. |
| D28 | Editing      | History is part of the patient create and update inputs (`patient:write`), audited in `patient.update` with before and after names; `PatientUpdated` as today.                                                                                                                                                                                                                                                                                |
| D29 | Confirmation | Per visit: `visits.history_confirmed_at`, `history_confirmed_by`. `confirmHistory(visitId)` / its undo, `chart:write` (owner and dentist, V16), live visit only. Audited `visit.history_confirm`; event `MedicalHistoryConfirmed { visitId, patientId }`. A later edit does not unconfirm. The record's "not confirmed" line reads `ChartService.historyConfirmation(patientId)`: the latest confirmation over the patient's visits, or null. |
| D30 | Merge        | The kept record gets the union of both records' items; a "none" flag survives only if the merged list of its kind is empty; medication is a merge field like notes. Losing an allergy in a merge is the worse mistake.                                                                                                                                                                                                                        |
| D31 | First visit  | `patients.first_visit_type` (text, CHECK against the four types, nullable), set by the create panel's tiles. Read only by D8.                                                                                                                                                                                                                                                                                                                 |

### Structure

| #   | Topic             | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D32 | `clinical` inside | One module. `application/` splits by use case: `visits/` (lifecycle; flow: type, step, view, reason, complaint, confirmation; corrections: amend, void, checkout), `records/` (visit services, diagnoses, presence), `plan/` (treatment plan, sessions, worklist), `catalog/`, `reads/` (chart, start options, list). Each use case is a service of its own (no facades): `billing` and `files` import `VisitFactsService` and `VisitListService`. No service file above ~400 lines. `domain/`, `persistence/` and `http/` stay flat. The SPA gets `features/clinical/flow/` (stepper, footer, one file per step) over the existing cards; `visit-workspace-page` renders the step layout or, for All, today's layout. |
| D33 | Migrations        | Forward migrations from `0040`; no squash (it is not required). Drops: `plan_groups`, `group_id`, `medical_alerts`, `unfinished_answered_at`. Existing dev rows get `type = 'treatment'`, `current_step = 'complete'` for finished visits and the type's first step for live ones, `priority = 'elective'`. **Narrows V13:** old alert text is not moved into Medication.                                                                                                                                                                                                                                                                                                                                              |
| D34 | Events            | New: `MedicalHistoryConfirmed`, `TreatmentPrioritised { planId, patientId, priority }`, `TreatmentAccepted { planId, patientId, accepted }`, and the in-transaction `DiagnosisEvidenceCited`. `VisitStarted` gains `type`. Step, view, reason and complaint changes are audited directly (`visit.step`, `visit.update`) and emit nothing: no module reacts to them.                                                                                                                                                                                                                                                                                                                                                    |

Other narrowings:

- `visit.step` is audited with `area` null: every step change in the Activity feed would bury
  it. The prompt's "step changes … with readable Activity sentences" is met in the visit's own
  audit trail (`audit:read`), not the feed.
- Imports (feature 6) will pass `type: 'treatment'`; `current_step` for a visit created completed
  is `complete`.
- The Overview's _Needs attention_ is composed in the SPA (`needs-attention.ts`, pure, unit
  tested) from the chart, the last-visit and the balance reads. Order: in-progress work, accepted
  urgent plans, balance, "No examination yet".
- "Last hygiene visit" is a `ChartService.lastVisit(patientId, { type })` filter.
- `Dental Clinic POC/` is not in the repository; the artifact is the design source.

## Contracts (`packages/contracts`)

`visit-flow.ts` (new): D1–D3, `PAIN_SINCE`, `VISIT_VIEW_MODES`, and the `VisitFlowFacts` type.

`visits.ts`: `visitSchema` + `type`, `currentStep`, `viewMode`, `reason`, `painScore`,
`painSince`, `historyConfirmation` (`{ at, byName } | null`), `worklist`
(`{ planId, skipped }[]`); − `unfinishedAnsweredAt`. `visitServiceSchema` + `autoAdded`.
`startVisitInputSchema` (D10). `liveVisitRefSchema`, the list row and `visitNumberSchema` +
`type`; the live ref + `currentStep`. List filter `type`. New inputs: `setStepInput`,
`setViewInput`, `setReasonInput`, `setComplaintInput`. `startOptionsSchema` (D16).

`clinical-records.ts`: `treatmentPlanSchema` + `priority`, `acceptedAt`, `estimatedSessions`;
− `groupId` and every plan-group schema. `diagnosisRecordSchema` + `seenOn`, `seenOnFileId`.
Plan inputs + `priority`, `diagnosisRecordId?`. `setSeenOnInput`, `setPriorityInput`,
`setAcceptanceInput`. `PLAN_PRIORITIES`, `planPhases(plans)` (pure: per priority the open rows,
the done rows and the total; used by the tab, the Overview, the Plan step and the quote).

`catalog.ts`: `serviceItemSchema` + `addedOnVisitType`, `typicalSessions`.

`patients.ts`: `medicalHistorySchema` `{ allergies: { none, items }, conditions: { none, items },
medication }`, `medicalHistoryInputSchema` (option ids), `medicalHistoryOptionSchema` and its
batch input; the patient schemas + `medicalHistory`, `firstVisitType`; − `medicalAlerts`. The
list row carries the item names for the chips.

`audit.ts`: the new actions; − the plan-group and unfinished-answer ones.

## HTTP (new and changed)

| Route                                                                                                                          | Access          |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| `POST /visits` (D10), `GET /visits/start-options?patientId=`                                                                   | `visit:write`   |
| `PATCH /visits/:id/step`, `/view`, `/reason`, `/complaint` → `{ visit }`                                                       | `visit:write`   |
| `PUT` / `DELETE /visits/:id/history-confirmation` → `{ visit }`                                                                | `chart:write`   |
| `PUT` / `DELETE /visits/:id/worklist/:planId/skip` → `{ visit }`                                                               | `visit:write`   |
| `PATCH /visits/:id/diagnoses/:recordId/seen-on`, `PATCH /visits/:id/plans/:planId/priority`                                    | `visit:write`   |
| `PATCH /clinical/patients/:id/diagnoses/:recordId/seen-on` → `{ chart }`                                                       | `chart:write`   |
| `PATCH /clinical/patients/:id/plans/:planId` `{ priority?, note? }`, `PUT` / `DELETE …/plans/:planId/acceptance` → `{ chart }` | `chart:write`   |
| `GET /clinical/patients/:id/history-confirmation`, `GET /clinical/patients/:id/file-citations`                                 | `visit:read`    |
| `GET /medical-history/options`                                                                                                 | `patient:read`  |
| `PUT /medical-history/options`, `DELETE /medical-history/options/:id`, `POST …/:id/deactivate`, `POST …/seed-default`          | `catalog:write` |
| removed: `POST /visits/:id/unfinished-answer`, every `/plan-groups` route                                                      |                 |

## Slices

Each ends with lint, typecheck and its tests green.

1. **Retire and reshape**: migrations (D33), plan groups, medical alerts and the unfinished
   prompt removed from API, contracts, SPA, tests and locale files; `clinical` split (D32) with
   no behaviour change.
2. **Medical history**: D25–D31 without confirmation; Catalog tab; create panel; record header.
3. **Visit flow API**: D1–D24, D29, the pure step model and its unit tests, integration tests
   with tenant isolation for every new write.
4. **Flow screens**: start popover, stepper, the step screens, All view unchanged.
5. **Record and lists**: Overview, Treatment plan tab, Today board, Visits list, printables
   (quote by priority, type on receipt and invoice), the three Playwright stories, ADR-0044 to
   ADR-0049, module pages, `CLAUDE.md`.

ADRs: 0044 visit types and the derived step model; 0045 priority is the phase, plan groups
retired; 0046 structured medical history, confirmed per visit; 0047 default service per visit
type; 0048 the worklist replaces the unfinished prompt; 0049 a diagnosis cites a file, `files`
vetoes.

## Open point

D13: the prompt asks for "session n of m" and the acceptance for "session 2 of 3", but no screen
sets `m`. The decision above adds a "Sessions" field to the catalog service. The alternative is
to show "session n" only and drop `m` from the acceptance.
