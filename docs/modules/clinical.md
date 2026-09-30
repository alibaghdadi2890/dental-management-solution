# `clinical` module

**Status:** partly implemented. The service and diagnosis catalogs are done (feature 2). Of
feature 4a, the visit lifecycle is done (start, resume, pause, notes, discount, discard, live
visits); charting in a visit, the chart reads and completion are in progress.

## Purpose

Clinical work on a patient:

- **Visits**: encounters with a dentist, room, date, timer, services performed with
  tooth/surfaces, notes, discount and status (feature 4a). Amend and void with a reason are 4b.
- **The per-tenant catalogs**: services (what the clinic charges for) and diagnoses (what dentists
  record).
- **Treatment plans** (planned): planned procedures and charting linked to visits.

Tooth numbering is Universal (1–32, A–T), per the POC. This module was renamed from `treatments`
(ADR-0001) and owns the catalogs (ADR-0002).

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
- A row that a visit refers to cannot be deleted, only deactivated (`isInUse`, which returns
  false until visits exist). Other rows are soft-deleted.

## Owns

- `procedures`: the service catalog. Tenant RLS. `code`, `name`, `category?`, `charge_unit`
  (enum `per_tooth | per_jaw`), `price_amount numeric(12,2) ≥ 0`, `price_currency char(3)`,
  `frequent`, `active`, `deleted_at?`. Unique `(tenant_id, lower(code)) where deleted_at is null`.
- `diagnoses`: the diagnosis catalog. Tenant RLS. `code`, `name`, `category?`, `frequent`,
  `active`, `deleted_at?`. Same unique rule.

