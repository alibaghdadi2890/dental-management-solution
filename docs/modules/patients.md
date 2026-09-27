# `patients` module

**Status:** implemented. Patient records, search, duplicates, archive/restore and merge are done
(feature 3). The odontogram is planned.

## Purpose

Patient records: demographics, contacts, insurance (as text), medical alerts/allergies, primary
dentist, guardian, notes, archive (soft delete) and merge. The POC's Patients screen (list, quick
view, create/edit, merge), the ⌘K palette and the patient record header are the UI reference.
Balances are not here: views that need them (Owes balance, sort by balance, CSV export, create
with an opening balance) are composed by `billing` on top of this module (design Q5; ADR-0017,
reserved for billing).

- **Import key:** `externalId` is read-only over HTTP. It is not part of the create or edit
  contract; only the import (feature 6) will set it. Records created here have it null.
- **Display number:** `P-` plus at least 6 digits (`P-000001`). It comes from the tenant's
  `patient_counters` row, which the create transaction upserts. The row lock serialises
  concurrent creates, and a rolled-back create frees its number.
- **Phones:** normalised against the tenant `country` (`normalizePhone` in `@dcm/contracts`) and
  stored in E.164. A number typed with a leading `+` is accepted for any country.
  `phone_search` holds the E.164 digits and the national digits, so `03123…` and `96131…` both
  match. `guardianPhone` follows the same rule and is stored in E.164.
- **Dates:** the date of birth must not be after the tenant's today, computed from the injected
  clock in the tenant time zone (`localDate` in `platform/kernel`). Age bands use the same today.
- **Search `q`:** a diacritics-insensitive substring of `name_key`, the display number, the
  e-mail, and, when the query has at least 2 digits, the phone digits.
- **Archive** sets `deleted_at` (design Q11). The optional reason goes to the audit entry only.
  A merged-away record is archived and has `merged_into_id`; it can never be restored.
- **Merge** (design Q8): each pickable field comes from the kept record unless the choice is
  `drop`. `guardian` moves name and phone together. Medical alerts are always the union of both
  records and are never truncated: more than 20 refuses the merge.

## Owns

- `patients` (tenant RLS): the record, plus the internal search columns `name_key` and
  `phone_search`. `sex` is a Postgres enum (`patient_sex`) and `medical_alerts` is a `text[]`.
  `primary_dentist_user_id` is an auth user id with no foreign key (ADR-0016).
  `merged_into_id` points at the kept patient; checks keep it off active records and off the
  record itself. Indexes: unique `(tenant_id, display_number)`; unique `(tenant_id, external_id)`
  where the id is set; `(tenant_id, name_key, date_of_birth)` where active (duplicates);
  `(tenant_id, updated_at)` (recent). `updated_at` always comes from the database clock.
- `patient_counters` (tenant RLS): one row per tenant (`tenant_id` PK, `last_value`).

## Public API (`index.ts`)

`PatientsModule`, `PatientsService`, `PatientSearchInternal`, the domain errors
(`PatientNotFoundError`, `PatientArchivedError`, `PatientMergedError`, `MergeSameError`,
`UnknownDentistError`, `MergeAlertsOverflowError`), and the event names and types.

