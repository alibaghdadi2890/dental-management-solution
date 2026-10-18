# Import APIs (feature 6, first cut) — design

Date: 2026-10-18. APIs only, no screen (decided with the user); a Postman collection drives the
first clinic's migration. ADR-0053.

## Decisions

- **I1 — Four endpoints, JSON rows.** `POST /api/v1/imports/{services,patients,history,visits}`,
  each `{ dryRun?: boolean, rows: [...] }`, at most 100 rows. The templates' rows as JSON: the
  generator writes them straight into the Postman collection. No file upload, no column mapping,
  no staged jobs yet (the module doc's later flow).
- **I2 — Per row (per visit) transaction, per row result.** Each row (a patient, a service, a
  visit with its lines) runs in its own `TenantDb` transaction; a failing row rolls back alone and
  is reported, the others go on. Response: `{ dryRun, results: [{ ref, status, id?, issues? }] }`,
  status `created` | `exists` | `failed`. `dryRun` runs every row and rolls each back, so the
  answer is what a real run would do (numbers and counters roll back too).
- **I3 — Idempotent re-runs.** A patient by `external_id` (exists → `exists`, nothing written).
  A visit by a new `visits.external_id` (unique per tenant): the sheet's visit id, or
  `H:<patient external id>:<date>` for a history visit. A service by `code` (exists → `exists`).
- **I4 — Ids, not names.** Rows carry `branchId`, `dentistId` (a staff profile id) and `roomId`
  (optional); the Postman collection's setup request fills them from `GET /users/practitioners`,
  `/branches` and `/rooms` by name. Services by catalog `code`.
- **I5 — Services**: the catalog's `saveServices`, with the codes the clinic already has left
  out (`exists`). Needs `catalog:write`.
- **I6 — Patients**: `PatientsService.create` with the import key (`externalId`, a new option of
  `create`), then the opening balance (`BillingService.recordOpeningBalance`, > 0 only) and, for
  `status: archived`, `PatientsService.archive`. Allergies by name (`MedicalOptionsService.add`).
  Needs `patient:write`, plus `payment:write` for a balance.
- **I7 — Visits and history**: `VisitImportService` in `clinical` writes a **completed, imported**
  visit (`imported_at`, `external_id`): type `treatment`, started and completed on the row's date
  and times (history: the local day's start, 1 minute), its done lines as visit services (base =
  the amount charged, as recorded), the chart's presence for extractions and implants
  (`PresenceWriter.applyService`), notes. It publishes **no `VisitCompleted`**: no ledger charge,
  the opening balance already holds the money (ADR-0053). Audited `visit.import`.
- **I8 — Not-done lines** (the user's choice): a treatment plan item `in_progress`, started in
  that visit with a session there, priority `high`, price 0, note "Charged <amount> before the
  migration". Finishing it later charges nothing again.
- **I9 — Imported visits are not corrected**: amend and void answer 409 `visit.imported`
  (a correction would post a ledger delta for a charge that was never posted).
- **I10 — Permission** `import:run` on every route (owner only), re-checked in `ImportsService`;
  the target services re-check their own.

## Out of scope

The upload/mapping/preview flow and its screen; staged rows; showing "Imported" in the SPA.
