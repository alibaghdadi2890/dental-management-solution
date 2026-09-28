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
