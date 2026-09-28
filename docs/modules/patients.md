# `patients` module

**Status:** implemented. Patient records, search, duplicates, archive/restore and merge are done
(feature 3). Contacts & family (design addendum `2026-09-28-patients-contacts-design.md`): the
`contacts` and `patient_contacts` tables have landed; their service, routes and events arrive with
task H2. The odontogram is planned.

## Purpose

Patient records: demographics, phone and e-mail, insurance (as text), medical alerts/allergies,
primary dentist, notes, archive (soft delete) and merge; contacts (guardians, billing and
emergency contacts, who may themselves be patients: design addendum C1–C2). The POC's Patients
screen (list, quick view, create/edit, merge), the ⌘K palette and the patient record header are
the UI reference.
Balances are not here: views that need them (Owes balance, sort by balance, CSV export, create
with an opening balance) are composed by `billing` on top of this module (design Q5; ADR-0017).

- **Import key:** `externalId` is read-only over HTTP. It is not part of the create or edit
  contract; only the import (feature 6) will set it. Records created here have it null.
- **Display number:** `P-` plus at least 6 digits (`P-000001`). It comes from the tenant's
  `patient_counters` row, which the create transaction upserts. The row lock serialises
  concurrent creates, and a rolled-back create frees its number.
- **Phones:** normalised against the tenant `country` (`normalizePhone` in `@dcm/contracts`) and
  stored in E.164. A number typed with a leading `+` is accepted for any country.
  `phone_search` holds the E.164 digits and the national digits, so `03123…` and `96131…` both
  match.
- **Phone rule** (addendum C3): the phone is required unless the date of birth makes the patient
  a minor on the tenant's today (no date of birth = adult); blank means none. Create always
  checks it; an edit checks it when the patch touches `phone` or `dateOfBirth` (clearing an
  adult's phone, or giving a phoneless minor an adult or no date of birth), so a minor who has
  since come of age can still be edited without adding a phone first; a merge checks the resolved
  phone and date of birth the same way. Failure → 422 `validation_failed`, path `phone`, code
  `required`. A patient without a phone has `phone` and `phone_search` null and is never matched
  by phone digits.
- **Primary dentist:** `primaryDentistId` is the dentist's staff profile id (`staff_profiles.id`,
  `Practitioner.id`; ADR-0020, amending ADR-0016), never the auth user id. A newly chosen one
  must be among `UsersService.listPractitioners()` (active dentists); names, inactive dentists
  included, come from `practitionersByProfileIds`.
- **Dates:** the date of birth must not be after the tenant's today, computed from the injected
  clock in the tenant time zone (`localDate` in `platform/kernel`). Age bands use the same today.
- **Search `q`:** a diacritics-insensitive substring of `name_key`, the display number, the
  e-mail, and, when the query has at least 2 digits, the phone digits. A query shaped like a
  patient number (`P-000123`, `p000123`: `/^p-?\d+$/i`) matches display numbers only, as
  `P-<digits>`; its digits never search phones. Bare digits (`000123`) are still a phone query.
- **Archive** sets `deleted_at` (design Q11). The optional reason goes to the audit entry only.
  A merged-away record is archived and has `merged_into_id`; it can never be restored.
- **Merge** (design Q8): each pickable field (`MERGE_FIELDS`: full name, phone, date of birth,
  sex, e-mail, address, insurance, primary dentist, notes) comes from the kept record unless the
  choice is `drop`; a picked phone may be null (a minor), subject to the phone rule. Medical
  alerts are always the union of both records and are never truncated: more than 20 refuses the
  merge.

## Owns

- `patients` (tenant RLS): the record, plus the internal search columns `name_key` and
  `phone_search`. `sex` is a Postgres enum (`patient_sex`) and `medical_alerts` is a `text[]`.
  `phone`/`phone_search` are nullable (a minor without a phone). `primary_dentist_id` is a staff
  profile id with no foreign key (ADR-0020; `users` owns `staff_profiles`).
  `merged_into_id` points at the kept patient; checks keep it off active records and off the
  record itself. Indexes: unique `(tenant_id, id)` (target of the contact foreign keys); unique
  `(tenant_id, display_number)`; unique `(tenant_id, external_id)` where the id is set;
  `(tenant_id, name_key, date_of_birth)` where active (duplicates); `(tenant_id, updated_at)`
  (recent). `updated_at` always comes from the database clock.
