# Feature 4a — Visit lifecycle and clinical workspace — design

Date: 2026-09-29 · Status: draft for review

## Goal

A dentist or assistant starts a visit from a patient's record. In one screen they examine the
chart, record diagnoses, plan treatment, perform services, price them, write notes, and complete
the visit. Completing it posts one charge to the patient ledger, and a summary shows _this visit
/ previous visits / total outstanding_. Diagnoses and plans live on the patient's tooth and are
dated by the visit that recorded them, so a plan made in visit 1 can be performed in visit 2.
The chart supports FDI and Universal notation, surface and simple detail, both orientations, and
primary, mixed and permanent dentition.

Design references: `Dental Clinic POC/ClinicalWorkspace.dc.html` and
`Dental Clinic POC/clinical-workspace-spec.md`, sections Screens 4 & 5, Diagnosis → Treatment
Plan → Completed Treatment, Selected Tooth Panel, Dental Chart, the drawer, Visit Summary,
Post-Visit Financial Summary, Tooth History modal, Settings — chart, and State Management. The
spec's "Universal, adult dentition only" is out of date: the POC renders all three dentitions.

Owner module: `clinical` (ADR-0001). It touches `patients` (dentition override, lock rename),
`tenancy` (chart settings), `users` (practitioners filtered by branch) and `billing` (visit
charges).

**Out of scope (4b and later):** the visits list and detail panel; amend and void; the record
tabs _Visits & history_, _Dental chart_ and _Balance & payments_; payments and receipts;
printables; scheduling; the Patients list's Last visit and Visits columns and its `notSeen`
count; missing and not-erupted tooth statuses; changing the dentist or room of a live visit.

## Decisions

The brief's V1–V11 stand, except where a W row below refines one. ✓ = confirmed by the product
owner in the 2026-09-29 Q&A.

