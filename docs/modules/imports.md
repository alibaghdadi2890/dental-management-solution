# `imports` module

**Status:** skeleton — module class and `index.ts` only.

## Purpose

Import existing patients with their service history from our CSV/XLSX template, with column mapping for a clinic's own export. Flow: upload (signed URL) → parse → map columns → validate + dry-run preview (duplicates, unknown services) → commit as an idempotent BullMQ job. Writes only through `PatientsService` and the clinical `VisitsService` (ADR-0003); never touches their tables.

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
  - A minor without a phone is valid (the phone rule, addendum C3); an adult without one is a
    validation error in the preview.

## Owns

`import_jobs`, `import_rows` (planned).

## Public API (`index.ts`)

`ImportsModule`. Planned: `ImportsService` (create job, set mapping, preview, commit, status).

## Events

- Emits: `ImportCompleted`, `ImportFailed` (planned).
- Consumes: —

## Depends on

patients, clinical, tenancy

## Permissions

`import:run` (plus the target modules' write permissions, re-checked by their services).