`PatientsService` (every input is the contract's Zod output; it returns the contract types):

| Method                                                   | Access          | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create(input)`                                          | `patient:write` | Invalid `phone`/`guardianPhone`, or a date of birth after the tenant's today → 422 `validation_failed` at that path. A dentist who is not an active practitioner → 422 `patient.unknown_dentist`. Mints the number, audits `patient.create`, emits `PatientCreated`.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `update(id, patch)`                                      | `patient:write` | The row is locked `FOR UPDATE`. 404 `patient.not_found`; archived → 409 `patient.archived`. Same field checks as create. A dentist kept from before may be inactive; a newly chosen one must be active. Only fields whose stored value changes are written; a patch that changes nothing writes, audits and emits nothing. Audits `patient.update` (before/after); emits `PatientUpdated { patientId, fields }`.                                                                                                                                                                                                                                                     |
| `get(id)`                                                | `patient:read`  | Archived and merged records included; 404 otherwise.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `getMany(ids)`                                           | `patient:read`  | For `billing` (existence checks, export rows): the visible patients among `ids`, archived included, in no particular order.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `search(query, internal?)`                               | `patient:read`  | Offset page `{ items, total, page, size }` (ADR-0018). See below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `counts()`                                               | `patient:read`  | `{ active, notSeen, archived }`, ignoring filters. `notSeen` equals `active` until visits exist (design Q14).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `duplicates()`                                           | `patient:read`  | Groups of active patients sharing `name_key` and a non-null date of birth, each ordered by number.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `checkDuplicates({ fullName, dateOfBirth, excludeId? })` | `patient:read`  | Active twins, for the create/edit warning.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `archive({ ids, reason? })`                              | `patient:write` | The rows are locked `FOR UPDATE` in id order before anything is read, so the audit's before-snapshot is the state the archive applies to. All-or-nothing: an id the tenant can't see → 404, and nothing changes. Already archived ids are no-ops. One `patient.archive` audit entry (with the reason) and one `PatientArchived` per archived patient. **Returns the patients this call archived, in input order**: what an undo should restore.                                                                                                                                                                                                                      |
| `restore({ ids })`                                       | `patient:write` | Locked and all-or-nothing like archive; any merged-away id → 409 `patient.merged`, checked under the lock before anything changes. Already active ids are no-ops. `patient.restore` and `PatientRestored` per restored patient. Returns the patients restored, in input order.                                                                                                                                                                                                                                                                                                                                                                                       |
| `merge({ keepId, dropId, fieldChoices, reason })`        | `patient:write` | One transaction; both rows locked `FOR UPDATE` in id order, so overlapping merges never deadlock. The same id → 422 `patient.merge_same` (over HTTP the contract answers first with 400 `validation_failed` at `dropId`). Either record archived → 409 `patient.archived`. Too many alerts → 422 `patient.merge_alerts_overflow`. The kept record gets the resolved fields (a picked phone is re-normalised for its search digits). The dropped one is archived with `merged_into_id`. Audits `patient.merge` on the kept id (reason; before = `{ kept, dropped }`; after = the kept record). Emits `PatientsMerged { keptId, droppedId }`. Returns the kept record. |

### `search(query, internal?)`

- `query` is `PatientListQuery`: `view`, `q`, `dentist` (user id or `none`), `age`
  (`child`/`adult`/`senior`, by date of birth against the tenant's today), `alerts`, `lastVisit`
  (no effect until visits exist), `sort`, `dir`, `page`, `size`.
- `view=notSeen` returns the active patients (design Q14).
- `sort`:
  - `name`, `age` (youngest first for `asc`; no date of birth last), `recent` (most recently
    updated first, whatever `dir` says).
  - `dentist`: ranks patients by their dentist's position in `UsersService.practitionersByIds`
    over every assigned dentist, inactive ones included, in display-name order (tenant-locale
    collation). `desc` reverses it. Patients without a dentist come last in both directions.
- Ties always break on `name_key`, then `id`.
- `internal` (`PatientSearchInternal`) is for other modules' services only. HTTP never reaches it.
  - `idsIn`: restricts the page to these ids. It is required for `view=owing`, which is read as
    active ∩ `idsIn`.
  - `rank { ids, restAt }`: orders by position in `ids`, with unlisted patients at `restAt`. It is
    required for `sort=balance`. The caller encodes the direction.
  - `size`: overrides the page size (1–500), for export.
  - Without them, `view=owing` or `sort=balance` → 422 `validation_failed` (path `view`/`sort`).

## HTTP

| Route                            | Access          | Notes                                                                                           |
| -------------------------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| `GET /patients`                  | `patient:read`  | `view=owing` and `sort=balance` → 400 `validation_failed`; `GET /billing/patients` serves them. |
| `GET /patients/counts`           | `patient:read`  |                                                                                                 |
| `GET /patients/duplicates`       | `patient:read`  |                                                                                                 |
| `GET /patients/duplicates/check` | `patient:read`  | `?fullName=&dateOfBirth=&excludeId=`                                                            |
| `GET /patients/:id`              | `patient:read`  |                                                                                                 |
| `POST /patients`                 | `patient:write` | 201 with the record.                                                                            |
| `PATCH /patients/:id`            | `patient:write` | At least one field.                                                                             |
| `POST /patients/archive`         | `patient:write` | 200 with the archived records.                                                                  |
| `POST /patients/restore`         | `patient:write` | 200 with the restored records.                                                                  |
| `POST /patients/merge`           | `patient:write` | 200 with the kept record.                                                                       |

## Events

- Emits (after commit; the generic audit subscriber records each one):
  - `PatientCreated { patientId }`
  - `PatientUpdated { patientId, fields }`: the names of the changed patch fields.
  - `PatientArchived { patientId }`
  - `PatientRestored { patientId }`
  - `PatientsMerged { keptId, droppedId }`: `billing` re-points ledger entries (design Q9).
- Consumes: —

## Depends on

- `tenancy`: country (phones) and time zone (today).
- `users`: practitioners for the primary dentist (ADR-0016).
- `audit`.

Nothing here imports `billing`. `billing` depends on `patients`.

## Permissions

- `patient:read`, `patient:write`: every system role (owner, dentist, assistant, front desk). A
  platform admin acting in the tenant also has them.