| #    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | ADR  |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| W1✓  | **Live-visit invariants are enforced on `clinical`'s own table** (this refines V4, which would need locks on `patients` and `tenancy` rows and so conflicts with CLAUDE.md §4 rule 1). **Room:** a partial unique index `visits(tenant_id, room_id) where status in ('in_progress','paused') and room_id is not null`. **Patient:** `start` takes `pg_advisory_xact_lock` on a key derived from the patient id, then looks for a live visit and resumes it if one exists. **Merge exception:** after a merge, the kept patient can briefly have two live visits. Both stay usable, both complete normally, and the pill lists both.                                                                                                           | 0023 |
| W2✓  | **The visit charge is posted in the completion's own transaction, with no queue** (revised 2026-09-29: no new Redis use in 4a). `billing` subscribes to `VisitCompleted` with an **in-transaction handler** (W23). The handler writes the `visit_charge` entry and its lines in the same `TenantDb` transaction as the completion, so both commit or neither does. If the ledger write fails, the completion fails and the visit stays live. The summary reads the ledger directly, because the charge is already there when `complete` returns: _This visit_ = the charge (0 if none), _Previous_ = the balance minus the charge, _Total_ = the balance. A unique index on the entry's `visit_id` is a second guard against a double charge. | 0024 |
| W3✓  | **Third chart setting: `chartOrientation`**, from the POC Settings screen. Values `patient_right_on_right` (**default**, as in the POC) or `patient_right_on_left`. It flips the column order, the R/L markers and the ←/→ order together.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 0021 |
| W4✓  | **Discard visit**: allowed only while the visit is empty (see [Discard](#discard)). Status becomes `discarded`, the action is audited, `VisitDiscarded` is emitted, the room is freed, and nothing appears in any history. The dentist and room can't be changed on a live visit.                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 0023 |
| W5✓  | **Primary/permanent per position uses the POC's succession row**, not V2's header switch. The tooth panel shows the predecessor or successor as a link, plus **Mark exfoliated** / **Still present**. `tooth_status.present` is `primary \| permanent` only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 0022 |
| W6✓  | **Two people editing one live visit: last write wins, per field group.** Adds and removes are separate rows and never conflict. The workspace refetches on window focus, and every 10 s while it has no unsaved local edits.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | —    |
| W7✓  | **Room:** required when the current branch has at least one active room. Otherwise the popover hides the field and `room_id` is null, and the one-per-room rule applies only when a room is set.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | 0023 |
| W8✓  | **The Overview's Treatment summary card is filled in 4a.** Five counts come from `clinical`. _Lifetime billed_ is the sum of `visit_charge` entries, from `billing`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | —    |
| W9   | **Table names.** `diagnoses` is already the diagnosis catalog table, so diagnosis records go in **`patient_diagnoses`**. `treatment_plans` holds one row per planned procedure, and replaces the `planned_procedures` placeholder in `clinical.md`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 0022 |
| W10✓ | **Every actor column is the auth user id, taken directly from the request context** (`RequestContext.requireUserId()`), never a staff profile id. That covers `started_by`, `completed_by`, `discarded_by`, `recorded_by`, `changed_by` and `billing`'s existing `created_by`, and any `*_by` column added later. The one different column is `dentist_id`: it is not an actor field but the clinically responsible dentist, a staff profile id per ADR-0020, and it is the name the UI shows. V5's single `recordedById` therefore becomes `recorded_by` (who made the change) plus `dentist_id` (whose record it is), because an assistant or a platform admin (who has no staff profile) may make the change.                              | 0022 |
| W11  | **Diagnoses need a tooth** (the POC drawer says "select a tooth first"). Plans and services follow the catalog's `charge_unit`: `per_tooth` needs a tooth, `per_jaw` has none (422 either way). A jaw-level item has no upper/lower field. Diagnoses, plans and services all take the pending surface selection (V5).                                                                                                                                                                                                                                                                                                                                                                                                                         | —    |
| W12  | **One currency per visit**: the tenant currency when the visit starts. Adding a catalog item (or performing a plan) priced in another currency → 422 `visit.currency_mismatch`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | —    |
| W13  | **Removing** a service, diagnosis or plan recorded in the live visit is a soft delete (`deleted_at`), and is audited. Older diagnoses are **resolved**, and older plans **cancelled**. Undo toasts call the server (delete the service, or un-perform the plan).                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | —    |
| W14  | **Dentition override** lives on `patients` (`dentition_override`, V2). It is set from the chart card header in the workspace only. `PatientsService.setDentition` requires `visit:write`. No date of birth means `permanent`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | —    |
| W15  | **A tooth status change needs a live visit** and records `changed_in_visit_id`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 0022 |
| W16  | **After Complete**, the app goes to the record **Overview** (the Last visit card shows the new visit), with the post-visit summary open on top. The POC goes to _Visits & history_, which is 4b.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | —    |
| W17  | **The chart is never mirrored.** It renders `dir="ltr"` inside RTL layouts; the orientation setting is the only thing that flips it. Its text, labels and legend still follow the locale.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 0021 |
| W18  | **Frontdesk (`visit:read` only)** sees the workspace read-only if they open it, with no Start/Resume button and no live-visit pill. The pill lists live visits where the user is the dentist or the person who started it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | —    |
| W19  | **Duration leaves out paused time**: `ceil((completed_at − started_at − paused_seconds) / 60)`, minimum 1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | —    |
| W20  | A visit whose total is 0 (an examination, or a 100 % discount) **posts no ledger entry**, because the ledger rejects 0. Its summary shows 0 for _This visit_.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 0024 |
| W21  | **The `billing` → `clinical` edge arrives in 4a**, not in feature 5 as CLAUDE.md §4 says. `billing` reads `VisitsService.chargeFacts` and `visitMoney`, and consumes `VisitCompleted` in the transaction. `clinical` never imports `billing`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 0024 |
| W22  | `PatientsService.lockForLedger` is renamed **`lockForDependentWrite`** (same `FOR SHARE` behaviour), because `clinical`'s visit start now needs it too. `billing` callers are updated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 0023 |
| W23  | **New platform capability: in-transaction domain event handlers.** `@OnDomainEventInTransaction(name)` handlers run during `EventBus.publish`, inside the publisher's open `TenantDb` transaction, before commit. A thrown error rolls the whole transaction back. The existing after-commit dispatch (`@OnDomainEvent`, the audit subscriber) is unchanged. Rules: database work through `TenantDb` only (no HTTP, S3, LLM or queue calls); each handler writes only its own module's tables through its own services; and it stays fast, because it holds the publisher's locks. This amends CLAUDE.md §9: a reaction that must be atomic with the change subscribes in the transaction; a slow or external reaction still enqueues a job.  | 0024 |
| W24  | **The clinical merge re-point runs in the merge's transaction as well** (an in-transaction `PatientsMerged` handler, no job). A visit's `patient_id` is therefore always a live patient, and the charge posted at completion never lands on a merged-away record. **Lock order is patient, then visit:** `start` and `complete` take `lockForDependentWrite` (patient `FOR SHARE`) before the visit `FOR UPDATE`, and a merge takes patient `FOR UPDATE` before re-pointing visits, so the two can't deadlock.                                                                                                                                                                                                                                | 0023 |

## Module graph changes

```
clinical   patients, users, tenancy     visits, visit_services, patient_diagnoses,
                                        treatment_plans, tooth_status (+ procedures, diagnoses)
           consumes TenantProvisioned (provisioning), PatientsMerged (patients, in transaction — W24)
billing    patients, tenancy, users, clinical (new, W21)
           consumes PatientsMerged (patients, job — unchanged), VisitCompleted (clinical, in transaction — W2)
```

4a adds no queue, worker or other Redis use. The existing `merge-ledger` job in `billing` stays
as it is.

`clinical → patients` (existence, lock, dentition, age, survivor) and `clinical → users`
(practitioners, dentist names) are the edges CLAUDE.md §4 already plans. Nothing imports
`billing` or depends on `clinical` except `billing`, so the graph stays acyclic.

## Tooth model (`packages/contracts/src/tooth.ts`, V1)

Pure; exhaustive unit tests over all 52 codes in both notations.

- **Canonical code:** FDI two-digit text. Permanent `11–18, 21–28, 31–38, 41–48`; primary
  `51–55, 61–65, 71–75, 81–85`. `toothCodeSchema` accepts exactly those.
- **Quadrant** = first digit mod 4 (1 UR, 2 UL, 3 LL, 4 LR; primary 5–8 map onto 1–4).
  **Position** from the midline = second digit (1 central … 8 third molar; primary 1–5).
- `toFdi(code)` = the code. `toUniversal(code)`: permanent `1–32`, primary `A–T`, using the
  POC's mapping (UR `9−n`, UL `n+8`, LL `25−n`, LR `n+24`; primary letters from `PRIM_OF`).
  `parseTooth(text, notation)` does the reverse, for input.
- `label(code, notation)`: FDI `#16` / `#55`; Universal `#3` / `A` (primary letters are bare,
  as in the POC).
- `isAnterior` (position ≤ 3), `isUpper`, `mesialLeft(code, orientation)`,
  `surfaceCells(code, orientation)` → `[left, buccal, right, centre, lingual]`, where the centre
  is `I` for anterior teeth and `O` otherwise, and left/right resolve to M/D by quadrant and
  orientation.
- `successorOf(primary)` / `predecessorOf(permanent)` (positions 1–5 only).
  `positionKey(code)` = the permanent code of the column (e.g. `54` → `14`).
- `archColumns(orientation)` → the 16 upper and 16 lower permanent codes, left to right on
  screen. `keyboardOrder(orientation)` = upper row left to right, then lower row left to right,
  wrapping. This reproduces the POC's `1…16, 32…17`.
- `anatomicalName(code)` → an i18n key plus params (`quadrant`, `tooth`, `primary`), never
  English text.
- **Surfaces:** canonical keys `M D B L O I`. `surfacesSchema` rejects duplicates, and
  `validSurfaces(code, surfaces)` rejects `I` on posterior teeth and `O` on anterior ones.
- **Dentition** (`dentitionStage(ageYears | null, override)`): 0–5 primary, 6–12 mixed, 13+
  permanent, no age → permanent. `slotFor(stage, position)`: POC `slotFor`. Mixed: positions
  1–2 permanent, 3–5 primary, 6 permanent, 7–8 not erupted. Primary: 1–5 primary, 6–8 not
  erupted. `presentTooth(column, stage, toothStatus)` applies the per-position record (W5).

## Chart state (`packages/contracts/src/chart.ts`)

This pure derivation (spec §Derived values) runs in both the API (`ChartService`) and the web
app (so the compact chart and the workspace render from one function):

- Inputs: the patient's diagnoses, plans and completed services, plus the live visit's services
  if there is one.
- Per tooth: `state` = `treated_today` > `treated` > `planned` > `none`, and a per-surface state
  (the union of history and the live visit, live winning; a service with no surfaces counts as
  the whole tooth). Also `hasActiveDiagnosis`, `openPlans`, `historyCount`, and the hover/aria
  title parts.
- Simple mode changes only the rendering, never the derived data (spec: "never mutates data").

## Data model

All ids are uuid v7 generated by the application. Every table has `tenantIdColumn()`,
`tenantIsolationPolicy()`, an index on `tenant_id`, and `created_at`/`updated_at`. There are no
foreign keys to other modules' tables. Foreign keys inside `clinical` are composite with
`tenant_id` (the `rooms` pattern), so a row can never point at another tenant's row.

### `clinical`

| Table               | Columns                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Constraints / indexes                                                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `visits`            | `id`, `patient_id`, `branch_id`, `room_id?`, `dentist_id` (staff profile), `started_by` (auth user), `status` (`visit_status` enum: `in_progress`, `paused`, `completed`, `discarded`), `local_date` (tenant date at start), `started_at`, `paused_at?`, `paused_seconds int ≥ 0`, `completed_at?`, `completed_by?` (auth user), `discarded_at?`, `discarded_by?` (auth user), `duration_minutes?`, `notes text default ''`, `discount_mode` (`discount_mode` enum: `percent`, `amount`), `discount_value numeric(12,2) ≥ 0` (the raw entry, V7/spec invariant 2), `currency char(3)`, `subtotal?`, `discount_amount?`, `total?` (numeric(12,2), set at completion) | Unique room index (W1). Index `(tenant_id, patient_id, started_at desc)`. Index `(tenant_id, status)` where the visit is live. Checks: `paused_at` is set iff status is `paused`; `completed` ⇒ money, `completed_at` and duration are set. |
| `visit_services`    | `id`, `visit_id` → visits, `procedure_id` (catalog), snapshot `code`, `name`, `category?`, `charge_unit`, `tooth_code?`, `surfaces text[]`, `base_amount`, `discount_amount` (numeric(12,2)), `plan_id?` → treatment_plans, `recorded_by`, `deleted_at?`                                                                                                                                                                                                                                                                                                                                                                                                            | `0 ≤ discount_amount ≤ base_amount`. `tooth_code` is set iff `per_tooth`. Index `(tenant_id, visit_id)`. Partial unique `(tenant_id, plan_id) where deleted_at is null and plan_id is not null`.                                            |
| `patient_diagnoses` | `id`, `patient_id`, `tooth_code`, `surfaces text[]`, `diagnosis_id` (catalog), snapshot `code`, `name`, `category?`, `status` (`diagnosis_status`: `active`, `resolved`), `note?`, `dentist_id`, `recorded_by`, `recorded_in_visit_id` → visits, `recorded_at`, `resolved_in_visit_id?` → visits, `resolved_at?`, `deleted_at?`                                                                                                                                                                                                                                                                                                                                     | Index `(tenant_id, patient_id, tooth_code)`. `resolved` ⇒ resolved fields are set.                                                                                                                                                          |
| `treatment_plans`   | `id`, `patient_id`, `tooth_code?`, `surfaces text[]`, `procedure_id`, snapshot `code`, `name`, `category?`, `charge_unit`, `price_amount`, `price_currency`, `diagnosis_record_id?` → patient_diagnoses, `status` (`plan_status`: `planned`, `performed`, `cancelled`), `note?`, `dentist_id`, `recorded_by`, `recorded_in_visit_id` → visits, `recorded_at`, `performed_in_visit_id?`, `performed_at?`, `cancelled_in_visit_id?`, `cancelled_at?`, `deleted_at?`                                                                                                                                                                                                   | Index `(tenant_id, patient_id, tooth_code)`. The status fields are consistent with the status.                                                                                                                                              |
| `tooth_status`      | `id`, `patient_id`, `position` (permanent FDI code with position 1–5), `present` (`tooth_presence`: `primary`, `permanent`), `changed_in_visit_id` → visits, `changed_by`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Unique `(tenant_id, patient_id, position)`.                                                                                                                                                                                                 |

The status columns are Postgres enums: stable lifecycles that tenants can't extend (CLAUDE.md
§7). Catalog snapshots follow the spec's "base price is copied at add-time", so later catalog
edits never change a record. The migration is generated (next number after `0011`).

### `patients`

`dentition_override` (`dentition` enum: `primary`, `mixed`, `permanent`), nullable. Migration
generated.

### `tenancy`

On `tenants`: `chart_mode` (`chart_mode`: `surface`, `simple`; default `surface`),
`tooth_notation` (`tooth_notation`: `fdi`, `universal`; default `fdi`), `chart_orientation`
(`chart_orientation`: `patient_right_on_right`, `patient_right_on_left`; default
`patient_right_on_right`). Existing tenants get the defaults.

### `billing`

- `ledger_entry_kind` gains `visit_charge` (`ALTER TYPE … ADD VALUE`, in its own migration
  because Postgres won't use a new enum value in the transaction that adds it).
- `ledger_entries.visit_id uuid` (nullable). Check: set iff `kind = 'visit_charge'`. Partial
  unique index `(tenant_id, visit_id) where visit_id is not null`.
- `ledger_entry_lines` (V7 line snapshot, append-only): `id`, `entry_id` → ledger_entries
  (composite with tenant), `position`, `code`, `name`, `tooth_code?`, `surfaces text[]`,
  `amount` (the final price), `currency`. The grants follow `0011_ledger_append_only`: no
  `UPDATE`, `DELETE` or `TRUNCATE` for the runtime roles. Entries whose `patient_id` the existing
  `merge-ledger` job re-points keep their lines, because lines reference the entry, not the
  patient.

## Backend — `clinical`

```
clinical/
  domain/        visit-lifecycle.ts (state machine), visit-timer.ts (money: contracts' visit-money.ts, shared with the SPA),
                 discard-rule.ts, record-rules.ts (tooth/surface/charge-unit/currency checks),
                 visit-errors.ts, + existing catalog files
  persistence/   schema.ts (+5 tables), visits.repository.ts, visit-services.repository.ts,
                 patient-diagnoses.repository.ts, treatment-plans.repository.ts,
                 tooth-status.repository.ts
  application/   visits.service.ts, visit-records.service.ts, chart.service.ts,
                 merge-clinical.subscriber.ts (in-transaction), + catalog files
  http/          visits.controller.ts, clinical-patients.controller.ts, + catalog.controller.ts
  events/        visit-events.ts, record-events.ts, + catalog-changed.ts
```

### Domain rules (pure)

- **Lifecycle:** `in_progress ⇄ paused`; `in_progress | paused → completed`;
  `in_progress | paused → discarded` (only if empty). Any other transition throws
  `IllegalVisitTransitionError` (409 `visit.not_live` when the visit is completed or
  discarded).
- **Money** on integer cents (`bigint`), like `billing/domain/balances.ts`: `final = base − disc`;
  `subtotal = Σ final`; discount = `percent`: `round_half_up(subtotal × min(value,100) / 100)`,
  `amount`: `min(value, subtotal)`; `total = subtotal − discount`. `capped` is true when the raw
  value exceeds the cap (it drives the warning).
- **Timer:** `elapsedSeconds(now)` = (`completed_at` or `paused_at` or now) − `started_at` −
  `paused_seconds`. Resume adds `now − paused_at` to `paused_seconds`. Duration per W19.
- <a id="discard"></a>**Discard rule:** the visit has no non-deleted services, no non-deleted
  diagnoses or plans recorded in it, no diagnosis resolved in it, no plan performed or cancelled
  in it, no `tooth_status` row changed in it, and empty `notes`. A non-zero discount alone
  doesn't block a discard.

### `VisitsService` (lifecycle)

Every method takes one Zod-validated input and returns plain data (CLAUDE.md §11). Mutations
re-check the permission, run in one `TenantDb` transaction, lock the visit row `FOR UPDATE`,
refuse unless the visit is live (409 `visit.not_live`), audit before/after, and emit after
commit.

| Method                                     | Permission    | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start({ patientId, dentistId, roomId? })` | `visit:write` | Requires the session's active branch (else 422 `visit.branch_required`). Calls `PatientsService.lockForDependentWrite` (archived → 409 `patient.archived`, merged → 409 `patient.merged`), takes the advisory lock, and returns the existing live visit as `{ visit, resumed: true }` if there is one. The dentist must be an active dentist-type practitioner assigned to the branch (else 422 `visit.dentist_invalid`). The room must be an active room of the branch (else 422 `visit.room_invalid`), and is required per W7 (else 422 `visit.room_required`). A room already in use → 409 `visit.room_busy` (unique violation mapped). Stamps the tenant currency and `local_date`. Emits `VisitStarted`. |
| `pause(id)` / `resume(id)`                 | `visit:write` | Idempotent when the visit is already in that state. `VisitPaused` / `VisitResumed`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `updateNotes(id, { notes })`               | `visit:write` | ≤ 20,000 characters. Audit `visit.update` (field group `notes`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `setDiscount(id, { mode, value })`         | `visit:write` | Raw value ≥ 0, 2 decimal places. Audit `visit.update` (field group `discount`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `discard(id)`                              | `visit:write` | Discard rule, else 409 `visit.not_empty`. `VisitDiscarded`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `complete(id)`                             | `visit:write` | Locks the patient (`lockForDependentWrite`), then the visit (W24). Computes the money from the live rows, freezes `subtotal`, `discount_amount`, `total`, `duration_minutes`, `completed_at`, `completed_by`, and sets status `completed`. Publishes `VisitCompleted { visitId, patientId, currency, total, localDate }` (ids and minimal facts; `billing` reads the lines itself). `billing`'s in-transaction handler posts the charge before commit (W2). A second call → 409 `visit.not_live`, so a retried request can't double-charge. Returns the completed `Visit`.                                                                                                                                    |
| `get(id)`                                  | `visit:read`  | `Visit`: the visit, its services, computed money (live or frozen), timer fields, and `serverNow` so the client can render the timer from the offset. 404 `visit.not_found` (discarded visits too).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `live({ patientId? , mine? })`             | `visit:read`  | Live visit references `{ id, patientId, patientName, dentistName, status, startedAt, pausedSeconds, pausedAt }`. `mine` = the user is the dentist (via their staff profile) or `started_by` (W18).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `chargeFacts(visitId)`                     | `visit:read`  | For `billing`'s in-transaction handler: `{ patientId, currency, total, localDate, lines[] }` of a completed visit. It reads through the open transaction, so it sees the rows the completion has just written.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `visitMoney(visitId)`                      | `visit:read`  | `{ visitId, patientId, status, currency, subtotal, discount, total, completedAt, durationMinutes, serviceCount }` for `billing`'s summary route.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### `VisitRecordsService` (charting inside a live visit)

All of these need `visit:write` and a live visit. They are audited and soft-delete. The patient
is always the visit's `patient_id`, never a request field. The catalog item comes from
`CatalogService.getService/getDiagnosis`; an inactive item → 422 `catalog.inactive`.

| Method                                                                  | Notes                                                                                                                                                   |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `addService(visitId, { procedureId, toothCode?, surfaces })`            | W11/W12 checks; base = catalog price, disc 0.                                                                                                           |
| `updateService(visitId, serviceId, { baseAmount?, discountAmount? })`   | Last write wins (W6). `disc ≤ base`, else 422 at the field's path.                                                                                      |
| `removeService(visitId, serviceId)`                                     | If the service came from a plan, the plan goes back to `planned` (the undo of "perform").                                                               |
| `recordDiagnosis(visitId, { diagnosisId, toothCode, surfaces, note? })` | `DiagnosisRecorded`.                                                                                                                                    |
| `resolveDiagnosis` / `reopenDiagnosis(visitId, recordId)`               | Works on any of the patient's diagnoses. Resolve stamps `resolved_in_visit_id`, and reopen clears it. `DiagnosisResolved` / `DiagnosisReopened`.        |
| `removeDiagnosis(visitId, recordId)`                                    | Only if recorded in this visit, else 409 `record.not_removable`. Plans linked to it are unlinked.                                                       |
| `planTreatment(visitId, { procedureId, toothCode?, surfaces, note? })`  | Links the tooth's most recent active diagnosis (spec §drawer). `TreatmentPlanned`.                                                                      |
| `performPlan(visitId, planId)`                                          | The plan must be `planned`. Creates the service at the plan's price with `plan_id`, and marks the plan `performed` in this visit. `TreatmentPerformed`. |
| `cancelPlan(visitId, planId)`                                           | For plans from earlier visits. `TreatmentCancelled`.                                                                                                    |
| `removePlan(visitId, planId)`                                           | Only if recorded in this visit and still `planned`.                                                                                                     |
| `setToothPresence(visitId, { position, present })`                      | Upsert (W5, W15). `ToothStatusChanged`.                                                                                                                 |

### `ChartService` and patient reads (`visit:read`)

- `chart(patientId)` → `{ dentition: { stage, source: 'auto' | 'override', ageYears }, toothStatus[], diagnoses[], plans[], history[] (completed services with visit date and dentist name), liveVisitId? , teeth: derived per-tooth state }`. Dentist names come from `UsersService.practitionersByProfileIds`. A patient's records are bounded (hundreds), so nothing is paginated.
- `toothHistory(patientId, toothCode)` → the three stages in order (tooth history modal).
  A primary tooth also shows its successor, and a permanent tooth its predecessor.
- `lastVisit(patientId)` → the most recent completed visit: date, dentist, duration, total,
  service chips, notes. `null` if there is none.
- `summary(patientId)` → `{ visits, activeDiagnoses, plannedProcedures, teethTreated, servicesPerformed }` (W8).

`CatalogService.isInUse(id)` is true when any non-deleted `visit_services`,
`treatment_plans` or `patient_diagnoses` row refers to it (V11).

### Merge re-point (V10)

`MergeClinicalSubscriber` is an in-transaction handler of `PatientsMerged` (W23, W24), so it runs
inside the merge transaction, which already holds both patients `FOR UPDATE`:

1. Updates `visits.patient_id` from the dropped to the kept patient. A visit mutation in flight
   holds its visit row `FOR UPDATE`, so this statement waits for it, and later mutations read the
   new `patient_id`.
2. Updates `patient_diagnoses` and `treatment_plans`.
3. Merges `tooth_status` per position: the kept patient's row wins on a clash, and the dropped
   patient's row is deleted (it is a pure state row, not history).
4. Audits `clinical.repoint` on the kept patient with the counts, when anything moved.

A merge chain (A into B, then B into C) is covered because each merge re-points in its own
transaction. The handler is internal to `clinical` and not permission-gated: the merge itself
needs `patient:write`, and front desk may merge patients without holding `visit:write`. If the
re-point fails, the merge fails. Two live visits on the kept patient are allowed (W1).

### HTTP (`/api/v1`)

| Route                                                                                                                           | Access        |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `POST /visits` → 201 `{ visit, resumed:false }` or 200 `{ visit, resumed:true }`                                                | `visit:write` |
| `GET /visits/live?patientId=&mine=`                                                                                             | `visit:read`  |
| `GET /visits/start-defaults` → `{ dentistId, roomId }` (the popover's defaults, V3)                                             | `visit:write` |
| `GET /visits/:id`                                                                                                               | `visit:read`  |
| `POST /visits/:id/{pause,resume,discard,complete}`                                                                              | `visit:write` |
| `PATCH /visits/:id/notes`, `PATCH /visits/:id/discount`                                                                         | `visit:write` |
| `POST /visits/:id/services`, `PATCH /visits/:id/services/:serviceId`, `DELETE /visits/:id/services/:serviceId`                  | `visit:write` |
| `POST /visits/:id/diagnoses`, `POST /visits/:id/diagnoses/:recordId/{resolve,reopen}`, `DELETE /visits/:id/diagnoses/:recordId` | `visit:write` |
| `POST /visits/:id/plans`, `POST /visits/:id/plans/:planId/{perform,cancel}`, `DELETE /visits/:id/plans/:planId`                 | `visit:write` |
| `PUT /visits/:id/teeth/:position` `{ present }`                                                                                 | `visit:write` |
| `GET /clinical/patients/:id/{chart,summary,last-visit}`                                                                         | `visit:read`  |
| `GET /clinical/patients/:id/teeth/:toothCode/history`                                                                           | `visit:read`  |

Every mutation that changes the visit returns the updated `Visit`, so the client replaces its
cache without a refetch. Record mutations also invalidate the patient's `chart` query on the
client. Errors use RFC 7807 with the codes above. `Idempotency-Key` isn't needed: `start`
resumes, `complete` succeeds only once, and adds are undone with Remove.

### Events (V10)

`VisitStarted`, `VisitPaused`, `VisitResumed`, `VisitDiscarded`, `VisitCompleted`,
`DiagnosisRecorded`, `DiagnosisResolved`, `DiagnosisReopened`, `TreatmentPlanned`,
`TreatmentPerformed`, `TreatmentCancelled` and `ToothStatusChanged`. Payloads are ids plus
minimal facts. The generic subscriber audits each one. Service adds, edits and removes, notes
and discount are audited directly and emit no events.

## Backend — `patients`, `tenancy`, `users`, `billing`

- **`users`:** `listPractitioners({ branchId? })` restricts the list to dentists assigned to that
  branch (`staff_branches`). `GET /users/practitioners?branchId=` feeds the start popover, and
  `VisitsService.start` uses the same call to validate the dentist. `Practitioner` is
  unchanged.

- **`patients`:** `setDentition(id, { override: stage | null })` requires `visit:write` (W14),
  is audited as `patient.dentition` and returns the patient. `PUT /patients/:id/dentition`.
  `Patient` gains `dentitionOverride`. `lockForLedger` becomes `lockForDependentWrite` (W22).
- **`tenancy`:** `tenantSchema` and `tenantSettingsPatchSchema` gain `chartMode`,
  `toothNotation` and `chartOrientation` (`PATCH /tenant`, `tenant:write`). The session's
  `tenant` object gains the same three fields, so the SPA never makes a second call.
- **`billing`:**
  - `VisitChargeSubscriber`, an in-transaction handler of `VisitCompleted` (W2, W23), runs in
    the completing request's context and transaction. It reads `chargeFacts` and posts nothing
    if the total is 0 (W20). Otherwise it calls `lockForDependentWrite` (already held by
    `complete`) and inserts the `visit_charge` entry with `effective_date = local_date` and
    `created_by` = the request's user id (W10), then its lines. It audits `ledger_entry.create`,
    and `LedgerEntryRecorded` is dispatched after commit. The write is internal to `billing` and
    needs no `payment:write`, because the assistant who completes a visit doesn't hold it. The
    trigger is `complete`, which requires `visit:write`. A unique violation on `visit_id` is
    raised as an error, not ignored: it can only mean a bug, and it rolls back the completion.
  - `GET /billing/visits/:visitId/summary` (`payment:read`; `visitMoney` also needs
    `visit:read`) → `{ visit: { total, paid: 0, outstanding }, previous, totalOutstanding,
currency }`, computed per W2 in the visit's currency from the ledger alone. A live visit →
    409 `visit.not_live`. Balances in other currencies are left out (known gap).
  - `balanceOf` gains `charged: Money[]` (Σ `visit_charge` per currency) for _Lifetime billed_
    (W8).

## Frontend (`apps/web/src/features/clinical/`)

The POC is pixel-level for everything here. New components reuse `components/ui` (button, card,
right-panel for the drawer, confirm-dialog, toast, save-state, menu) styled to the POC tokens
already in the design system. New i18n namespace `clinical` (en/ar/fr); `settings` gains the
chart strings.

- **`chart/`**: `DentalChart` (props: derived teeth, `size` 12 | 8, mode, notation,
  orientation, `onToothClick`, `selected?`, `interactive`), `ToothGlyph` (surface grid or single
  cell, the enlarged 24 px variant with clickable surfaces, the 15 px read-only variant), and
  `ChartLegend`. A11y per the spec: an `aria-label` equal to the title, `aria-pressed`, and each
  arch as a `role="group"`. Primary glyphs sit at 0.78× in a constant-height box. Not-erupted
  columns show a muted italic number. The chart is `dir="ltr"` (W17).
- **Tooth labels everywhere** go through one `useToothLabel()` (the tenant's notation). The
  POC's placeholder copy with `#3` is written per notation (`#16` in FDI).
- **`workspace/`** (route `/_app/visits/$visitId`):
  - `VisitHeader`: patient chip, alerts, status and date, timer chip, Pause/Resume, and a
    **Discard visit** menu item shown only while the visit is empty.
  - `ChartCard`: legend, and the **Dentition** selector "Auto · Mixed (age 8)" / Primary /
    Mixed / Permanent / Back to auto (a toast on change).
  - `ToothPanel`: an empty state; three collapsible sections with their collapsed summaries;
    the succession row (W5); per-service Base / Discount / Final inputs.
  - `CatalogDrawer` (three modes; "Frequently used" from the `frequent` flag; category chips
    from the distinct categories; per-tooth rows disabled without a tooth).
  - `PlanBoard`, `NotesCard` (save-state), and `FinancialBar` (the wrap/cap rules, including
    `flex-wrap: wrap` and the `order: 9` warning).
  - Keyboard: ← → follow `keyboardOrder(orientation)`; `Esc` closes the topmost layer or
    deselects; these keys are ignored while focus is in an input.
- **Saving (V6):** each field group (notes, discount, one service's price) has its own
  debounced (700 ms) mutation and state `idle | saving | saved | failed`. On failure, the
  local value is kept and "Failed to save — retry" re-sends it. Adds, removes, perform, resolve
  and so on are immediate mutations with the POC's toasts and Undo where the spec lists one.
  Refetch per W6. **Save draft** only shows its toast.
- **Timer:** rendered from `startedAt`, `pausedSeconds`, `pausedAt` and the `serverNow`
  offset, updated every second. `mm:ss`, then `hh:mm:ss` after an hour.
- **Dialogs:** `VisitSummaryDialog` (the discount is live in both directions with the footer,
  because both edit the same mutation and cache; "Recorded for later" lists the diagnoses and
  plans recorded in this visit), `PostVisitSummaryDialog` (from
  `GET /billing/visits/:id/summary`; **Record payment** hidden until feature 5; _Pay later /
  Done_), `ToothHistoryDialog`, and a `StartVisitPopover` (dentist and room per V3/W7; a
  _Resume_ result navigates without a toast).
- **Shell:** the `LiveVisitPill` in `app-header.tsx` (`GET /visits/live?mine=true`, polled
  every 30 s and refetched on focus; a dropdown when there is more than one visit). The existing
  `/visits` placeholder page stays until 4b.
- **Record:** the header gets **Start visit / Resume visit** (`visit:write`; resumes the most
  recently started live visit). The Overview gets the compact read-only chart card (8 px; a
  click opens the tooth history), the **Last visit** card, and the **Treatment summary**
  counts (W8).
- **Settings:** the "Dental / tooth chart" section: **Chart detail**, **Notation** and
  **Orientation** card groups, each with its live preview, plus the static Dentition
  explanation. Without `tenant:write` the cards are disabled with a note (read-only).

## Testing

- **Unit (contracts):** `tooth.spec.ts` covers every code in both notations (round trip, quadrant,
  position, anterior, surfaces per orientation, succession, keyboard order, slots per stage).
  `chart.spec.ts` covers state precedence, surface union, whole-tooth services, and
  simple-mode invariance.
- **Unit (clinical domain):** lifecycle transitions, money (percent rounding, both caps, zero
  subtotal), the timer across pause/resume, duration rounding, and the discard rule.
- **Integration (Testcontainers, RLS on):** `visits.int-spec.ts`: start/resume, parallel starts
  for one patient (one visit), room busy, the room-required rule, pause/resume/complete money
  and duration, discard (empty vs not), a plan performed in visit 2 with its dates, tooth
  history order, `isInUse`, and the merge re-point including two live visits.
  `billing-visit-charge.int-spec.ts`: a charge with lines, committed with the completion; total
  0 → no entry; a failing ledger write rolls the completion back (the visit stays live); an
  assistant (no `payment:write`) completes and the charge posts; the summary matches the
  ledger (with an opening balance as _Previous_); a visit completed after a merge charges the
  kept patient; and `created_by`/`recorded_by`/`started_by`/`completed_by` hold the auth user
  id. `event-bus.spec.ts`: in-transaction handlers run before commit, a throw rolls back, and
  after-commit handlers still run only after commit. A permission matrix per V8 (frontdesk
  refused on every write).
- **Tenant isolation:** the five new tables are added to `tenant-isolation.int-spec.ts`, and
  `VisitsService` / `ChartService` reads to `tenant-isolation-services.int-spec.ts`.
- **Web (Vitest):** the chart (notation, orientation, dentition, states, keyboard), the tooth
  panel sections, the drawer modes, the financial bar cap, the save-state `failed` branch with
  retry, the discount live in both places, the start popover defaults, and the pill.
- **Playwright** (`e2e/visit.spec.ts`): start visit → select tooth → diagnosis → plan → perform
  → note → complete → the summary figures (with an opening balance as _Previous_); switching to
  Universal relabels `16` → `#3` and `55` → `A`; reloading in a fresh context resumes the same
  timer.

## Documentation

- `docs/modules/clinical.md` (rewritten for visits, records, chart, events, the in-transaction
  merge re-point; the Universal
  numbering line is replaced), `tenancy.md` (chart settings), `patients.md` (dentition,
  `lockForDependentWrite`), `billing.md` (`visit_charge`, lines, the in-transaction handler, the
  summary route,
  `charged`).
- ADRs:
  - **0021** Canonical FDI storage with notation and orientation as display settings (W3, W17).
  - **0022** Clinical records live on the tooth, dated by visit (V5, W5, W9, W10, W15).
  - **0023** Live-visit concurrency, rooms and discard (W1, W4, W7, W22).
  - **0024** In-transaction event handlers, and visit charges posted by `billing` from
    `VisitCompleted` in the completion's transaction (W2, W20, W21, W23).
- `CLAUDE.md` §4: the `clinical` row (tables, and depends on `patients`, `users`, `tenancy`;
  reacts to `PatientsMerged`), the `billing` row (`clinical` from 4a; reacts to
  `VisitCompleted`), the `tenancy` row (chart settings) and the `patients` row (dentition
  override). §9: in-transaction handlers for reactions that must be atomic with the change
  (W23). §7: every `*_by` actor column holds the auth user id (W10).

## Build order (PR-sized steps)

1. `contracts/tooth.ts` and `chart.ts` with tests; the tenancy chart settings (migration,
   contract, session, `PATCH /tenant`); ADR-0021.
2. `patients`: dentition override and the `lockForDependentWrite` rename (`billing` updated);
   `users`: practitioners by branch.
3. `clinical` schema and domain; `VisitsService` start/resume/pause/discard/notes/discount; the
   concurrency; ADR-0023.
4. `VisitRecordsService`, `ChartService`, patient reads, `isInUse`; ADR-0022. The merge
   re-point lands in step 5, once in-transaction handlers exist.
5. Platform: `@OnDomainEventInTransaction` with its tests. Then `complete`, `VisitCompleted`,
   `billing`'s in-transaction charge handler, lines, the summary route, `charged`; ADR-0024 and
   the CLAUDE.md §9 amendment.
6. Web: the chart components and the Settings section.
7. Web: the workspace (header, chart card, tooth panel, drawer, plan board, notes, financial
   bar), the start popover and the pill.
8. Web: the summary and post-visit dialogs, tooth history, the record header, the Overview
   cards.
9. Playwright, the tenant-isolation additions, and the docs sweep (module pages, CLAUDE.md §4).

Each step keeps lint, typecheck and tests green, and ships its docs and ADR.

## Known gaps

- **Coupled failure (by design):** a failing ledger write blocks completing the visit. That is
  the price of atomicity (W2): the visit stays live and the user can retry.
- **Longer transactions:** the completion and merge transactions do the charge and re-point
  work inline. Both are bounded by one visit's lines or one patient's records.
- The post-visit figures use the visit's currency only; balances in other currencies (after a
  tenant currency change) aren't shown there.
- Last write wins can drop an edit when two people edit the same field in the same second (W6).
- Missing and not-erupted tooth statuses, and changing the dentist or room of a live visit, wait
  for a design.
