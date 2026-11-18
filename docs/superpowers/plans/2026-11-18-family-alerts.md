# Possible families (families B) — plan

Spec: `docs/superpowers/specs/2026-11-18-family-alerts-design.md`. Branch `feature/families-a`
(A, C and B together, uncommitted). Lean process.

1. **Domain.** `patients/domain/family-suggestions.ts` + unit spec (F1–F3). Done: spec passes.
2. **Table and migration.** `family_dismissals` in `patients/persistence/schema.ts`;
   `drizzle-kit generate --name family_dismissals` (0061). Done: migration reviewed.
3. **Reads and writes.** `FamilySuggestionsRepository`; `FamiliesService` (`list`, `link`,
   `dismiss`); contracts (`familySuggestionSchema`, `familyLinkInputSchema`,
   `familyDismissInputSchema`); routes. Integration + tenant isolation tests first. Done: pass.
4. **SPA.** Review strip (replaces the duplicates banner), `?panel=families` panel, locales, specs.
5. **Docs and checks.** patients.md, CLAUDE.md; lint, typecheck, format, tests.
