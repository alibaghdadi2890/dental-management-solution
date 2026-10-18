# ADR-0053: Imports write through the owning services, and imported visits are never charged

- Status: Accepted
- Date: 2026-10-18

## Context

The first clinic migrates from a spreadsheet: a service list, ~460 patients with what they owe
today, ~2,100 past visits with no money (2014–2025) and ~270 priced visits of 2026. Payments are
not migrated: what each patient owes now (initial balance + 2026 charges − payments) comes in as
their opening balance. The migration is run once, by us, so it needs APIs, not a screen yet
(`docs/superpowers/specs/2026-10-18-import-apis-design.md`, I1–I10).

## Decision

1. **Three endpoints of JSON rows** — `POST /api/v1/imports/{services,patients,visits}`,
   `{ dryRun, rows ≤ 100 }`, `import:run`. Each row runs in its own transaction and answers on
   its own (`created`, `exists`, `failed` with issues); a dry run rolls each row back. The module
   doc's upload/mapping/staging flow is for later.
2. **Through the owning services only**: `imports` owns no tables and calls `CatalogService`,
   `PatientsService` (`create` with the import key `externalId`, `archive`),
   `MedicalOptionsService`, `BillingService.recordOpeningBalance` and `clinical`'s new
   `VisitImportService`. New dependency edge: `imports → billing` (nothing depends on `imports`).
3. **Re-runs are idempotent** by key: a service by code, a patient by `patients.external_id`, a
   visit by the new `visits.external_id` (unique per tenant; `H:<patient>:<date>` for a history
   visit).
4. **An imported visit is completed and never charged.** `visits.imported_at` and `external_id`
   mark it (a CHECK keeps both set only on a completed visit). It is written completed with its
   services at the amounts charged, as recorded, and their chart effects, and publishes **no
   `VisitCompleted`**: `billing` posts nothing, because the opening balance already holds that
   money. Billing reads a visit's charge from the ledger, so the visit owes nothing.
5. **Work started and not finished** (a line not done) becomes plan work in progress, started in
   the imported visit with a session there, priority high, **priced 0** with a note of what was
   charged: finishing it later in the app charges nothing again.
6. **No correction of an imported visit**: amend and void answer 409 `visit.imported` — they post
   or reverse a ledger charge that was never posted.

## Consequences

- An imported visit shows its total but no charge or payment; the SPA does not say "imported"
  yet.
- The clinic's balances after the migration are exactly the opening balances: payments made
  before the migration exist only in the old sheet.
