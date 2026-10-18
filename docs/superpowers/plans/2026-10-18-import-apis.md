# Import APIs — plan

Spec: `docs/superpowers/specs/2026-10-18-import-apis-design.md`. Lean process: inline build, one
review at the end, the user commits.

1. **Contracts** — `packages/contracts/src/imports.ts`: row schemas (service, patient, visit with
   lines), request `{ dryRun, rows ≤ 100 }`, result. Done: unit tests for the row rules.
2. **Kernel** — `zonedInstant(date, time, timeZone)` in `platform/kernel/local-date.ts`. Done:
   unit tests across a DST change.
3. **Patients** — `create(input, { externalId })`, `findIdsByExternalIds`. Done: typecheck, unit.
4. **Clinical** — migration: `visits.imported_at`, `visits.external_id` (unique per tenant where
   set); `VisitImportService.importVisit` (visit, services, presence, not-done → plan item in
   progress with a session); amend/void refuse an imported visit (`visit.imported`). Done: unit
   for the money and line rules.
5. **Imports** — `ImportsService` (per row transaction, dry run, results), controller
   `POST /imports/{services,patients,visits}`, module wiring (patients, clinical, billing,
   tenancy). Done: integration test per endpoint (create, re-run → exists, dry run writes
   nothing, a failing row alone), tenant isolation.
6. **Docs** — ADR-0053, `docs/modules/imports.md`, `clinical.md`, CLAUDE.md module map.
7. **Generator + Postman** — the generator writes JSON rows and `Clinic migration.postman_collection.json`
   (sign in, setup that fills branch/dentist/room ids by name, then dry-run and run folders).
8. **Verify** — lint, typecheck, unit, integration; one code review over the diff.
