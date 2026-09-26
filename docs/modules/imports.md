# `imports` module

**Status:** skeleton — module class and `index.ts` only.

## Purpose

Import existing patients with their service history from our CSV/XLSX template, with column mapping for a clinic's own export. Flow: upload (signed URL) → parse → map columns → validate + dry-run preview (duplicates, unknown services) → commit as an idempotent BullMQ job. Writes only through `PatientsService` and the clinical `VisitsService` (ADR-0003); never touches their tables.

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