- `patient_counters` (tenant RLS): one row per tenant (`tenant_id` PK, `last_value`).
- `contacts` (tenant RLS, soft delete; schema landed, API in H2): `full_name?`, `phone?` (E.164),
  `phone_search?`, `email?`, `linked_patient_id?`. A contact linked to a patient stores no name,
  phone or e-mail of its own (they are read from the patient), so a check requires
  `linked_patient_id` or `full_name`. Unique `(tenant_id, id)`; at most one live contact per
  linked patient (partial unique `(tenant_id, linked_patient_id)` where linked and not deleted);
  `(tenant_id, linked_patient_id)` → `patients (tenant_id, id)`.
- `patient_contacts` (tenant RLS, junction: hard delete; schema landed, API in H2): PK
  `(patient_id, contact_id)`, `relationship` (Postgres enum `contact_relationship`: parent,
  spouse, child, sibling, caregiver, other — the contact's relation to the patient), the role
  flags `is_guardian`, `is_billing_contact`, `is_emergency_contact` and one primary flag per role.
  Checks: at least one role; each primary implies its role. At most one primary per role per
  patient (partial unique `(tenant_id, patient_id)` per primary flag). Composite foreign keys
  `(tenant_id, patient_id)` → `patients` and `(tenant_id, contact_id)` → `contacts` keep both
  ends in the link's tenant. Indexes on `tenant_id` and `contact_id`.

## Public API (`index.ts`)

`PatientsModule`, `PatientsService`, `PatientSearchInternal`, `PatientRankKeys`, the domain errors
(`PatientNotFoundError`, `PatientArchivedError`, `PatientMergedError`, `MergeSameError`,
`UnknownDentistError`, `MergeAlertsOverflowError`), and the event names and types.

`PatientsService` (every input is the contract's Zod output; it returns the contract types):

| Method                                                   | Access          | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create(input)`                                          | `patient:write` | An invalid `phone`, a missing one for an adult (the phone rule), or a date of birth after the tenant's today → 422 `validation_failed` at that path. A `primaryDentistId` that is not the profile id of an active practitioner → 422 `patient.unknown_dentist`. Mints the number, audits `patient.create`, emits `PatientCreated`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `update(id, patch)`                                      | `patient:write` | The row is locked `FOR UPDATE`. 404 `patient.not_found`; archived → 409 `patient.archived`. Same field checks as create. A dentist kept from before may be inactive; a newly chosen one must be active. Only fields whose stored value changes are written; a patch that changes nothing writes, audits and emits nothing. Audits `patient.update` (before/after); emits `PatientUpdated { patientId, fields }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `get(id)`                                                | `patient:read`  | Archived and merged records included; 404 otherwise.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `getMany(ids)`                                           | `patient:read`  | For `billing` (existence checks, export rows): the visible patients among `ids`, archived included, in no particular order.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `lockForLedger(id)`                                      | `patient:read`  | For `billing`'s ledger writes, inside the caller's open transaction (throws if there is none). Reads the row `FOR SHARE`, so a merge, archive or edit (`FOR UPDATE`) waits until the ledger entry commits. Unknown → 404 `patient.not_found`; merged away → 409 `patient.merged`. Archived but not merged is allowed (a debt write-off). Returns the record.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `survivorOf(id)`                                         | none (job only) | For `billing`'s merge re-point, inside the caller's open transaction (throws if there is none). Follows `mergedIntoId` from `id` to the patient it finally lives on (`id` itself unless merged away; A into B, B into C → C), reading each record `FOR SHARE` so the survivor cannot be merged away before the caller commits. `null` when `id` (or a link) is not a patient of this tenant. A cycle or a chain over 100 links throws. Not permission-gated (a job actor holds no permissions) but refuses any actor other than a job or system task.                                                                                                                                                                                                                                                                                                                        |
| `search(query, internal?)`                               | `patient:read`  | Offset page `{ items, total, page, size }` (ADR-0018). See below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `searchIds(query, internal?)`                            | `patient:read`  | Every matching id, in the order `search` would page them, unpaged: the snapshot `billing`'s CSV export streams from. Same query (paging ignored), internal options and validation as `search`. Bounded by the tenant's patient count (ADR-0018).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `counts()`                                               | `patient:read`  | `{ active, notSeen, archived }`, ignoring filters. `notSeen` equals `active` until visits exist (design Q14).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `duplicates()`                                           | `patient:read`  | Groups of active patients sharing `name_key` and a non-null date of birth, each ordered by number.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `checkDuplicates({ fullName, dateOfBirth, excludeId? })` | `patient:read`  | Active twins, for the create/edit warning.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `archive({ ids, reason? })`                              | `patient:write` | The rows are locked `FOR UPDATE` in id order before anything is read, so the audit's before-snapshot is the state the archive applies to. All-or-nothing: an id the tenant can't see → 404, and nothing changes. Already archived ids are no-ops. One `patient.archive` audit entry (with the reason) and one `PatientArchived` per archived patient. **Returns the patients this call archived, in input order**: what an undo should restore.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `restore({ ids })`                                       | `patient:write` | Locked and all-or-nothing like archive; any merged-away id → 409 `patient.merged`, checked under the lock before anything changes. Already active ids are no-ops. `patient.restore` and `PatientRestored` per restored patient. Returns the patients restored, in input order.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `merge({ keepId, dropId, fieldChoices, reason })`        | `patient:write` | One transaction. An archived or merged-away record is refused first, unlocked (fail fast, so a doomed merge never queues behind the re-point job's `FOR SHARE` walk); then both rows are locked `FOR UPDATE` in id order, so overlapping merges never deadlock, and the check is repeated under the lock. The same id → 422 `patient.merge_same` (over HTTP the contract answers first with 400 `validation_failed` at `dropId`). Either record archived → 409 `patient.archived`. Too many alerts → 422 `patient.merge_alerts_overflow`. The kept record gets the resolved fields (a picked phone is re-normalised for its search digits). The dropped one is archived with `merged_into_id`. Audits `patient.merge` on the kept id (reason; before = `{ kept, dropped }`; after = the kept record). Emits `PatientsMerged { keptId, droppedId }`. Returns the kept record. |

### `search(query, internal?)`

- `query` is `PatientListQuery`: `view`, `q`, `dentist` (staff profile id or `none`), `age`
  (`child`/`adult`/`senior`, by date of birth against the tenant's today), `alerts`, `lastVisit`
  (no effect until visits exist), `sort`, `dir`, `page`, `size`.
- `view=notSeen` returns the active patients (design Q14).
- `sort`:
  - `name`, `age` (youngest first for `asc`; no date of birth last), `recent` (most recently
    updated first, whatever `dir` says).
  - `dentist`: ranks patients by their dentist in `UsersService.practitionersByProfileIds` over
    every assigned dentist (profile ids), inactive ones included, in display-name order
    (tenant-locale collation).
    `domain/dentist-rank.ts` gives each dentist an integer key, dense-ranked: dentists whose
    names are equal under that collation share a key, so their patients sort by patient name.
    `desc` reverses the keys. Patients without a dentist come last in both directions.
- Ties always break on `name_key`, then `id`.
- Rank ordering (`sort=dentist`, `sort=balance`; design Q7): `coalesce(keys[array_position(ids,
column)], restKey)` ascending, then `name_key`, then `id`; `dir` is ignored, the caller
  encodes the direction in the keys. `ids` and `keys` must have the same length and the keys
  must be 32-bit integers (`RangeError` otherwise).
- `internal` (`PatientSearchInternal`) is for other modules' services only. HTTP never reaches it.
  The rank shape is exported as `PatientRankKeys`.
  - `idsIn`: restricts the page to these ids. It is required for `view=owing`, which is read as
    active ∩ `idsIn`.
  - `rank { ids, keys, restKey }`: `keys[i]` is the sort key of patient `ids[i]`; unlisted
    patients get `restKey`. Equal keys tie and fall back to the name order. It is required for
    `sort=balance` (`billing`'s `rankByBalance`).
  - `size`: overrides the page size (1–500) for `search` (e.g. a one-row page when only the total
    counts).
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
  - `PatientsMerged { keptId, droppedId }`: consumed by `billing`, which re-points the dropped
    patient's ledger entries to the kept one through a BullMQ job (design Q9, ADR-0017).
- Consumes: —

## Depends on

- `tenancy`: country (phones) and time zone (today).
- `users`: practitioners for the primary dentist, by staff profile id (`listPractitioners`,
  `practitionersByProfileIds`; ADR-0016, ADR-0020).
- `audit`.

Nothing here imports `billing`. `billing` depends on `patients` (`create`, `getMany`,
`lockForLedger`, `search`/`searchIds` with their internal options, `survivorOf`, and
`PatientsMerged`).

## Permissions

- `patient:read`, `patient:write`: every system role (owner, dentist, assistant, front desk). A
  platform admin acting in the tenant also has them.
