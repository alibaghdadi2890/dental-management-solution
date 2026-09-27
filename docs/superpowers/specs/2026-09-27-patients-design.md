# Feature 3 — Patients — design

Date: 2026-09-27 · Status: draft for review

## Goal

Front desk and clinicians create, find, edit, archive, restore and merge patients on the POC's
Patients screen (`Dental Clinic POC/Patients.dc.html`, README §Patients), reach any patient from
the shell's ⌘K palette and "New patient" button (README §App shell), and open the patient record
shell (`ClinicalWorkspace.dc.html`, `clinical-workspace-spec.md` §Screen 3 — header, Overview,
Patient information). A patient carried over from a previous system can start with an opening
balance, which lives in a new `billing` module. Everything is audited, tenant-isolated, tested and
documented.

Out of scope: visits, charting, payments/receipts beyond the opening-balance entry, insurance
details beyond a text field, attachments, SMS reminders, import (feature 6 uses `externalId`).

## Decisions

The brief's P1–P12 stand, with the changes below. ✓ = confirmed by the product owner while
designing.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                           | ADR  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| Q1✓ | **Create with opening balance is orchestrated by `billing`**: `POST /billing/opening-balances` calls `PatientsService.create` and records the ledger entry in one `TenantDb` transaction (the `users.createStaffUser` pattern). The SPA uses it only when an amount > 0 is entered; otherwise `POST /patients`.                                                                                                    | 0017 |
| Q2✓ | **The primary dentist is stored as the auth user id** (`primary_dentist_user_id`), the key `UsersService` uses everywhere. Validated through `UsersService.listPractitioners()`. New edge `patients → users` (P3).                                                                                                                                                                                                 | 0016 |
| Q3✓ | **Tenants gain a `country`** (ISO 3166-1 alpha-2, default `LB`), edited in the admin Settings tab and exposed in the session. Phones are parsed against it with `libphonenumber-js` (new dependency of `@dcm/contracts`, pure) and stored in E.164; international numbers (`+…`) are accepted as typed.                                                                                                            | —    |
| Q4✓ | **Export CSV is served by `billing`** (`GET /billing/patients/export`), because its columns include Balance, which `patients` cannot read.                                                                                                                                                                                                                                                                         | 0017 |
| Q5  | **Patient views that need balances are composed by `billing`**: the _Owes balance_ view and sort by balance are one route, `GET /billing/patients`, taking the same query as `GET /patients` and returning the same page shape (the brief's `/billing/owing-patients`, generalised). `patients` never imports `billing` (P5).                                                                                      | 0017 |
| Q6  | **Offset paging for the patients list only** (P9). `GET /patients` takes `page`/`size` and returns `total`, with no cursor: the POC pager needs `total` and page numbers, and patients per tenant are bounded (thousands, not millions). This is an exception to CLAUDE.md §12, which is amended to name it.                                                                                                       | 0018 |
| Q7  | **Rank ordering** instead of cross-module joins: `PatientsService.search` takes an internal `rank: { ids, restAt }` (never exposed over HTTP) and orders by `coalesce(array_position(ids, id), restAt)`, then name. `billing` uses it for sort by balance (non-zero balances in order; zero balances at `restAt`); `patients` uses it for sort by dentist (practitioner ids ordered by display name from `users`). | —    |
| Q8  | **Medical alerts are always unioned on merge**, never picked: losing an allergy on merge is a clinical risk. The POC picks a value per field; every other field is still picked. If the union exceeds 20 alerts the merge is refused (422 `patient.merge_alerts_overflow`) rather than truncated.                                                                                                                  | —    |
| Q9  | **Ledger entries follow a merge through a BullMQ job.** `billing` handles `PatientsMerged` (dispatched after commit) by enqueueing a tenant job with `jobId = merge:<droppedId>`; the worker re-points `ledger_entries` idempotently, retried with backoff, dead-lettered on failure (CLAUDE.md §9). A crash between commit and enqueue would skip it; this window is documented in ADR-0017.                      | 0017 |
| Q10 | **The quick view's activity timeline needs `audit:read`** (owner, dentist). Front desk and assistants do not see it. The POC shows it to everyone; this is a deliberate deviation (P12).                                                                                                                                                                                                                           | —    |
| Q11 | **Archive is `deleted_at`** (CLAUDE.md §7 soft delete). The optional reason goes to the audit entry only. A merged-away record has `merged_into_id`; restoring it is refused (`409 patient.merged`).                                                                                                                                                                                                               | —    |
| Q12 | **No uniqueness on opening balances**: a merge moves both records' opening balances onto the kept patient. "Opening balance on create only" is enforced by the route, not the schema.                                                                                                                                                                                                                              | —    |
| Q13 | **Balance = Σ amount per currency.** Entries are stamped with the tenant currency; a tenant currency change converts nothing (ADR-0015). APIs return `balances: Money[]`; the UI leads with the tenant currency and lists others after it. "Owing" = any amount > 0.                                                                                                                                               | —    |
| Q14 | **Visits and Last visit are not sortable** until feature 4; the _Not seen 6+ months_ view returns every non-archived patient ("never seen"), and the Last-visit chip offers only "Any time" and "Never". The Visits column and the Last-visit column render "—".                                                                                                                                                   | —    |
| Q15 | **Palette "recent" = the 5 most recently updated active patients** (`sort=recent`), not a client-side history.                                                                                                                                                                                                                                                                                                     | —    |
| Q16 | **Patient information save-state** (design gap): the workspace indicator's idle label "Autosaves as you type" does not fit an explicit Save button. States: clean → nothing; dirty → "Unsaved changes" (muted); saving → "Saving…"; saved → "✓ Saved just now"; failed → "Failed to save — retry" (retry re-submits, input kept).                                                                                  | —    |
| Q17 | **Date-of-birth input order follows the tenant**: day/month order comes from `Intl` for `${locale}-${country}` (`en-LB` → DD/MM/YYYY, `en-US` → MM/DD/YYYY). Stored as ISO `date`; displayed "4 Sep 2026" by the shared formatter.                                                                                                                                                                                 | —    |

## Module graph changes

```
patients  → tenancy (time zone, country), users (practitioners), audit   patients, patient_counters
billing   → patients, tenancy (currency), audit                          ledger_entries   (new)
users     + listPractitioners(), GET /users/practitioners
tenancy   + tenants.country
```

`users` never imports `patients`; `patients` never imports `billing`. The CLAUDE.md §4 map lists
`billing → patients, clinical`; `clinical` joins in feature 5.

## Data model

All ids uuid v7 from the application; `created_at`/`updated_at`; `tenantIdColumn()` +
`tenantIsolationPolicy()` + an index on `tenant_id`.

### `tenancy`

`tenants.country char(2) not null default 'LB'` (migration backfills existing tenants with `LB`).

### `patients`

| Table              | Columns                                                                                                                                                                                                                                                                                                                                                                                                                                    | Constraints                                                                                                                                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `patients`         | `id`, `tenant_id`, `display_number`, `full_name`, `name_key`, `phone` (E.164), `phone_search`, `date_of_birth?` (date), `sex` (`patient_sex` enum: `female`, `male`, `other`, `unknown`; default `unknown`), `email?`, `address?`, `insurance?`, `emergency_contact?`, `medical_alerts text[]` (default `{}`), `primary_dentist_user_id?`, `notes?`, `guardian_name?`, `guardian_phone?`, `external_id?`, `merged_into_id?`, `deleted_at?` | Tenant RLS. Unique `(tenant_id, display_number)`. Unique `(tenant_id, external_id) where external_id is not null`. Index `(tenant_id, name_key, date_of_birth) where deleted_at is null` (duplicates). Index `(tenant_id, updated_at)`. |
| `patient_counters` | `tenant_id` (PK), `last_value int`                                                                                                                                                                                                                                                                                                                                                                                                         | Tenant RLS.                                                                                                                                                                                                                             |

- `name_key` = full name → NFD → combining marks removed (covers Latin diacritics and Arabic
  tashkeel) → lower-cased → whitespace collapsed. Written by the repository from the pure
  `domain/name-key.ts`; search and duplicates use it.
- `phone_search` = the E.164 digits and the national-format digits, space-separated (`9613123456
03123456`), so typing a local number with its trunk `0` still matches.
- Display number: `INSERT INTO patient_counters … ON CONFLICT (tenant_id) DO UPDATE SET last_value =
last_value + 1 RETURNING last_value` inside the create transaction (the row lock serialises
  concurrent creates, as `FOR UPDATE` would; a rolled-back create frees its number). Format `P-` +
  6-digit zero padding (`P-000001`; grows past 999999).
- `sex` is a Postgres enum (stable set); `medical_alerts` items are trimmed, 1–60 chars, at most
  20, de-duplicated case-insensitively.
- Age and dentition stage are derived, never stored.

### `billing`

| Table            | Columns                                                                                                                                                                                                                                                                                 | Constraints                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `ledger_entries` | `id`, `tenant_id`, `patient_id` (no FK: `patients` owns that table), `kind` (`ledger_entry_kind` enum: `opening_balance`, `adjustment`), `amount numeric(12,2)` (signed; positive = the patient owes), `currency char(3)`, `effective_date date`, `note?`, `reason?`, `created_by uuid` | Tenant RLS. Index `(tenant_id, patient_id)`. Check `amount <> 0`. |

Entries are never edited or deleted; the merge worker is the only writer that updates
(`patient_id` only).

## Contracts (`packages/contracts`)

- `common.ts`: `countrySchema` (ISO alpha-2); `offsetPageSchema(item)` `{ items, total, page, size }`.
- `phone.ts`: `normalizePhone(input, country) → { e164, national } | null`, `formatPhone(e164)`,
  `phoneDigits(query)`; built on `libphonenumber-js/max` (full metadata, about 40 KB gzipped in the SPA: `/min` accepted about 6% of invalid numbers, and reminders need valid ones). Numbers with an extension are rejected.
- `patients.ts`:
  - `patientSexSchema`; `medicalAlertsSchema`; `displayNumberSchema` (`^P-\d{6,}$`).
  - `patientInputSchema` `{ fullName, phone, dateOfBirth?, sex?, email?, address?, insurance?,
emergencyContact?, medicalAlerts?, primaryDentistUserId?, notes?, guardianName?, guardianPhone?
}` (phone is the raw text; the server normalises it with the tenant country). `externalId` is not
    an input: it is set only by the import (feature 6), and `patientSchema` exposes it read-only.
    `patientPatchSchema` = partial, at least one key.
  - `patientSchema` (full record incl. `displayNumber`, `archivedAt`, `mergedIntoId`, `createdAt`,
    `updatedAt`) and `patientListItemSchema` (list/palette columns).
  - `patientListQuerySchema` `{ view: active|owing|notSeen|archived (default active), q?, dentist?
(user id | 'none'), age?: child|adult|senior, alerts?: yes|no, lastVisit?: any|never, sort:
name|age|dentist|recent|balance, dir: asc|desc, page (≥1), size: 10|25|50 }`. `view=owing` and
    `sort=balance` are accepted by the billing route only; `GET /patients` answers them with 400.
  - `patientCountsSchema` `{ active, notSeen, archived }`.
  - `duplicateGroupSchema` `{ patients: PatientListItem[] }[]`; `duplicateCheckQuerySchema`
    `{ fullName, dateOfBirth, excludeId? }`.
  - `patientArchiveSchema` `{ ids (1–100), reason? (≤ 500) }`; `patientRestoreSchema` `{ ids }`.
  - `mergeFieldSchema` (the pickable fields: fullName, phone, dateOfBirth, sex, email, address,
    insurance, emergencyContact, primaryDentistUserId, notes, guardian — the guardian pair moves
    together); `patientMergeSchema` `{ keepId, dropId, fieldChoices: Partial<Record<field,
'keep'|'drop'>>, reason (trim, 3–500) }` — a missing choice means "keep".
  - Pure helpers: `ageOn(dob, today)`, `dentitionStage(age)` (`primary` 0–5, `mixed` 6–12,
    `permanent` 13+), `ageBand(age)`, `isMinor(dob, today)`, `profileCompleteness(patient)`
    (`complete` when email and address are both present, else `partial`).
- `billing.ts`: `ledgerEntryKindSchema`; `openingBalanceInputSchema` `{ amount (> 0), asOf
(date, ≤ today), note? (≤ 200) }`; `createWithOpeningBalanceSchema` `{ patient:
patientInputSchema, openingBalance }`; `adjustmentInputSchema` `{ amount (≠ 0), effectiveDate,
reason (3–500), note? }`; `patientBalanceSchema` `{ patientId, balances: Money[] }`;
  `balancesQuerySchema` `{ patientIds (1–100, comma-separated) }`; `patientExportQuerySchema` =
  list query + `ids?`.
- `tenancy.ts` / `session.ts`: `country` on tenant settings and the session tenant.
- `users.ts`: `practitionerSchema` `{ userId, displayName, title }`.

## Backend

### `tenancy`

Settings contract, repository and admin Settings update gain `country`; `TenancyService.currentTenant()`
returns it. Migration adds the column.

### `users`

- `listPractitioners()` — active staff whose `practitioner_type = 'dentist'`, ordered by display
  name. Not permission-gated (a building block like `activeBranches`); `GET /users/practitioners`
  requires `user:read` (every system role holds it).
- `practitionersByIds(ids)` — including inactive ones, for display names of already-assigned
  dentists.

### `patients`

```
patients/
  domain/        name-key.ts, display-number.ts, merge.ts (field resolution + alert union),
                 duplicates.ts, patient-errors.ts
  persistence/   schema.ts, patients.repository.ts, patient-counters.repository.ts
  application/   patients.service.ts
  http/          patients.controller.ts
  events/        patient-events.ts
```

| Method                                                   | Permission      | Notes                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create(input)`                                          | `patient:write` | Phone normalised with the tenant country (invalid → 422 `validation_failed`, path `phone`; same for `guardianPhone`). Dentist must be in `listPractitioners()` (422 `patient.unknown_dentist`). Mints the display number. Audited `patient.create`; emits `PatientCreated`.                                                                                                       |
| `update(id, patch)`                                      | `patient:write` | Archived → 409 `patient.archived`. A dentist kept from before may be inactive; a new one must be active. Audited `patient.update` with before/after; emits `PatientUpdated { patientId, fields }`.                                                                                                                                                                                |
| `get(id)`                                                | `patient:read`  | Archived records included. Unknown/other tenant → 404 `patient.not_found`.                                                                                                                                                                                                                                                                                                        |
| `getMany(ids)`                                           | —               | Exported building block for `billing` (existence checks, export rows).                                                                                                                                                                                                                                                                                                            |
| `search(query & { idsIn?, rank? })`                      | `patient:read`  | Offset page with `total`. `q`: `name_key` substring (query normalised the same way), display-number substring, e-mail substring, and — when the query has ≥ 2 digits — digits substring on `phone_search`. Age band from `date_of_birth` against today in the tenant time zone.                                                                                                   |
| `counts()`                                               | `patient:read`  | `{ active, notSeen, archived }`, ignoring search and filters (the tab chips).                                                                                                                                                                                                                                                                                                     |
| `duplicates()`                                           | `patient:read`  | Groups of active patients sharing `name_key` and a non-null `date_of_birth`.                                                                                                                                                                                                                                                                                                      |
| `checkDuplicates({ fullName, dateOfBirth, excludeId? })` | `patient:read`  | The create/edit panel's warning.                                                                                                                                                                                                                                                                                                                                                  |
| `archive(ids, reason?)` / `restore(ids)`                 | `patient:write` | All-or-nothing; already-archived/active ids are no-ops. Restoring a merged record → 409 `patient.merged`. One audit entry and one event per patient.                                                                                                                                                                                                                              |
| `merge({ keepId, dropId, fieldChoices, reason })`        | `patient:write` | One transaction, both rows locked `FOR UPDATE` in id order. Same id → 422 `patient.merge_same`; either archived → 409 `patient.archived`. Kept record gets the chosen values and the union of alerts; dropped record archived with `merged_into_id`. Audited `patient.merge` (before = both records, after = the kept one, reason); emits `PatientsMerged { keptId, droppedId }`. |

Events (`events/patient-events.ts`): `PatientCreated { patientId }`, `PatientUpdated { patientId,
fields }`, `PatientArchived { patientId }`, `PatientRestored { patientId }`, `PatientsMerged {
keptId, droppedId }`.

Routes (`patient:read` unless noted):

| Route                            | Access          |
| -------------------------------- | --------------- |
| `GET /patients`                  | `patient:read`  |
| `GET /patients/counts`           | `patient:read`  |
| `GET /patients/duplicates`       | `patient:read`  |
| `GET /patients/duplicates/check` | `patient:read`  |
| `GET /patients/:id`              | `patient:read`  |
| `POST /patients`                 | `patient:write` |
| `PATCH /patients/:id`            | `patient:write` |
| `POST /patients/archive`         | `patient:write` |
| `POST /patients/restore`         | `patient:write` |
| `POST /patients/merge`           | `patient:write` |

### `billing` (new module)

```
billing/
  domain/        balances.ts (sum per currency, owing), balance-rank.ts (rank + restAt), billing-errors.ts
  persistence/   schema.ts, ledger-entries.repository.ts
  application/   billing.service.ts, patient-views.service.ts, patient-export.service.ts,
                 merge-ledger.subscriber.ts, merge-ledger.worker.ts
  http/          billing.controller.ts, billing-patients.controller.ts
  events/        ledger-events.ts (LedgerEntryRecorded { entryId, patientId, kind })
```

| Method                                                  | Permission                                     | Notes                                                                                                                                                                                                                                  |
| ------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createWithOpeningBalance({ patient, openingBalance })` | `payment:write` + `patient:write`              | One transaction: `PatientsService.create` then the `opening_balance` entry (tenant currency). Audited `ledger_entry.create`. Returns `{ patient, balance }`.                                                                           |
| `recordOpeningBalance(patientId, input)`                | `payment:write`                                | Building block for the method above and feature 6 import. Unknown patient → 404.                                                                                                                                                       |
| `adjustBalance(patientId, input)`                       | `payment:write`                                | Signed amount, reason required. No UI in this feature.                                                                                                                                                                                 |
| `balanceOf(patientId)` / `balancesFor(patientIds)`      | `payment:read`                                 | Patients without entries get `balances: []`.                                                                                                                                                                                           |
| `patientIdsOwing()`                                     | —                                              | Exported building block.                                                                                                                                                                                                               |
| `PatientViewsService.list(query)`                       | `payment:read` (+ `patient:read` via `search`) | `view=owing` → `search({ …, view: active, idsIn: owing })`; `sort=balance` → `search({ …, rank })` using the balance order in `dir`.                                                                                                   |
| `PatientViewsService.owingCount()`                      | `payment:read` (+ `patient:read`)              | Active patients owing.                                                                                                                                                                                                                 |
| `PatientExportService.stream(query)`                    | `payment:read` (+ `patient:read`)              | Pages through `search` (size 500) or `getMany(ids)`, adds balances, writes RFC 4180 CSV with the table's columns (Patient ID, Name, Age, Sex, Phone, Last visit, Dentist, Visits, Balance), header row localised by `Accept-Language`. |

Merge (Q9): `MergeLedgerSubscriber` handles `PatientsMerged` and enqueues
`billing.merge-ledger` with `{ tenantId, keptId, droppedId }`, `jobId = merge:<droppedId>`.
`MergeLedgerWorker` (a `TenantWorker`) runs `UPDATE ledger_entries SET patient_id = keptId WHERE
patient_id = droppedId` as a `job` actor and audits `ledger_entry.repoint` with the count.

Routes:

| Route                                    | Access (route) + service re-check   |
| ---------------------------------------- | ----------------------------------- |
| `POST /billing/opening-balances`         | `payment:write` (+ `patient:write`) |
| `POST /billing/patients/:id/adjustments` | `payment:write`                     |
| `GET /billing/balances?patientIds=`      | `payment:read`                      |
| `GET /billing/patients/:id/balance`      | `payment:read`                      |
| `GET /billing/patients`                  | `payment:read` (+ `patient:read`)   |
| `GET /billing/patients/owing-count`      | `payment:read` (+ `patient:read`)   |
| `GET /billing/patients/export`           | `payment:read` (+ `patient:read`)   |

`@RequirePermission` takes one permission; the second one is enforced by the service (CLAUDE.md
§6: services re-check anyway).

## Frontend

### Structure

```
routes/_app/patients/index.tsx              list; URL search = list query + panel
routes/_app/patients/$patientId.tsx         record; ?tab=overview|information
features/patients/
  patients-api.ts                           queries, mutations, keys (incl. billing views/balances)
  list-query.ts (+ spec)                    URL search schema, defaults, "differs from default"
  patients-page.tsx                         header, tabs, banner, filters, table, bulk bar, pager
  patients-table.tsx, patient-row-menu.tsx, filter-bar.tsx, bulk-bar.tsx, pager.tsx (+ spec)
  panels/quick-view-panel.tsx, panels/patient-form-panel.tsx, panels/merge-panel.tsx
  patient-form.ts (+ spec)                  pure form model: validation, dirty, guardian rule, payload
  merge-draft.ts (+ spec)                   field choices, preview of the kept record
  record/patient-record-page.tsx, record/record-header.tsx, record/overview-tab.tsx,
  record/information-tab.tsx
  command-palette.tsx (+ spec)              mounted in the shell
features/billing/
  billing-api.ts, balance-card.tsx, money-input.tsx
shell/app-header.tsx                        "Find patient ⌘K", "New patient"
locales/{en,ar,fr}/patients.json, billing.json
```

### Patients list (pixel port of `Patients.dc.html`)

- Header: "Patients" + subtitle; **Export CSV** (outline) → `GET /billing/patients/export` with the
  current query; **New patient** (primary, `patient:write`) → `?panel=new`.
- Saved-view tabs Active · Owes balance · Not seen 6+ months · Archived with count chips
  (`/patients/counts` + `/billing/patients/owing-count`).
- Duplicate banner (amber) when `duplicates()` is non-empty: "N possible duplicate records" +
  "Review & merge" (opens the merge panel on the first group).
- Filter bar: search (debounced 250ms), chips Dentist (Any, practitioners, "No dentist"), Last visit
  (Any time, Never — Q14), Age (All, Under 18, 18–64, 65+), Alerts (Any, Has alerts, None); a chip
  that differs from its default is tinted; "Clear filters" when any is active.
- Table (min-width 940px, horizontal scroll): checkbox · Patient (avatar, name, `P-…`, alert and
  Archived badges) · Age·sex · Phone (Mono, formatted) · Last visit ("—") · Dentist · Visits ("—")
  · Balance (tenant currency; `#9b2c2c` 600 when > 0; "—" while balances load) · ⋯. Sortable: Patient,
  Age, Dentist, Balance (Q14). Data source: `GET /patients`, or `GET /billing/patients` when
  `view=owing` or `sort=balance`; balances for the page from `GET /billing/balances`.
- Row click opens the record. ⋯ menu: Open record, Quick view, Edit details, Merge with {twin ID}
  (when the row is in a duplicate group), Archive/Restore. **No Start visit.**
- Bulk bar: N selected · Merge 2 records (exactly 2) · Export (selected ids) · Archive/Restore ·
  Clear selection.
- Pager: "Showing 11–20 of 54", Rows 10/25/50, numbered buttons (first, last, current ±1, gaps).
- Archive (row or bulk): confirm dialog with an optional reason → toast with **Undo** (restore).
- States per README §System states: skeleton rows, empty ("No patients yet" + New patient), no
  results (names the view + "Clear search and filters"), error (request id + Try again, filters
  kept).

### Right panel (440px)

- **Quick view**: details (number, age·sex, phone, email, DOB, dentist, insurance), alerts,
  **Open balance** (`payment:read`), activity timeline from `GET /audit?resourceType=patient&resourceId=`
  only with `audit:read` (Q10), actor names from `GET /users`; footer Open record · Edit.
- **Create / Edit**: Full name* and Phone* (required style); demoted optional grid: Date of birth
  (Q17), Sex, Email, Address, Insurance, Emergency contact, Medical alerts (comma-separated →
  chips), Primary dentist (select from `/users/practitioners`), Notes. **Guardian name / Guardian
  phone** appear, demoted, only while the DOB makes the patient under 18 (a hidden guardian is
  sent as null). Age line and dentition-stage helper under the DOB ("7 yrs · mixed dentition").
  Inline errors `#9b2c2c`; "Unsaved" badge while dirty; closing while dirty asks "Discard unsaved
  changes?". Debounced duplicate warning when name + DOB match (not blocking; "Open P-…").
- **Account** group (create only, `payment:write`): Opening balance (36px Mono, right-aligned,
  tenant currency suffix), As of (date, default today in the tenant time zone), Note ("Optional —
  e.g. carried over from previous system"). Amount > 0 → `POST /billing/opening-balances`,
  otherwise `POST /patients`. Success toast "Patient created" with **Open record**.
- **Merge**: 3-column compare grid (field · record A · record B) with a radio per differing field,
  "Keep ID" choice, medical alerts shown as the union (Q8), required reason (≥ 3 chars) →
  `POST /patients/merge` → toast "Records merged" → the kept record's quick view.

### Shell

- Header right side: **Find patient ⌘K** (260px search button) and **New patient** (`patient:write`)
  → `/patients?panel=new`.
- **⌘K / Ctrl+K** opens the command palette (workspace spec §Global Patient Search): no query → 5
  most recently updated patients (Q15); otherwise `GET /patients?q=&size=8` (the same matching);
  rows show avatar, name, ID, phone, "Age n", "Never seen"; Enter/arrows navigate; no results →
  **Create "{query}"** → the create panel pre-filled (digits → phone, otherwise name). Archived
  patients never appear.

### Patient record `/patients/$patientId`

- Header: "All patients" back link (history back, else `/patients`); 52px avatar; name; Mono ID ·
  age line (`"<age> yrs · <dob>"`, the DOB alone, or "Age not recorded") · phone; alert chips;
  **Edit patient** → `/patients?panel=edit:<id>` over the list, as the README says. An archived
  record shows an Archived badge and **Restore** (`patient:write`) instead of Edit; a merged one
  shows "Merged into P-…" linking to the kept record.
- Tabs: **Overview** · **Patient information** only.
- Overview: **Balance** card (Previous outstanding = the ledger balance, Current visit outstanding
  "—", Total outstanding 700/24px Mono, danger when owing, success when clear; no Record payment);
  **Treatment summary** (six rows, zeros); **Patient information** card (Phone, Date of birth,
  Email, Address, Insurance, Emergency; "Not recorded" when missing; "Complete →" opens the
  information tab).
- Patient information tab: the full editable form (same model as the panel, incl. guardian rule),
  completeness badge (Complete / Partly complete), Save changes + save-state indicator (Q16),
  unsaved-changes guard.

## Testing

- **Unit (contracts)**: phone normalisation (LB local with/without trunk 0, `+33…`, invalid);
  `ageOn` and `dentitionStage` at 5/6 and 12/13 around a birthday in the tenant time zone (the day
  before, the day of, a Feb-29 birth); `isMinor` at 18; completeness; merge schema reason length;
  list query defaults; `countrySchema`.
- **Unit (api domain)**: `name_key` (case, Latin diacritics, Arabic tashkeel, spaces); display
  number formatting; merge field resolution and alert union; duplicate grouping; balance sums per
  currency, owing; balance rank (`restAt` for asc/desc with credits).
- **Integration** (Testcontainers):
  - create with name + phone mints `P-000001`, `P-000002` per tenant; concurrent creates get
    distinct numbers; a failed create does not burn a number;
  - invalid phone / unknown dentist → 422; update of an archived patient → 409;
  - search by name (diacritics-insensitive), number, e-mail, phone digits (local and E.164); filters;
    sort by dentist; offset pages and `total`;
  - duplicates and check; archive/restore (bulk, audit, events); restore of a merged record → 409;
  - merge: fields, alert union, dropped record archived with `merged_into_id`, audit before/after,
    `PatientsMerged` → worker re-points ledger entries (job run in the test);
  - opening balance: one transaction (a failing patient insert leaves no entry and vice versa),
    `balanceOf`, `balancesFor`, _owes balance_ view and count, sort by balance, adjustments need a
    reason; export CSV rows and columns for filters and ids;
  - permissions: front desk creates/edits/archives and records opening balances; assistant cannot
    record an opening balance (403); `GET /audit` for a patient is 403 for front desk.
  - tenancy `country` round-trips through settings and the session; practitioners list.
- **Isolation suite**: `patients`, `patient_counters`, `ledger_entries` have RLS enabled; tenant A
  cannot read, search, update, archive, merge or read balances of B's patients (404 / absent), and
  A's creates never advance B's counter.
- **Web unit**: list query (URL round-trip, chip defaults, Clear filters); pager windows; form model
  (required fields, guardian shown/hidden and cleared, dirty); merge draft; palette (recent, digits
  ≥ 2, create pre-fill); nav/header visibility by permission; completeness badge.
- **Playwright**: the owner creates a patient with an opening balance → it appears in the list with
  the balance and in _Owes balance_ → opens the record → edits the address in Patient information →
  the completeness badge flips to Complete → ⌘K finds the patient by phone digits. The identity flow
  additionally checks that the front desk user sees no activity timeline in quick view.

## Documentation

- ADR-0016: `patients → users` for the primary dentist (auth user id).
- ADR-0017: opening balances live in `billing`; `billing` composes patient views that need
  balances (create with balance, Owes balance, sort by balance, export); merge re-point job and its
  after-commit window.
- ADR-0018: offset paging for the patients list (amends the CLAUDE.md §12 rule).
- `docs/adr/README.md` index.
- `docs/modules/patients.md` (implemented), new `docs/modules/billing.md`, `users.md`
  (practitioners), `tenancy.md` (country).
- CLAUDE.md: §4 map (`patients → tenancy, users`; `billing` owns `ledger_entries`, depends on
  `patients, tenancy`, `clinical` from feature 5); §12 pagination exception.
