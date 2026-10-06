# Service levels, planning outside a visit, multi-visit work — design

Date: 2026-10-04 · Status: Implemented (2026-10-04); see §Implementation notes

## Goal

Three gaps in the clinical record, from dentist feedback on the visit screen:

1. **Service levels.** Some services apply to a jaw or to the whole mouth (polishing, whitening,
   cleaning). They get their own catalog unit and a clear place to record them.
2. **Records outside a visit.** A dentist records diagnoses and treatment plans on the patient
   record without starting a visit, optionally grouping plans under a named plan.
3. **Multi-visit work.** One service may take two or three visits. It is "in progress" until the
   dentist marks it done, and it is charged only then.

Owner module: `clinical`, plus `roles` and `contracts` for one permission and the SPA. `billing` is
unchanged: a charge still comes only from a visit service at completion (ADR-0024). No new
dependency edge.

Built in the order 1, 2, 3 on one branch; each step is usable on its own.

**Out of scope:** performing, resolving or reopening outside a visit; tooth presence outside a
visit; a quote printable per named plan (the quote stays per patient); the jaw on invoices,
receipts and statements (`billing`'s ledger lines keep the service name only); partial charges for work in
progress; a catalog flag for multi-visit services; a plan status or approval on a named plan;
scheduling the next session.

## Decisions

| #   | Topic            | Decision                                                                                                                                                                                                                                                                                               |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L1  | Units            | `charge_unit` is `per_tooth \| per_jaw \| per_mouth`. The catalog sets it; the dentist never chooses the level.                                                                                                                                                                                        |
| L2  | Target           | A service or plan has a target that follows its unit: `per_tooth` a tooth (as today), `per_jaw` a `jaw` (`upper \| lower`), `per_mouth` neither. Both jaws = two lines, each at the per-jaw price. Wrong target → 422 `visit.jaw_required` / `visit.jaw_not_allowed` beside the existing tooth errors. |
| L3  | Existing rows    | Today's `per_jaw` rows carry no jaw and behave as whole mouth, so the migration turns them (catalog, plans, services, default template) into `per_mouth`. The owner re-marks true per-jaw services in the Catalog.                                                                                     |
| P1  | No-visit records | A diagnosis or a plan may be recorded without a visit: `recorded_in_visit_id` null, `recorded_at` = now. Revises ADR-0022 (records are dated by their own timestamp; the visit is optional context).                                                                                                   |
| P2  | What is allowed  | Outside a visit: record a diagnosis, remove a no-visit diagnosis; add a plan, remove a no-visit `planned` plan, cancel a `planned` or `in_progress` plan, manage named plans. Not allowed: resolve or reopen a diagnosis, perform, start or continue a plan, services, tooth presence.                 |
| P3  | Permission       | New `chart:write`: owner and dentist. In-visit charting stays on `visit:write`. The migration grants it to those system roles in every tenant.                                                                                                                                                         |
| P4  | Dentist          | `dentist_id` of a no-visit record: the given `dentistId`, else the caller's staff profile when they are a dentist, else 422 `record.dentist_required`. Must be an active dentist of the tenant (422 `visit.dentist_invalid`).                                                                          |
| P5  | Patient state    | Locks the patient with `lockForDependentWrite`; archived → 409 `patient.archived`, merged → 409 `patient.merged`.                                                                                                                                                                                      |
| P6  | Inside a visit   | A no-visit record is an "older record" for W13: a visit resolves the diagnosis or cancels the plan, never removes it.                                                                                                                                                                                  |
| P7  | Named plans      | `plan_groups` (patient, title, note). A plan has an optional `group_id`. Deleting a group ungroups its plans. A group has no status and no money of its own; its estimate is the sum of its open plans.                                                                                                |
| M1  | Lifecycle        | `planned → in_progress → performed`; `cancelled` from `planned` or `in_progress`. Any service can be multi-visit.                                                                                                                                                                                      |
| M2  | Sessions         | `treatment_plan_sessions`: one row per plan and visit, optional note, no money. Start logs the first one; **Continue today** logs one in a later visit (idempotent per visit).                                                                                                                         |
| M3  | Charge           | **Mark done** is today's perform on an `in_progress` plan: it creates the visit service at the plan's price snapshot in that visit. Nothing is charged before. Abandoned work is cancelled at no charge; partial work is billed by adding an ordinary service.                                         |
| M4  | Undo             | Removing a session made in this visit: the first session returns the plan to `planned`. Removing the done service (live, or by amend) returns the plan to `in_progress` when it has sessions, else to `planned` (as today).                                                                            |
| M5  | Visit content    | A session counts as visit content: the visit cannot be discarded. A visit with only sessions completes with total 0.                                                                                                                                                                                   |
| M6  | Voided visits    | Sessions of a voided visit stay and read as voided through `voidedVisitIds`; the plan's status is not rewound (as for other records, D18).                                                                                                                                                             |
| M7  | Chart            | `deriveChart` gains the state `in_progress` for a tooth with an in-progress plan; it wins over `planned`, loses to today's treated. The summary's `plannedProcedures` counts `planned` and `in_progress`.                                                                                              |

## Data model

Migration A (enum values alone, so later statements may use them): `charge_unit` + `per_mouth`;
`plan_status` + `in_progress`; new enum `jaw` (`upper`, `lower`).

Migration B:

- `procedures`, `treatment_plans`, `visit_services`: `per_jaw` → `per_mouth` (L3).
- `treatment_plans`, `visit_services`: `jaw jaw null`; check `(jaw is not null) = (charge_unit = 'per_jaw')`
  beside the existing tooth check.
- `patient_diagnoses.recorded_in_visit_id` and `treatment_plans.recorded_in_visit_id` nullable.
- `treatment_plans.cancelled_in_visit_id` optional: the check becomes `cancelled ⇒ cancelled_at`,
  and `cancelled_in_visit_id is null` unless cancelled.
- `treatment_plans`: `started_in_visit_id?`, `started_at?` (both set iff the plan was started;
  kept once performed), `group_id?` (composite FK to `plan_groups`).
- `plan_groups`: `id`, `tenant_id`, `patient_id`, `title` (1–120), `note?`, `created_by`,
  `deleted_at?`, timestamps; unique `(tenant_id, id)`; index `(tenant_id, patient_id)`; RLS.
- `treatment_plan_sessions`: `id`, `tenant_id`, `plan_id`, `visit_id` (composite FKs), `note?`,
  `recorded_by`, `deleted_at?`, timestamps; unique `(tenant_id, plan_id, visit_id) where deleted_at is null`;
  index `(tenant_id, visit_id)`; RLS.
- Grants: `chart:write` for system roles `owner` and `dentist`.

Checks on new enum values compare as text (the 0019 pattern).

## Contracts

- `permissions.ts`: `chart:write`.
- `CHARGE_UNITS` + `per_mouth`; `JAWS`; `PLAN_STATUSES` + `in_progress`.
- `VisitService`, `TreatmentPlan`: `jaw: Jaw | null`. `TreatmentPlan`: `groupId`, `startedAt`,
  `sessions: { visitId, localDate, note }[]`. `DiagnosisRecord` / `TreatmentPlan`:
  `recordedInVisitId: string | null`.
- `Visit`: `sessions` (the visit's sessions with the plan's name and target).
- `PatientChart`: `planGroups`; tooth state `in_progress`.
- Inputs: add-service and plan-treatment gain `jaw?`; plan-treatment gains `groupId?`, `start?`;
  `recordSessionInputSchema { note? }`; the patient-level inputs add `dentistId?`;
  `planGroupInputSchema { title, note? }`.
- Events: `visitId` becomes nullable on `DiagnosisRecorded`, `TreatmentPlanned`,
  `TreatmentCancelled`; new `TreatmentStarted { planId, visitId, patientId, toothCode }`.

## API

**In a visit** (`VisitRecordsService`, `visit:write`, existing locks):

- `addService`, `planTreatment`: accept `jaw`; `assertTarget` covers the three units.
  `planTreatment` with `start: true` plans and starts in one call ("Start, finish later").
- `startPlan(visitId, planId)`: `planned` → `in_progress`, first session. Audit
  `treatment_plan.start`; `TreatmentStarted`.
- `recordSession(visitId, planId, { note? })`: `in_progress` only (409 `plan.not_in_progress`);
  upserts this visit's session. Audit `treatment_plan.session`.
- `removeSession(visitId, planId)`: this visit's session only; M4.
- `performPlan`: accepts `planned` or `in_progress`.
- `cancelPlan`: accepts `in_progress` too.

Routes: `POST /visits/:id/plans/:planId/start`, `PUT` and `DELETE /visits/:id/plans/:planId/session`.

**On the patient** (new `PatientRecordsService`, `chart:write`, P4–P5, audited like their
in-visit twins with a null visit):

| Route                                                                     | Notes                                                                      |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `POST /clinical/patients/:id/diagnoses`                                   | `{ diagnosisId, toothCode, surfaces, note?, dentistId? }`                  |
| `DELETE /clinical/patients/:id/diagnoses/:recordId`                       | No-visit records only (409 `record.not_removable`).                        |
| `POST /clinical/patients/:id/plans`                                       | `{ procedureId, toothCode?, jaw?, surfaces, note?, groupId?, dentistId? }` |
| `PATCH /clinical/patients/:id/plans/:planId`                              | `{ groupId?, note? }`; any open plan.                                      |
| `POST /clinical/patients/:id/plans/:planId/cancel`                        | `planned` or `in_progress`.                                                |
| `DELETE /clinical/patients/:id/plans/:planId`                             | No-visit and `planned` only.                                               |
| `POST` / `PATCH` / `DELETE /clinical/patients/:id/plan-groups[/:groupId]` | Delete ungroups and soft-deletes.                                          |

Each answers `{ chart }` so the SPA refreshes in one round trip.

`ChartService`: no-visit records carry their own date; `chart` adds `planGroups` and sessions.
`MergeClinicalSubscriber`: `plan_groups` move with the patient (sessions follow their plans).
Amend: removing a done service follows M4. Discard rule: M5.

## SPA

**Workspace**

- **Jaws & mouth card** under the chart: three rows (Upper jaw, Lower jaw, Whole mouth) with
  today's services, open plans and ongoing work at that level, and **Add service** / **Plan**
  buttons that open the drawer filtered to `per_jaw` and `per_mouth`.
- **Drawer:** a `per_mouth` row is always one click; a `per_jaw` row shows **Upper** and **Lower**
  buttons; a `per_tooth` row needs a selected tooth (as today). In Add service mode each row has a
  secondary **Start, finish later** action.
- **Plan rows** (tooth panel, plan board, jaws card): **Perform now** and **Start**.
- **In progress** section (same three places): the session count and dates, **Continue today**
  (optional note; becomes "Continued today · Undo" once logged) and **Mark done** with the price.
- **Plan board:** grouped by named plan first (title, per-group estimate), then the ungrouped
  plans as today; the level label is "Upper jaw", "Lower jaw" or "Whole mouth".
- Chart legend and glyph: the `in_progress` state.
- Visit summary and checkout dialog: a "Work in progress" block listing the visit's sessions at no
  charge; amend form shows jaw labels.

**Patient record → Chart tab** (editable with `chart:write`): the workspace's chart, tooth panel,
jaws card, plan board and drawer, driven by a patient-bound `ChartingActions` that exposes only
P2's actions (Diagnosis and Plan modes; no Perform, Start, resolve). A **New plan** button creates
a named plan; a plan row's menu moves it between groups. When the patient has a live visit, a
banner links to it.

**Catalog:** the unit select gains "Whole mouth".

Strings in `en`, `ar`, `fr`.

## Tests

- Domain: `assertTarget` for the three units; the plan state machine (start, session, done, cancel,
  the M4 undo rules); `deriveChart` with `in_progress`; the discard rule with a session.
- Integration, one spec per step: (1) jaw and mouth services and plans, the target errors, the
  migration's `per_jaw → per_mouth`; (2) no-visit diagnosis and plan, P2's refusals, P4, P5, named
  plans, the merge re-point; (3) start in visit 1, continue in visit 2, done in visit 3 with one
  charge on visit 3 only, undo and amend per M4, cancel in progress, a sessions-only visit.
- Tenant isolation: `plan_groups`, `treatment_plan_sessions`, and the patient-level routes.
- Roles: the matrix test with `chart:write`.
- SPA: the drawer's unit branching; the patient-bound actions' gating; the in-progress row states.
- Playwright: a dentist plans a root canal on the patient record, starts it in one visit,
  finishes it in the next; the charge appears only on the second visit. A whole-mouth polishing is
  added from the Jaws & mouth card.

## Implementation notes

- **Migrations** are 0027 (`service_levels`), 0028 (`records_without_visit`) and 0029
  (`multi_visit_work`), one per step. A value added with `ALTER TYPE … ADD VALUE` cannot be written
  in the same transaction, and L3 rewrites rows to `per_mouth`, so 0027 rebuilds the `charge_unit`
  type instead (rename, create, convert the three columns, drop). 0029 adds `in_progress` the
  ordinary way: no migration writes it.
- The default template keeps "Periodontal treatment / jaw" as `per_jaw` and makes "Scaling &
  polishing" `per_mouth`; existing tenants' rows all became `per_mouth` (L3).
- `recordedInVisitDate` was renamed `recordedDate` in the contract: it is the visit's date, or the
  tenant-local date of `recordedAt` without a visit.
- `Visit` carries no `sessions`: the SPA reads them from the chart's plans, which every charting
  write refreshes. The visit summary lists them under "Recorded for later"; the visits list's detail
  panel does not show them.
- **Continue today** sends no note: the API stores one, the SPA does not ask for it yet.
- **Start, finish later** in the drawer is offered on per-tooth and whole-mouth rows; a per-jaw
  service is planned first, then started from its row.
- The Jaws & mouth card also gives a jaw or whole-mouth plan its **Remove** or **Cancel**, which
  no screen offered before.
- The plan board shows a plan's named-plan select and **Remove** / **Cancel** on the patient
  record only; in a visit it shows **Perform now** and **Start**.
- The shared components take the scope from `ChartingActions.scope` (`visit` or `patient`) rather
  than from a missing action; `PlanGroupActions` is passed to the plan board on the record only.
- **Chart redesign (2026-10-05, replaces the Jaws & mouth card):** the chart carries a bar over
  each jaw and a Whole mouth pill on the midline, each selectable like a tooth (with the count of
  today's services at that level). The aside shows the selected level — its plans, today's
  treatment with prices, earlier treatment — with tabs for the three levels; a tooth shows the
  tooth panel as before. The drawer lists only the selected level's services, and a per-jaw row
  commits on the selected jaw in one click. A **Today's services** card lists every service of
  the visit, whatever its level. The same chart and panel serve the patient record's Chart tab.
- **Less text (2026-10-05):** the visit screen's explanatory copy is gone (section subtitles and
  hints, empty-state bodies, the drawer footers, the summary dialog's notes, "→ today" on Perform
  now, the "not billed until…" tails of toasts and strips). Titles, states and errors stay.
- **Two charts instead of the mixed chart (2026-10-05):** dentists did not work with the mixed
  chart, so every patient now has two — primary teeth (20) and permanent teeth (32) — with a
  toggle on the chart card. The chart that opens follows the age (primary up to 12, permanent
  from 13 or without a date of birth); switching is remembered on the patient
  (`dentition_override`, with `visit:write`; a viewer without it switches for themselves only).
  There is no "back to automatic". Selecting a tooth of the other chart (a plan board link,
  `?tooth=`) brings that chart. `DENTITION_STAGES` lost `mixed`; migration 0030 rebuilds the
  `dentition` enum and clears overrides that were `mixed`.
- With two charts, which tooth "is present" in a position no longer decides what the chart
  shows, so the SPA dropped the succession row (Mark exfoliated / Still present) and ignores
  `tooth_status`. The API still has `PUT /visits/:id/teeth/:position`, the table and the
  `ToothStatusChanged` event; retiring them is a follow-up.
- From the branch review: a no-visit diagnosis that a visit has resolved is no longer removable
  from the record (409 `record.not_removable`); undoing the starting visit's session moves the
  plan's start to the oldest session left; `updatePlan` locks the target group before the plan.
- **Unfinished services (2026-10-05, replaces the Start and In progress UI):** work over several
  visits is now added as an ordinary service and marked **Not finished**; a visit opens with the
  question which unfinished services it continues; the rows live in Today's services, not in the
  Treatment plan card. `startPlan`, its route and the `start` input are gone. See
  `2026-10-05-unfinished-services-design.md`.
- Known limits: the patient-level routes answer with the chart, so `chart:write` needs
  `visit:read` beside it (every system role that has the first has the second); a double Start, or
  a stale Undo toast, answers 409 rather than being idempotent.
- Not done: the invoice, receipt and statement still show "—" where a tooth would be for a jaw or
  whole-mouth line (out of scope, `billing`'s ledger lines).

## Docs

ADR-0031 (records without a visit; revises ADR-0022), ADR-0032 (multi-visit work: sessions, charge
at done); `docs/modules/clinical.md`, `roles.md`; CLAUDE.md §4 `clinical` row (`plan_groups`,
`treatment_plan_sessions`).
