# `clinical` module

**Status:** implemented for features 2, 4a and 4b. The service and diagnosis catalogs (feature 2);
the visit lifecycle (start, resume, pause, notes, discount, discard, complete, live visits),
charting in a visit (services, diagnoses, plans, tooth presence), the patient's chart reads
(chart, tooth history, last visit, summary), the merge re-point and the SPA's visit workspace
(feature 4a); the visits list, amend and void of a completed visit, the per-patient visit stats
and the record's history and chart tabs (feature 4b, spec
`2026-10-01-visits-list-amend-void-design.md`); service levels, charting on the patient record
and work over several visits (spec
`2026-10-04-service-levels-patient-planning-multi-visit-design.md`, ADR-0031, ADR-0032).

## Purpose

Clinical work on a patient:

- **Visits**: encounters with a dentist, room, date, timer, services performed with
  tooth/surfaces, notes, discount and status (feature 4a); amended or voided with a reason
  (feature 4b).
- **The per-tenant catalogs**: services (what the clinic charges for) and diagnoses (what dentists
  record).
- **The clinical record**: diagnoses and treatment plans on the patient's teeth, jaws and mouth,
  recorded in a visit or on the patient record (ADR-0031), optionally grouped under named plans;
  work that takes several visits (ADR-0032); and which tooth is present at each succession
  position (feature 4a).

Teeth are stored as canonical FDI codes (`11`–`48`, primary `51`–`85`); FDI or Universal
notation, the orientation and the chart detail are tenant display settings (ADR-0021). This
module was renamed from `treatments` (ADR-0001) and owns the catalogs (ADR-0002).

### Catalogs

- Every tenant starts with the POC's default template (`domain/default-catalog.ts`: 12 services
  with prices, 14 diagnoses, the workspace spec's "Frequently used" rows). It is seeded
  on `TenantProvisioned` by a system task (ADR-0014) and by the idempotent
  `POST /catalog/seed-default`, which seeds only while both catalogs are empty. Seeded rows are
  ordinary rows.
- Codes are upper-cased and unique per tenant and catalog among live rows, case-insensitively. A
  deleted code can be reused. The batch rule (`domain/catalog-batch.ts`) checks the state after
  the batch, so rows may swap codes.
- Service prices are money in the tenant currency at the time they were set (ADR-0015).
- Categories are free text; the Catalog screen's filter pills are the distinct values.
- A row that a record refers to cannot be deleted, only deactivated (409 `catalog.in_use`,
  V11): a service or a plan that isn't removed (services) or a diagnosis record that isn't
  removed (diagnoses). Each catalog's repository answers it with one `exists` query (`isInUse`,
  part of the `CatalogStore` interface the service works through).
  Other rows are soft-deleted. The delete locks the row `FOR UPDATE` before that check, and a
  record write reads the row `FOR KEY SHARE`, so the two serialise (CLAUDE.md §7).

## Owns

- `procedures`: the service catalog. Tenant RLS. `code`, `name`, `category?`, `charge_unit`
  (enum `per_tooth | per_jaw | per_mouth`), `price_amount numeric(12,2) ≥ 0`, `price_currency char(3)`,
  `frequent`, `active`, `deleted_at?`. Unique `(tenant_id, lower(code)) where deleted_at is null`.
- `diagnoses`: the diagnosis catalog. Tenant RLS. `code`, `name`, `category?`, `frequent`,
  `active`, `deleted_at?`. Same unique rule.

Feature 4a (migration `0014_visits`; spec `2026-09-29-visit-workspace-design.md` §Data model).
All tenant RLS. Patient, branch, room and dentist ids carry no foreign key (other modules' tables);
foreign keys inside `clinical` are composite with `tenant_id`, so each target has a unique
`(tenant_id, id)` (`procedures` and `diagnoses` too). `*_by` columns are auth user ids (W10),
`dentist_id` a staff profile id (ADR-0020). Tooth codes are canonical FDI text (CHECK on the 52
codes), `surfaces text[]` is a subset of `M D B L O I`.

- `visits`: `display_number` (per tenant, minted at start, shown `V-000123`), `status` (enum
  `in_progress | paused | completed | discarded | amended | voided`), `local_date`, timer
  fields (`started_at`, `paused_at?`, `paused_seconds`), `notes`, `discount_mode` (enum
  `percent | amount`) + raw `discount_value ≥ 0`, `currency`, and at completion `completed_at`,
  `completed_by`, `duration_minutes`, `subtotal`, `discount_amount`, `total`;
  `unfinished_answered_at?` (when the visit answered which unfinished services it continues,
  migration 0031); `discarded_at`,
  `discarded_by`; `voided_at`, `voided_by`, `void_reason`. Checks: `paused_at` set iff paused;
  completed (and amended, voided) / discarded / voided ⇒ their fields. `visits_room_live_unique`:
  one live visit per room (W1); `visits_branch_started_idx` serves the list.
- `visit_counters`: one row per tenant, the last visit number (feature 4b, migration 0020).
- `visit_amendments`: append-only (no UPDATE/DELETE for the runtime role): per amendment the
  visit before and after (`AmendmentSnapshot`), `kind` (`amendment` | `checkout_discount`,
  ADR-0030), `reason` (required for an amendment), `delta`, `currency`, `amended_by`, `sequence`
  per visit (ADR-0025).
- `visit_services`: catalog snapshot, `tooth_code` iff `per_tooth`, `jaw` (enum `upper | lower`)
  iff `per_jaw`, `base_amount`,
  `discount_amount` (`0 ≤ discount ≤ base`), `plan_id?`, soft delete. `visit_services_plan_unique`:
  a plan is performed by at most one non-deleted service row.
- `patient_diagnoses`: diagnosis records on a tooth (the catalog is `diagnoses`),
  `active | resolved`, recorded in a visit or without one (`recorded_in_visit_id` null,
  ADR-0031), resolved in a visit, soft delete.
- `treatment_plans`: one planned procedure per row with its price snapshot and its target (tooth,
  jaw or neither, by unit), `planned | in_progress | performed | cancelled` with the matching
  visit/timestamp pairs (`started_*` once started, kept when done; a cancel outside a visit stamps
  only the time), optional `recorded_in_visit_id`, `diagnosis_record_id` and `group_id`, soft
  delete.
- `plan_groups`: named plans (`patient_id`, `title` 1–120, `note?`, `created_by`), soft delete.
- `treatment_plan_sessions`: one visit's work on a plan in progress (`plan_id`, `visit_id`,
  `note?`, `recorded_by`), unique per plan and visit among live rows, soft delete (ADR-0032).
