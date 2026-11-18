# Billing contacts (families C) — plan

Spec: `docs/superpowers/specs/2026-11-18-billing-contacts-design.md`. Branch `feature/families-a`
(A and C together, uncommitted). Lean process.

1. **Search by contact name (C1).** Test first in `contacts.int-spec.ts` (C7 block);
   `patient-search.sql.ts` (contact name in the subquery and `matchedContact`). Done: spec passes.
2. **`GET /contacts/:id` (C2).** Contract `contactDetailSchema`; `ContactsService.detail`;
   controller route; integration and tenant-isolation tests. Done: both specs pass.
3. **Families by payer (C7, API).** `billing/domain/families.ts` + unit spec; Outstanding uses it;
   `receivables()` groups by family; contract `largest` gains `payer`, `members`; dashboards
   integration test. Done: billing unit + dashboards integration pass.
4. **Contact panel (C3, C4).** `contact-panel.tsx`, provider in the app shell, `FamilyBalance`
   from `family-card.tsx`, Register prefill (`PatientPrefill` + pinned chip), contacts card menu
   items, locales. Specs. Done: patients/billing specs pass.
5. **Entry points (C5, C6, C7 SPA).** ⌘K Contacts group; Outstanding payer name; dashboard row.
   Specs. Done: palette, payments, dashboards specs pass.
6. **Docs and checks.** Module pages; lint, typecheck, format, tests.