Feature 4a (migration `0014_visits`; spec `2026-09-29-visit-workspace-design.md` §Data model).
All tenant RLS. Patient, branch, room and dentist ids carry no foreign key (other modules' tables);
foreign keys inside `clinical` are composite with `tenant_id`, so each target has a unique
`(tenant_id, id)` (`procedures` and `diagnoses` too). `*_by` columns are auth user ids (W10),
`dentist_id` a staff profile id (ADR-0020). Tooth codes are canonical FDI text (CHECK on the 52
codes), `surfaces text[]` is a subset of `M D B L O I`.

- `visits`: `status` (enum `in_progress | paused | completed | discarded`), `local_date`, timer
  fields (`started_at`, `paused_at?`, `paused_seconds`), `notes`, `discount_mode` (enum
  `percent | amount`) + raw `discount_value ≥ 0`, `currency`, and at completion `completed_at`,
  `completed_by`, `duration_minutes`, `subtotal`, `discount_amount`, `total`; `discarded_at`,
  `discarded_by`. Checks: `paused_at` set iff paused; completed/discarded ⇒ their fields.
  `visits_room_live_unique`: one live visit per room (W1).
- `visit_services`: catalog snapshot, `tooth_code` iff `per_tooth`, `base_amount`,
  `discount_amount` (`0 ≤ discount ≤ base`), `plan_id?`, soft delete. `visit_services_plan_unique`:
  a plan is performed by at most one live service row.
- `patient_diagnoses`: diagnosis records on a tooth (the catalog is `diagnoses`), `active |
resolved`, recorded/resolved in a visit, soft delete.
- `treatment_plans`: one planned procedure per row with its price snapshot, `planned | performed |
cancelled` with the matching visit/timestamp pair, optional `diagnosis_record_id`, soft delete.
- `tooth_status`: `primary | permanent` per succession position (W5), changed in a visit;
  `tooth_status_position_unique` on `(tenant_id, patient_id, position)`.

The pure rules are in `domain/`: `visit-lifecycle.ts` (state machine), `visit-timer.ts`,
`discard-rule.ts`, `record-rules.ts` (tooth/surface/charge-unit/currency) and `visit-errors.ts`.

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
- Every actor column (`started_by`, `discarded_by`, …) is the auth user id (W10).

## Public API (`index.ts`)

`ClinicalModule`, `CatalogService`, `VisitsService`, `CatalogItemNotFoundError`,
`CatalogItemInUseError`, and the events `CatalogChanged`, `VisitStarted`, `VisitPaused`,
`VisitResumed`, `VisitDiscarded` and `VisitCompleted` (published from step 5 of feature 4a).

`CatalogService`:

| Method                                              | Access          | Notes                                                                                           |
| --------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| `listServices()` / `listDiagnoses()`                | `catalog:read`  | Live rows, active and inactive, oldest first.                                                   |
| `saveServices(batch)` / `saveDiagnoses(batch)`      | `catalog:write` | One transaction. Duplicate code → 422 `validation_failed` (`items.<i>.code`); unknown id → 404. |
| `deleteService(id)` / `deleteDiagnosis(id)`         | `catalog:write` | In use → 409 `catalog.in_use`; otherwise soft delete.                                           |
| `deactivateService(id)` / `deactivateDiagnosis(id)` | `catalog:write` | "Mark inactive".                                                                                |
| `seedDefaultCatalog()`                              | `catalog:write` | `{ services, diagnoses }` rows created; `{0, 0}` when a catalog exists.                         |
| `listActiveServices()` / `listActiveDiagnoses()`    | caller guards   | For the visit drawer (feature 4) and pricing (feature 6).                                       |
| `getService(id)` / `getDiagnosis(id)`               | caller guards   | A live row, active or not; else 404 `catalog.not_found`.                                        |
| `isInUse(id)`                                       | —               | Always false until feature 4.                                                                   |

Every write is audited per row with before/after (`catalog.service.create|update|delete|deactivate`,
`catalog.diagnosis.*`; resource types `procedure` and `diagnosis`).

`VisitsService` (spec §VisitsService). Mutations re-check `visit:write`, run in one transaction,
lock the visit `FOR UPDATE` (409 `visit.not_live` unless live), are audited with before/after
(resource type `visit`) and publish their event after commit. They return `{ visit }` with the
updated `Visit`.

| Method                                     | Access        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start({ patientId, dentistId, roomId? })` | `visit:write` | `{ visit, resumed }`. No session branch → 422 `visit.branch_required`. Unknown patient → 404; merged → 409 `patient.merged`; archived → 409 `patient.archived`. The patient's live visit → `resumed: true`. Else: dentist not a dentist of the branch → 422 `visit.dentist_invalid`; room not an active room of the branch → 422 `visit.room_invalid`; no room while the branch has rooms → 422 `visit.room_required`; room held → 409 `visit.room_busy`. Audit `visit.start`; `VisitStarted`. |
| `startDefaults()`                          | `visit:write` | `{ dentistId, roomId }`: the caller when they are a dentist of the session's branch; the room of the last visit they started today if it is still active and free. Nulls without a branch.                                                                                                                                                                                                                                                                                                     |
| `pause(id)` / `resume(id)`                 | `visit:write` | Idempotent (already paused/running → unchanged, no audit). Resume adds the pause to `pausedSeconds`. Audit `visit.pause` / `visit.resume`; `VisitPaused` / `VisitResumed`.                                                                                                                                                                                                                                                                                                                     |
| `updateNotes(id, { notes })`               | `visit:write` | ≤ 20,000 characters. Audit `visit.update` with `{ notes }` (no-op when unchanged).                                                                                                                                                                                                                                                                                                                                                                                                             |
| `setDiscount(id, { mode, value })`         | `visit:write` | The raw entry. Audit `visit.update` with `{ discountMode, discountValue }` (no-op when unchanged).                                                                                                                                                                                                                                                                                                                                                                                             |
| `discard(id)`                              | `visit:write` | Not empty → 409 `visit.not_empty`. Audit `visit.discard`; `VisitDiscarded`. Answers with the discarded visit.                                                                                                                                                                                                                                                                                                                                                                                  |
| `get(id)`                                  | `visit:read`  | The `Visit`: services, money, timer fields and `serverNow`. Unknown or discarded → 404 `visit.not_found`.                                                                                                                                                                                                                                                                                                                                                                                      |
| `live({ patientId?, mine? })`              | `visit:read`  | `LiveVisitRef[]`, oldest first, with the patient's and dentist's names and `serverNow`. `mine` (W18): the caller's staff profile is the dentist, or the caller started it; a platform admin (no staff profile) matches only their own starts.                                                                                                                                                                                                                                                  |

## HTTP

| Route                                                                              | Access          |
| ---------------------------------------------------------------------------------- | --------------- |
| `GET /catalog/services`, `GET /catalog/diagnoses`                                  | `catalog:read`  |
| `PUT /catalog/services`, `PUT /catalog/diagnoses`                                  | `catalog:write` |
| `DELETE /catalog/{services,diagnoses}/:id`                                         | `catalog:write` |
| `POST /catalog/{services,diagnoses}/:id/deactivate`                                | `catalog:write` |
| `POST /catalog/seed-default`                                                       | `catalog:write` |
| `POST /visits` → 201 `{ visit, resumed: false }` or 200 `{ visit, resumed: true }` | `visit:write`   |
| `GET /visits/start-defaults` → `{ dentistId, roomId }`                             | `visit:write`   |
| `GET /visits/live?patientId=&mine=` → `LiveVisitRef[]`                             | `visit:read`    |
| `GET /visits/:id` → `Visit`                                                        | `visit:read`    |
| `POST /visits/:id/{pause,resume,discard}` → `{ visit }`                            | `visit:write`   |
| `PATCH /visits/:id/notes`, `PATCH /visits/:id/discount` → `{ visit }`              | `visit:write`   |

## Events

- Emits (after commit; the generic subscriber audits each):
  - `CatalogChanged { kind: 'service' | 'diagnosis', ids }`.
  - `VisitStarted { visitId, patientId, dentistId, roomId }`.
  - `VisitPaused { visitId, patientId }`, `VisitResumed { visitId, patientId }`.
  - `VisitDiscarded { visitId, patientId, roomId }`.
  - `VisitCompleted { visitId, patientId, currency, total, localDate }`: the type exists; it is
    published by `complete` (feature 4a step 5).
  - Notes and discount changes are audited directly and emit no event.
  - Planned: `VisitAmended`, `VisitVoided` (4b).
- Consumes: `TenantProvisioned` (provisioning, event only — ADR-0014). It seeds the default
  catalog.

## Depends on

- `tenancy`: the tenant currency (ADR-0015) and time zone, the branch's rooms (ADR-0007).
- `patients`: existence and the dependent-write lock (`lockForDependentWrite`, W22), names for
  the live visits.
- `users`: the branch's dentists (`listPractitioners`), dentist names
  (`practitionersByProfileIds`), the caller's staff profile.
- `audit`.

None of them imports `clinical`.

## Permissions

- `visit:read`, `visit:write`.
- `catalog:read`: every clinic role.
- `catalog:write`: owner. A platform admin acting in the tenant also has it.

The catalog permissions cover both the service and the diagnosis catalog.