- `tooth_status`: `primary | permanent` per succession position (W5), changed in a visit;
  `tooth_status_position_unique` on `(tenant_id, patient_id, position)`.

The pure rules are in `domain/`: `visit-lifecycle.ts` (state machine, and `correct` for amend
and void), `visit-timer.ts`, `discard-rule.ts`, `plan-lifecycle.ts` (continue, done,
cancel and their undos), `record-rules.ts` (tooth/jaw/surface/charge-unit/currency, and what is
removable outside a visit), `visit-amendment.ts` (`planAmendment`), `visit-cursor.ts`, `visit-range.ts` and
`visit-errors.ts`.

### Visits list, amend and void (feature 4b)

- **Counted visits** are `completed` or `amended`: Last visit, visit counts, billed sums and the
  treatment summary count them. A `voided` visit counts nowhere but stays in the patient's history,
  and its records stay, marked through `voidedVisitIds` (D6, D18).
- **Amend** (`visit:amend`, a completed or amended visit): the services that stay may change tooth
  and surfaces (per-tooth only, under the recording rules), the others are soft-deleted, and the
  visit discount may change; a service that performed a plan can be removed — its plan returns to
  `planned` — but not moved; at least one service stays. Locks patient then visit (ADR-0023),
  refuses a stale `expectedUpdatedAt` (409 `visit.stale`), appends `visit_amendments`, audits
  `visit.amend` (before/after/reason) and publishes `VisitAmended` in the transaction (ADR-0025).
- **Void** (`visit:void`, a completed or amended visit): sets `voided` with the reason, audits
  `visit.void`, publishes `VisitVoided` in the transaction; `billing` may veto it (409
  `visit.has_payments`, ADR-0026). Voided is final.
- **Checkout discount** (`visit:discount`, a completed or amended visit, on its tenant-local day;
  ADR-0030): the visit discount alone, through the amend mechanics — same locks and staleness
  check, a `visit_amendments` row of kind `checkout_discount`, `VisitAmended` in the transaction.
  It is silent: the status stays, the reason is optional, the row isn't counted in
  `amendmentCount`; audited `visit.discount`. After the day → 409 `visit.checkout_closed`; an
  unchanged discount → 422 `visit.amend_no_change`.
