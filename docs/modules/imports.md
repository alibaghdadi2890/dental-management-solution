# `imports` module

**Status:** first cut (2026-10-18, ADR-0053): three JSON import APIs, no screen. The upload,
column mapping and staged preview below are still planned.

## Purpose

Import existing patients with their service history from our CSV/XLSX template, with column mapping for a clinic's own export. Flow: upload (signed URL) → parse → map columns → validate + dry-run preview (duplicates, unknown services) → commit as an idempotent BullMQ job. Writes only through the owning modules' services (ADR-0003, ADR-0053); never touches their tables.

## Notes for feature 6

- **`externalId`** (the previous system's patient id) already exists on `patients`, unique per
  tenant where set, archived records included. It is import-only: not in the create or edit
  contract, so every record created in feature 3 has it null. The import sets it through a
  `PatientsService` method added in feature 6, and a re-import must clear or change an archived
  record's `externalId` before reusing it (docs/modules/patients.md).
- **Re-importing our own CSV export** (`billing`'s `GET /billing/patients/export`): foreign phone
  numbers are written in international format behind a leading `'` (the CSV injection guard, e.g.
  `'+33 6 12 34 56 78`). The import must strip a leading `'` from phone cells before normalising
  them. Numbers of the tenant's country come in national format (`03 123 456`), unprefixed. Any
  other text cell the guard prefixed (a name starting with `=`, `-`, …) carries the same `'`.
  The export's Guardian name and Guardian phone columns (design addendum C14) map to
  `guardian_name` and `guardian_phone` below.
- **Contacts** (patients design addendum 2026-09-28, ADR-0019). The patients side is designed for
  these template columns; the import itself is not built yet:
  - `guardian_name`, `guardian_phone`, `guardian_relationship` (one of `contact_relationship`:
    parent, spouse, child, sibling, caregiver, other): the row's guardian (`isGuardian`).
  - `billing_contact_phone`: who pays (`isBillingContact`); the same phone as the guardian's
    gives that one contact both roles. Which further roles a guardian gets is feature 6's call.
  - Contacts are deduplicated by phone within the file (normalised with the tenant country), so
    siblings sharing a parent's phone share one contact. Against the clinic's existing contacts
    and patients, `ContactsService.findContactsByPhone` finds a match to reuse (`{ contactId }`),
    otherwise the row creates one (`{ newContact }`). The links go through
    `PatientsService.create`'s `contacts` (≤ 10 per patient, in the create's transaction), never
    `patients`' tables.
  - Any patient may come without a phone, in any format (ADR-0052); the record then shows it as
    missing information, never a validation error in the preview.

## The first clinic's migration (decided 2026-10-17)

The templates (Catalog, Patients, History, Visits) are generated from the clinic's spreadsheet;
the import must take them as they are:

- **Catalog**: only the services the clinic does not have yet, added to its catalog.
- **Patients**: `external_id` is the sheet's `PAT-…` id. `opening_balance` is the sheet's
  outstanding (initial balance + 2026 visit charges − payments), as of the export's last activity;
  a credit comes in as 0 and is checked by hand. Payments are not migrated.
- **History**: clinical record only, no money: past visits (one per patient and date) with their
  services or notes, every row dated, each per-tooth service on a tooth.
- **Visits**: the 2026 visits with their services, prices and Done as recorded, **marked as
  imported and posting no charge** — the opening balance already includes them. Cancelled and
  no-show visits are not migrated.

## The import APIs (ADR-0053)

`POST /api/v1/imports/services`, `/patients`, `/visits` — body `{ dryRun?: false, rows: [...] }`
(1–100 rows, `@dcm/contracts` `imports.ts`), `import:run`. 200 with `{ dryRun, results }`, one
result per row in order: `{ ref, status: created | exists | failed, id, issues }`.

- Import visits **oldest first** (history before the recent visits, each by date): the chart's
  current presence of a tooth is its last row recorded (an extraction, an implant).
- Each row runs in its own `TenantDb` transaction: a failing row rolls back alone and reports
  its issues (a domain error's code, or field issues with paths inside the row); the others go
  on. `dryRun` runs every row and rolls it back (`id` null for what it would create).
- **services** — a catalog row (`serviceItemInputSchema`, no `id`): `CatalogService.saveServices`;
  a code the clinic has → `exists`.
- **patients** — `externalId` (the import key), the record's fields, `allergies` by name
  (`MedicalOptionsService.add`), `medication`, `status: active | archived`, `openingBalance?`
  (`BillingService.recordOpeningBalance`, > 0). `PatientsService.create` with `externalId`; an
  archived row is archived after. A key already held → `exists`.
- **visits** — `externalId`, `patientExternalId`, `branchId`, `dentistId` (staff profile id),
  `roomId?`, `date`, `startTime?`/`endTime?` (`HH:MM`, clinic time), `notes?`, `lines` of
  `{ serviceCode, tooth?, jaw?, amount, done }`. `VisitImportService.importVisit` (clinical): a
  completed, imported visit, never charged; a line not done becomes plan work in progress priced 0. An unknown patient → `failed`, `import.unknown_patient` at `patientExternalId`; a target the
  service's unit does not take → `target_mismatch` at `lines.<i>.tooth|jaw`.

## Owns

Nothing yet. Planned: `import_jobs`, `import_rows`.

## Public API (`index.ts`)

`ImportsModule`. Nothing else: nothing imports this module.

## Events

- Emits: — (planned: `ImportCompleted`, `ImportFailed`).
- Consumes: —

## Depends on

patients, clinical, billing (opening balances, ADR-0053)

## Permissions

`import:run` (plus the target modules' write permissions, re-checked by their services).
