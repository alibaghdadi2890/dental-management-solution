# Charge at start, refund from the record, diagnoses on a jaw or the mouth — plan

Spec: `docs/superpowers/specs/2026-10-29-charge-at-start-refunds-diagnosis-levels-design.md`.
Lean process: per task, the affected tests + that package's typecheck; full lint/typecheck/tests
and Playwright once at the end. No commits (the user commits).

1. **Contracts.** `TreatmentPlan.chargedIn`; diagnosis catalog `level`, colour optional off the
   tooth; `DiagnosisRecord.level/jaw`; `recordDiagnosis` inputs `toothCode?`/`jaw?`. Done: the
   contracts specs pass and the package typechecks.
2. **Migration 0055 + schema.** `diagnoses.level`, nullable colour + check; `patient_diagnoses`
   `level`, `jaw`, nullable `tooth_code` + checks. Done: drizzle-kit generates it and it applies
   to the dev DB.
3. **API: charge at start** (`plan-charting.service.ts`, `plan-unperformer.ts`,
   `service-charting.service.ts`, corrections, `listUncharged`, the chart's `chargedIn`).
   S1–S8 and `reopenPlan`. Done: the multi-visit and unfinished integration specs are updated and
   pass, and the new cases (spec §Tests) pass.
4. **API: diagnosis levels** (catalog service, record writer, linking, mapping). Done: the
   integration specs for jaw and mouth diagnoses, catalog level and plan linking pass.
5. **SPA: charge at start.** Today's services totals and rows, summaries without the duplicate
   session line, "Charged on visit #N", the Cancel note, the chart's treated rule, reopen.
   Done: the affected web specs pass.
6. **SPA: refund from the record.** Refund on the balance card, payment picker, `RefundDialog`
   on a narrow shape. Done: the picker spec passes.
7. **SPA: diagnosis levels.** Catalog Level select, the level panel's Diagnoses section, drawer
   filtering, place labels wherever diagnoses show. Done: the affected web specs pass.
8. **Docs.** ADR-0064, module pages, CLAUDE.md §4 row, a note on the 2026-10-05 spec.
9. **Verify.** Lint, typecheck, API and web tests, Playwright (unfinished flow updated), one code
   review over the working tree.