- **Close the checkout** (`payment:write`, a completed or amended visit; ADR-0033): `checkOut`
  stamps `checked_out_at` / `checked_out_by` once, which takes the visit out of the checkout
  queue (the list's `checkedOutAt`); status and money untouched. Audited `visit.checkout`, no
  event. A live visit → 409 `visit.not_completed`.
- **List** (`search`): cursor-paged by `(started_at, id)`, newest first; the session branch's
  visits, or with `patientId` one patient's in every branch; never discarded. Tabs `all`,
  `in_progress` (with paused), `voided_amended`, `history` (counted + voided); `range` on the
  tenant-local date; `q` matches the visit number, a service code or name, or the patients
  `PatientsService.searchIds` finds. `summary` gives the filtered count and billed sums and the
  unfiltered tab counts. `internal.idsIn` is `billing`'s Unpaid tab.
- **Stats**: `lastVisitFor(patientIds)` (the patients list's Last visit and Visits) and
  `patientIdsSeenWithin(days)` (the Not seen view and the Never filter, composed by `billing`).

The French UI writes the buccal surface as **V** (_vestibulaire_), the usual French dental
letter; the stored key stays `B` (`surfaceShort` in `locales/fr/clinical.json`).

### Visits

- A visit is live while `in_progress` or `paused`. Only a live visit changes; a completed or
  discarded one answers 409 `visit.not_live`.
- **One live visit per patient**: `start` returns the patient's live visit with
  `resumed: true` instead of opening a second one. **One live visit per room**:
  `visits_room_live_unique`, mapped to 409 `visit.room_busy`. After a merge the kept patient may
  briefly have two live visits; both stay usable. See ADR-0023 for the locks and the lock order
  (patient `FOR SHARE`, then the per-patient advisory lock, then the visit).
- A visit starts in the session's branch. Its dentist is a dentist of that branch (a staff
  profile id, ADR-0020). Its room is an active room of the branch, required when the branch has
  any (W7). The tenant currency and the tenant-local date are stamped at start.
- The timer: `paused_seconds` grows by each pause when the visit resumes; `paused_at` is set only
  while paused. Pause and resume are idempotent.
- Notes and the discount are last write wins per field group (W6). The discount is stored as the
  raw entry (`percent` or `amount`); the money (`visitMoney`, shared with the SPA) is computed
  from the services while the visit is live.
- **Discard** (W4): only an empty visit (`domain/discard-rule.ts`). It becomes `discarded`,
  frees its room, clears `paused_at`, and reads as not found everywhere.
- **Complete** (W2, W19, ADR-0024): locks the patient (`lockForDependentWrite`), then the visit
  (ADR-0023). An open pause ends and is added to `paused_seconds`. The money computed from the
  services that aren't removed is frozen in `subtotal`, `discount_amount` and `total`, with
  `duration_minutes` = `ceil((completed_at − started_at − paused_seconds) / 60)`, at least 1,
  `completed_at` and `completed_by`. The room is free again. `VisitCompleted` is published
  inside the transaction, so `billing` posts the visit charge before commit: a failed charge
  rolls the completion back and the visit stays live. A second completion → 409
  `visit.not_live`. An archived patient's live visit still completes.
- Every actor column (`started_by`, `discarded_by`, …) is the auth user id (W10).

### Records in a visit

Charting happens only inside a live visit (`VisitRecordsService`, spec §VisitRecordsService).
Records live on the patient's tooth and are dated by the visits that recorded, resolved,
performed or cancelled them (ADR-0022).

- **The patient is the visit's**, never a request field. Records are looked up by id _and_ the
  visit's patient (services by id and visit), so another patient's record reads as 404
  `record.not_found`. Searches by tooth or by linked diagnosis filter on the patient too, so
  they use the `(tenant_id, patient_id, tooth_code)` indexes.
- **Catalog items** must be active (422 `catalog.inactive`). Code, name, category, charge unit
  and price are copied as snapshots, so later catalog edits never change a record.
- **Where** (W11, L2; `record-rules.ts`'s `assertTarget`): a diagnosis always needs a tooth; a
  service or plan follows its charge unit: `per_tooth` needs a tooth (422 `visit.tooth_required`),
  `per_jaw` a jaw, `upper` or `lower`, and no tooth (422 `visit.jaw_required`,
  `visit.tooth_not_allowed`), `per_mouth` neither (422 `visit.jaw_not_allowed`). Both jaws are two
  records. Surfaces must be ones the tooth has (422 `visit.surfaces_invalid`).
- **One currency per visit** (W12): a service or performed plan priced in another currency → 422
  `visit.currency_mismatch`.
- **Who**: `recorded_by` / `changed_by` are the auth user id of whoever made the change (an
  assistant or a platform admin too); `dentist_id` is the visit's dentist (W10).
- **Removing** (W13) is a soft delete and only for records made in this visit: an older
  diagnosis is resolved and an older plan cancelled instead (409 `record.not_removable`). Removing
  a diagnosis unlinks the plans made for it. A plan is removed only while `planned` (409
  `plan.not_open`) and cancelled only when it comes from an earlier visit (409
  `plan.not_cancellable`).
- **Perform** turns an open plan (planned, or in progress: "Mark done") into a service of the
  visit at the plan's price and target (`plan_id` set), and marks the plan performed in this
  visit. `visit_services_plan_unique` backs a double perform (409 `plan.not_open`). Removing that
  service is the Undo: the plan goes back to `in_progress` when it has sessions, else `planned`,
  and its `performed_*` pair is cleared.
- **Unfinished services** (ADR-0032; `docs/superpowers/specs/2026-10-05-unfinished-services-design.md`):
  work over several visits is shown as a service that is not finished, and stored as a plan
  `in_progress` with one session per visit that worked on it. **Not finished** turns a service of
  this visit into that: the service is removed, its plan (put back, or made from the service's own
  snapshot) takes the service's base price and gets this visit's session. A later visit answers
  once which unfinished services it continues (`unfinished_answered_at`); **Continue** logs its
  session (one per visit; 409 `plan.not_in_progress` otherwise) and removing it is the Undo — the
  last session removed returns the plan to `planned`. Nothing is charged until **Complete**
  performs the plan. A session is visit content: the visit can't be discarded; the answer alone
  is not.
- A plan made on a tooth links the tooth's most recent active diagnosis
  (`diagnosis_record_id`), or none.
- **Tooth presence** (W5, W15; no longer used by the SPA since the two-chart toggle, kept in
  the API until it is retired): `primary | permanent` at a succession position (a permanent
  code at position 1–5), upserted on `(tenant_id, patient_id, position)` and stamped with the
  visit that changed it. Setting the value it already has changes nothing.

### Records on the patient, outside a visit

`PatientRecordsService` (ADR-0031) records what needs no visit, with `chart:write`:

- a diagnosis, or a plan, with `recorded_in_visit_id` null, dated now, for the given `dentistId`
  or the caller when they are a dentist (422 `record.dentist_required`, 422
  `visit.dentist_invalid`);
- removing a record made without a visit (409 `record.not_removable` for one made in a visit; a
  plan must still be `planned`), and cancelling any open plan (planned, or in progress);
- named plans (`plan_groups`): create, rename, delete (its plans are ungrouped), and moving an
  open plan between them. A plan made in a visit may name a group too.

Each call locks the patient `FOR SHARE` (`lockForDependentWrite`): unknown → 404, merged → 409
`patient.merged`, archived → 409 `patient.archived`. It answers `{ chart }`. Resolving, performing,
services and tooth presence stay in a visit. Inside a visit a record made without one is an older
record: resolved or cancelled, never removed.

### Reads

`ChartService` reads a patient's record for the chart, the Tooth History modal, the Last visit
card and the treatment summary (spec §ChartService). All need `visit:read`, so front desk reads
them too. The patient comes from `PatientsService.get`, which also requires `patient:read`
(every clinic role holds both): an unknown one, another tenant's included, is 404
`patient.not_found`. Removed records never appear. History is the services of
completed visits; a patient's records are bounded, so nothing is paginated. Dentist names come
from one `practitionersByProfileIds` call per read.

- **Chart**: which of the patient's two charts opens, primary or permanent teeth
  (`effectiveDentition`: the chart the patient was switched to, else primary up to age 12 on the
  tenant's today, else permanent), the
  `tooth_status` rows, every diagnosis and plan (each plan with its sessions), the named plans,
  the history (most recent visit first, with the
  visit date and dentist), the patient's most recent live visit, and `teeth`: the entries of
  `deriveChart`, which counts that live visit's services as treated today.
- **Tooth history**: one code's diagnoses and plans in the order recorded, then its completed
  services, most recent first. Only that code; the modal links the predecessor or successor.
- **Last visit**: the most recently completed visit (`completed_at`): its local date, dentist,
  duration, frozen total, services as `{ name, toothCode }` chips, and notes; `null` without one.
- **Summary** (W8): completed visits, active diagnoses, open plans (planned or in progress),
  distinct teeth and the number of services over completed visits' services, in one query.

### Merge re-point

`MergeClinicalSubscriber` handles `PatientsMerged` **in the merge transaction** (spec V10, W24;
ADR-0024's in-transaction handlers), which already holds both patients `FOR UPDATE`. A failure
rolls the merge back, so a visit's `patient_id` is always a live patient and a charge posted at
completion lands on the kept one. In order:

1. `visits` move to the kept patient. The kept patient's live visits are locked `FOR UPDATE`
   first and the dropped patient's are locked by the update, so the re-point waits for charting
   in flight (which holds its visit `FOR UPDATE`) and later changes read the new patient.
   Charting locks a visit and no patient; `complete` locks the patient before its visit
   (ADR-0023), so it either finishes before the merge takes the patients or waits for the merge
   and re-reads the visit. Neither order can deadlock.
2. `patient_diagnoses`, then `treatment_plans` (removed rows too; their sessions follow them),
   then `plan_groups`.
3. `tooth_status`: where both patients have a row at a position, the kept one wins and the
   dropped one is deleted (a state row, not history); the other rows move.
4. Audit `clinical.repoint` on the kept patient (resource type `patient`, after =
   `{ droppedId, visits, diagnoses, plans, planGroups, toothStatusMoved, toothStatusDropped }`; before = the
   deleted tooth-status rows `{ position, present, changedInVisitId }`, when there are any), only
   when something changed.

It isn't permission-gated: the merge needs `patient:write`, and front desk merges without
`visit:write`. A merge chain (A into B, then B into C) ends on C, because each merge re-points in
its own transaction. The kept patient may then have two live visits; both stay usable (W1).

## Public API (`index.ts`)

`ClinicalModule`, `CatalogService`, `VisitsService` (with the `VisitChargeFacts` and
`VisitMoneyFacts` types), `VisitRecordsService`, `PatientRecordsService`, `ChartService`,
`CatalogItemNotFoundError`,
`CatalogItemInUseError`, `CatalogItemInactiveError`, `VisitNotLiveError`, and the events
`CatalogChanged`, `VisitStarted`, `VisitPaused`, `VisitResumed`, `VisitDiscarded`,
`VisitCompleted`, `DiagnosisRecorded`, `DiagnosisResolved`, `DiagnosisReopened`,
`TreatmentPlanned`, `TreatmentStarted`, `TreatmentPerformed`, `TreatmentCancelled` and
`ToothStatusChanged`.

`CatalogService`:

| Method                                                  | Access          | Notes                                                                                                           |
| ------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------- |
| `listServices()` / `listDiagnoses()`                    | `catalog:read`  | Live rows, active and inactive, oldest first.                                                                   |
| `saveServices(batch)` / `saveDiagnoses(batch)`          | `catalog:write` | One transaction. Duplicate code → 422 `validation_failed` (`items.<i>.code`); unknown id → 404.                 |
| `deleteService(id)` / `deleteDiagnosis(id)`             | `catalog:write` | Used by a record that isn't removed → 409 `catalog.in_use`; otherwise soft delete.                              |
| `deactivateService(id)` / `deactivateDiagnosis(id)`     | `catalog:write` | "Mark inactive".                                                                                                |
| `seedDefaultCatalog()`                                  | `catalog:write` | `{ services, diagnoses }` rows created; `{0, 0}` when a catalog exists.                                         |
| `listActiveServices()` / `listActiveDiagnoses()`        | caller guards   | For the visit drawer (feature 4) and pricing (feature 6).                                                       |
| `getServiceForRecord(id)` / `getDiagnosisForRecord(id)` | caller guards   | A live row, active or not, read `FOR KEY SHARE` in the caller's open transaction; else 404 `catalog.not_found`. |

Every write is audited per row with before/after (`catalog.service.create|update|delete|deactivate`,
`catalog.diagnosis.*`; resource types `procedure` and `diagnosis`).

`VisitsService` (spec §VisitsService). Mutations re-check `visit:write`, run in one transaction,
lock the visit `FOR UPDATE` (409 `visit.not_live` unless live), are audited with before/after
(resource type `visit`) and publish their event after commit (`complete` publishes inside its
transaction). They return `{ visit }` with the updated `Visit`.

| Method                                     | Access        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start({ patientId, dentistId, roomId? })` | `visit:write` | `{ visit, resumed }`. No session branch → 422 `visit.branch_required`. Unknown patient → 404; merged → 409 `patient.merged`. The patient's live visit → `resumed: true` (even when the patient was archived since). Else: archived → 409 `patient.archived`; dentist not a dentist of the branch → 422 `visit.dentist_invalid`; room not an active room of the branch → 422 `visit.room_invalid`; no room while the branch has rooms → 422 `visit.room_required`; room held → 409 `visit.room_busy`. Audit `visit.start`; `VisitStarted`. |
| `startDefaults()`                          | `visit:write` | `{ dentistId, roomId }`: the caller when they are a dentist of the session's branch; the room of the last visit they started today if it is still active and free. Nulls without a branch.                                                                                                                                                                                                                                                                                                                                                |
| `pause(id)` / `resume(id)`                 | `visit:write` | Idempotent (already paused/running → unchanged, no audit). Resume adds the pause to `pausedSeconds`. Audit `visit.pause` / `visit.resume`; `VisitPaused` / `VisitResumed`.                                                                                                                                                                                                                                                                                                                                                                |
| `updateNotes(id, { notes })`               | `visit:write` | ≤ 20,000 characters. Audit `visit.update` with `{ notes }` (no-op when unchanged).                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `setDiscount(id, { mode, value })`         | `visit:write` | The raw entry. Audit `visit.update` with `{ discountMode, discountValue }` (no-op when unchanged).                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `complete(id)`                             | `visit:write` | See [Visits](#visits). Unknown or discarded → 404; not live → 409 `visit.not_live`; merged patient → 409 `patient.merged` (after one re-read, W24); a visit re-pointed between its reads → 409 `visit.moved` (defensive, retry). Audit `visit.complete` (before/after: status, timer, completion fields, money); `VisitCompleted { visitId, patientId, currency, total, localDate }`, published in the transaction. Answers with the completed visit.                                                                                     |
| `discard(id)`                              | `visit:write` | Not empty → 409 `visit.not_empty`. Audit `visit.discard`; `VisitDiscarded`. Answers with the discarded visit.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `get(id)`                                  | `visit:read`  | The `Visit`: services, money, timer fields and `serverNow`. Unknown or discarded → 404 `visit.not_found`.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `chargeFacts(visitId)`                     | `visit:read`  | For `billing`'s in-transaction `VisitCompleted` handler (ADR-0024): `{ patientId, currency, total, localDate, lines }` of a completed visit, the lines being its services that aren't removed, in order (`code`, `name`, `toothCode`, `surfaces`, `amount` = base − line discount). Reads through the open transaction. A visit that isn't completed throws (a caller bug).                                                                                                                                                               |
| `visitMoney(visitId)`                      | `visit:read`  | For `billing`'s visit summary: `{ visitId, patientId, status, currency, subtotal, discount, total, completedAt, durationMinutes, serviceCount }`, the money computed while live and frozen once completed. Unknown or discarded → 404.                                                                                                                                                                                                                                                                                                    |
| `numbersFor(visitIds)`                     | `visit:read`  | For `billing`'s receipts, payment history and statements (feature 5): `{ visitId, displayNumber, localDate }` of each visit, any status, in no particular order; unknown ids are absent.                                                                                                                                                                                                                                                                                                                                                  |
| `live({ patientId?, mine? })`              | `visit:read`  | `LiveVisitRef[]`, oldest first, with the patient's and dentist's names and `serverNow`. `mine` (W18): the caller's staff profile (`UsersService.profileIdOf`) is the dentist, or the caller started it; a platform admin (no staff profile) matches only their own starts.                                                                                                                                                                                                                                                                |

`VisitRecordsService` (see [Records in a visit](#records-in-a-visit)). Every method needs
`visit:write`, runs in one transaction, locks the visit `FOR UPDATE` (409 `visit.not_live` unless
live; 404 `visit.not_found`), is audited with before/after and answers `{ visit, record }`: the
updated `Visit` and the record created or changed (a removed one included). Unknown records →
404 `record.not_found`.

| Method                                                                                 | Audit action (resource type)                                                                                        | Notes                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `addService(visitId, { procedureId, toothCode?, surfaces })`                           | `visit_service.create` (`visit_service`)                                                                            | Base = the catalog price, line discount 0. No event.                                                                                                                                        |
| `updateService(visitId, serviceId, { baseAmount?, discountAmount? })`                  | `visit_service.update`                                                                                              | Last write wins (W6). Discount above the base → 422 `validation_failed` at the field that broke it. No-op when unchanged. No event.                                                         |
| `removeService(visitId, serviceId)`                                                    | `visit_service.delete`; `treatment_plan.unperform` for a service from a plan                                        | Soft delete. A service from a plan puts the plan back to `planned` (the Undo of perform). No event.                                                                                         |
| `recordDiagnosis(visitId, { diagnosisId, toothCode, surfaces, note? })`                | `diagnosis_record.create` (`diagnosis_record`)                                                                      | `DiagnosisRecorded`.                                                                                                                                                                        |
| `resolveDiagnosis` / `reopenDiagnosis(visitId, recordId)`                              | `diagnosis_record.resolve` / `.reopen`                                                                              | Any of the patient's diagnoses. Resolve stamps this visit and the time; reopen clears both. Idempotent. `DiagnosisResolved` / `DiagnosisReopened`.                                          |
| `removeDiagnosis(visitId, recordId)`                                                   | `diagnosis_record.delete` (with the unlinked plan ids)                                                              | Recorded in this visit only (409 `record.not_removable`). Unlinks its plans. No event.                                                                                                      |
| `planTreatment(visitId, { procedureId, toothCode?, jaw?, surfaces, note?, groupId? })` | `treatment_plan.create` (`treatment_plan`)                                                                          | Price snapshot; links the tooth's latest active diagnosis. `TreatmentPlanned`.                                                                                                              |
| `markServiceUnfinished(visitId, serviceId)`                                            | `visit_service.unfinished`; `treatment_plan.unperform` or `.create`, `.reprice` when the price was edited, `.start` | The service is removed and its plan is `in_progress` at the service's base price with this visit's session; answers the plan. `TreatmentStarted` (after `TreatmentPlanned` for a new plan). |
| `answerUnfinished(visitId, { continue })`                                              | `treatment_plan.session` per plan; `visit.unfinished_answered` (`visit`)                                            | This visit's session on each listed plan (the patient's, in progress); stamps the visit once. Answers `{ visit }`. No event.                                                                |
| `recordSession(visitId, planId, { note? })`                                            | `treatment_plan.session`                                                                                            | In progress only (409 `plan.not_in_progress`); one per visit, a repeat updates the note. No event.                                                                                          |
| `removeSession(visitId, planId)`                                                       | `treatment_plan.session_delete`                                                                                     | This visit's session (404 `record.not_found`); the last one removed returns the plan to `planned`. No event.                                                                                |
| `performPlan(visitId, planId)`                                                         | `visit_service.create` and `treatment_plan.perform`                                                                 | An open plan (409 `plan.not_open`); currency must match. `TreatmentPerformed`.                                                                                                              |
| `cancelPlan(visitId, planId)`                                                          | `treatment_plan.cancel`                                                                                             | Not made in this visit (409 `plan.not_cancellable`), open (409 `plan.not_open`). `TreatmentCancelled`.                                                                                      |
| `removePlan(visitId, planId)`                                                          | `treatment_plan.delete`                                                                                             | Made in this visit (409 `record.not_removable`) and `planned` (409 `plan.not_open`). Soft delete. No event.                                                                                 |
| `setToothPresence(visitId, position, { present })`                                     | `tooth_status.set` (`tooth_status`)                                                                                 | Upsert; no-op when unchanged. `ToothStatusChanged`.                                                                                                                                         |

`PatientRecordsService` (see [Records on the patient](#records-on-the-patient-outside-a-visit)).
Every method needs `chart:write`, runs in one transaction, locks the patient `FOR SHARE`, is
audited like its in-visit twin and answers `{ chart }`.

| Method                                                      | Audit action              | Notes                                                                                  |
| ----------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------- |
| `recordDiagnosis(patientId, { …, dentistId? })`             | `diagnosis_record.create` | `DiagnosisRecorded` with `visitId: null`.                                              |
| `removeDiagnosis(patientId, recordId)`                      | `diagnosis_record.delete` | Recorded without a visit only (409 `record.not_removable`). Unlinks its plans.         |
| `planTreatment(patientId, { …, groupId?, dentistId? })`     | `treatment_plan.create`   | `TreatmentPlanned` with `visitId: null`.                                               |
| `updatePlan(patientId, planId, { groupId?, note? })`        | `treatment_plan.update`   | An open plan (409 `plan.not_open`); no-op when unchanged.                              |
| `cancelPlan(patientId, planId)`                             | `treatment_plan.cancel`   | An open plan, wherever it was made. `TreatmentCancelled` with `visitId: null`.         |
| `removePlan(patientId, planId)`                             | `treatment_plan.delete`   | Made without a visit (409 `record.not_removable`) and `planned` (409 `plan.not_open`). |
| `createGroup` / `updateGroup` / `deleteGroup(patientId, …)` | `plan_group.create        | update                                                                                 | delete` | Delete ungroups its plans, then soft-deletes. |

`ChartService` (see [Reads](#reads)). Every method needs `visit:read`; an unknown patient → 404
`patient.not_found`.

| Method                          | Answers                                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `chart(patientId)`              | `PatientChart`: dentition, tooth status, diagnoses, plans, history, `liveVisitId`, `teeth`.           |
| `toothHistory(patientId, code)` | `ToothHistory`: `{ toothCode, diagnoses, plans, services }`.                                          |
| `lastVisit(patientId)`          | `LastVisit`, or `null` without a completed visit.                                                     |
| `summary(patientId)`            | `ClinicalSummary`: `{ visits, activeDiagnoses, plannedProcedures, teethTreated, servicesPerformed }`. |

## HTTP

| Route                                                                                                                                                                                                                                                                                | Access           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| `GET /catalog/services`, `GET /catalog/diagnoses`                                                                                                                                                                                                                                    | `catalog:read`   |
| `PUT /catalog/services`, `PUT /catalog/diagnoses`                                                                                                                                                                                                                                    | `catalog:write`  |
| `DELETE /catalog/{services,diagnoses}/:id`                                                                                                                                                                                                                                           | `catalog:write`  |
| `POST /catalog/{services,diagnoses}/:id/deactivate`                                                                                                                                                                                                                                  | `catalog:write`  |
| `POST /catalog/seed-default`                                                                                                                                                                                                                                                         | `catalog:write`  |
| `POST /visits` → 201 `{ visit, resumed: false }` or 200 `{ visit, resumed: true }`                                                                                                                                                                                                   | `visit:write`    |
| `GET /visits/start-defaults` → `{ dentistId, roomId }`                                                                                                                                                                                                                               | `visit:write`    |
| `GET /visits/live?patientId=&mine=` → `LiveVisitRef[]`                                                                                                                                                                                                                               | `visit:read`     |
| `GET /visits/:id` → `Visit`                                                                                                                                                                                                                                                          | `visit:read`     |
| `POST /visits/:id/{pause,resume,discard,complete}` → `{ visit }`                                                                                                                                                                                                                     | `visit:write`    |
| `PATCH /visits/:id/notes`, `PATCH /visits/:id/discount` → `{ visit }`                                                                                                                                                                                                                | `visit:write`    |
| `POST /visits/:id/services` → 201, `PATCH` / `DELETE /visits/:id/services/:serviceId` → `{ visit, record: VisitService }`; `POST /visits/:id/services/:serviceId/unfinished` → `{ visit, record: TreatmentPlan }`; `POST /visits/:id/unfinished-answer` `{ continue }` → `{ visit }` | `visit:write`    |
| `POST /visits/:id/diagnoses` → 201, `POST /visits/:id/diagnoses/:recordId/{resolve,reopen}`, `DELETE /visits/:id/diagnoses/:recordId` → `{ visit, record: DiagnosisRecord }`                                                                                                         | `visit:write`    |
| `POST /visits/:id/plans` → 201, `POST /visits/:id/plans/:planId/{perform,cancel}`, `PUT` / `DELETE /visits/:id/plans/:planId/session`, `DELETE /visits/:id/plans/:planId` → `{ visit, record: TreatmentPlan }`                                                                       | `visit:write`    |
| `PUT /visits/:id/teeth/:position` `{ present }` → `{ visit, record: { position, present } }`; a position that is not a succession position → 400 `validation_failed`                                                                                                                 | `visit:write`    |
| `GET /clinical/patients/:id/chart` → `PatientChart`, `GET /clinical/patients/:id/summary` → `ClinicalSummary`                                                                                                                                                                        | `visit:read`     |
| `GET /clinical/patients/:id/last-visit` → `LastVisit` or JSON `null`                                                                                                                                                                                                                 | `visit:read`     |
| `GET /clinical/patients/:id/teeth/:toothCode/history` → `ToothHistory`; a code that is not one of the 52 FDI codes → 400 `validation_failed`                                                                                                                                         | `visit:read`     |
| `GET /visits?tab=&range=&dentistId=&roomId=&q=&patientId=&cursor=&limit=` → `VisitPage` (registered before `:id`)                                                                                                                                                                    | `visit:read`     |
| `GET /visits/summary` (same filters) → `VisitListSummary`                                                                                                                                                                                                                            | `visit:read`     |
| `POST /visits/:id/amend` `AmendVisitInput` → `{ visit }`                                                                                                                                                                                                                             | `visit:amend`    |
| `POST /visits/:id/checkout-discount` `{ expectedUpdatedAt, discount, reason? }` → `{ visit }`                                                                                                                                                                                        | `visit:discount` |
| `POST /visits/:id/checkout` → `{ visit }`                                                                                                                                                                                                                                            | `payment:write`  |
| `POST /visits/:id/void` `{ expectedUpdatedAt, reason }` → `{ visit }`                                                                                                                                                                                                                | `visit:void`     |
| `GET /clinical/patients/visit-stats?patientIds=` (1–100) → `VisitStat[]`                                                                                                                                                                                                             | `visit:read`     |
| `POST /clinical/patients/:id/diagnoses` → 201, `DELETE /clinical/patients/:id/diagnoses/:recordId` → `{ chart }`                                                                                                                                                                     | `chart:write`    |
| `POST /clinical/patients/:id/plans` → 201, `PATCH` / `DELETE /clinical/patients/:id/plans/:planId`, `POST /clinical/patients/:id/plans/:planId/cancel` → `{ chart }`                                                                                                                 | `chart:write`    |
| `POST /clinical/patients/:id/plan-groups` → 201, `PATCH` / `DELETE /clinical/patients/:id/plan-groups/:groupId` → `{ chart }`                                                                                                                                                        | `chart:write`    |

## Events

- Emits (after commit; the generic subscriber audits each):
  - `CatalogChanged { kind: 'service' | 'diagnosis', ids }`.
  - `VisitStarted { visitId, patientId, dentistId, roomId }`.
  - `VisitPaused { visitId, patientId }`, `VisitResumed { visitId, patientId }`.
  - `VisitDiscarded { visitId, patientId, roomId }`.
  - `VisitCompleted { visitId, patientId, currency, total, localDate }`, published by
    `complete` inside its transaction: `billing`'s in-transaction handler posts the visit charge
    before commit (ADR-0024); after-commit subscribers (the audit) hear it once committed.
  - `DiagnosisRecorded { recordId, visitId, patientId, toothCode, diagnosisId }`,
    `DiagnosisResolved` / `DiagnosisReopened { recordId, visitId, patientId, toothCode }`.
  - `TreatmentPlanned { planId, visitId, patientId, toothCode, procedureId }`,
    `TreatmentStarted { planId, visitId, patientId, toothCode }`,
    `TreatmentPerformed { planId, visitId, patientId, serviceId, toothCode }`,
    `TreatmentCancelled { planId, visitId, patientId, toothCode }`. `visitId` is null on
    `DiagnosisRecorded`, `TreatmentPlanned` and `TreatmentCancelled` for a change made on the
    patient record (ADR-0031).
  - `ToothStatusChanged { visitId, patientId, position, present }`.
  - Notes and discount changes, service adds, edits and removes, record removals, sessions, named
    plans and the undo of a perform are audited directly and emit no event.
  - `VisitAmended { visitId, patientId, amendmentId, currency, delta, reason }` (also for a
    checkout discount, whose `reason` may be null) and
    `VisitVoided { visitId, patientId, currency, reason }`, published inside the amend or void
    transaction: `billing` posts the adjustment or reversal before commit, or vetoes the void
    (ADR-0025, ADR-0026).
- Consumes: `TenantProvisioned` (provisioning, event only — ADR-0014). It seeds the default
  catalog.
- Consumes: `PatientsMerged` (patients), in the merge transaction: the
  [merge re-point](#merge-re-point).

## Depends on

- `tenancy`: the tenant currency (ADR-0015) and time zone (the local date, the age for the
  chart), the branch's rooms (ADR-0007).
- `patients`: existence and the dependent-write lock (`lockForDependentWrite`, W22), names for
  the live visits, the date of birth and dentition override for the chart (`get`), and
  `PatientsMerged` (the re-point).
- `users`: the branch's dentists (`listPractitioners`), dentist names
  (`practitionersByProfileIds`, also on diagnosis and plan records), the caller's staff profile
  (`profileIdOf`).
- `audit`.

None of them imports `clinical`. `billing` imports `clinical` (`chargeFacts`, `visitMoney`,
`VisitNotLiveError`, the visit events, and `search` / `aggregate` / `lastVisitFor` /
`patientIdsSeenWithin` for its visit and patient views; ADR-0024); `clinical` never imports
`billing`.

## Permissions

- `visit:read`, `visit:write`.
- `visit:amend`, `visit:void`: owner and dentist (feature 4b).
- `visit:discount`: owner, dentist and front desk (checkout handoff, ADR-0030).
- `chart:write`: owner and dentist — charting on the patient record, outside a visit (ADR-0031).
- `catalog:read`: every clinic role.
- `catalog:write`: owner. A platform admin acting in the tenant also has it.

The catalog permissions cover both the service and the diagnosis catalog.
