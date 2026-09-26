# `patients` module

**Status:** skeleton — module class and `index.ts` only.

## Purpose

Patient records: demographics, contacts, insurance, medical alerts/allergies, notes, archive (soft delete) and merge. The POC's Patients screen (list, quick view, create/edit, merge) is the UI reference.

## Owns

`patients`, `patient_alerts` (planned).

## Public API (`index.ts`)

`PatientsModule`. Planned: `PatientsService` (create, update, get, search with cursor pagination, archive/restore, merge with reason, bulk create for `imports`).

## Events

- Emits: `PatientCreated`, `PatientUpdated`, `PatientArchived`, `PatientsMerged` (planned).
- Consumes: —

## Depends on

tenancy

## Permissions

`patient:read`, `patient:write`.
