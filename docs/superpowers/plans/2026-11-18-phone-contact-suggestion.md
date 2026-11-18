# Phone contact suggestion (families A) — plan

Spec: `docs/superpowers/specs/2026-11-18-phone-contact-suggestion-design.md`. Branch
`feature/families-a`. Lean process: inline build, affected tests per task, full checks at the end.

1. **Contracts.** `samePhone` in `packages/contracts/src/phone.ts` (+ `phone.spec.ts`);
   `familyContact` on the lookup's patient item in `contacts.ts` (+ `contacts.spec.ts`).
   Done: contracts tests and typecheck pass.
2. **API lookup.** `PatientContactsRepository.familyContactsFor(patientIds)` (primary guardian and
   primary billing links, resolved); `ContactsService.lookup` sets `familyContact` (guardian before
   billing). Test first in `apps/api/test/integration/contacts.int-spec.ts`. Done: that spec and the
   api typecheck pass.
3. **SPA offer.** Failing tests first in `panels/patient-form-contacts.spec.tsx` (spec's test list),
   then: `use-link-offer.ts` (P1–P3: any age, create and edit, `samePhone`, own record excluded,
   minor → `familyContact`), `link-offer.tsx` (P4 prompt), `patient-form-panel.tsx` and
   `contacts-section.tsx` (the request reaches both sections' `ContactLinker`, the family disclosure
   opens, adults staged with Billing ticked), locales en/ar/fr. Existing fixtures gain
   `familyContact: null`. Done: patients feature specs and the web typecheck pass.
4. **Docs.** `docs/modules/patients.md` (lookup `familyContact`, `samePhone`, the offer).
5. **Checks.** `pnpm lint`, `pnpm typecheck`, `pnpm test` (web, contracts; api contacts
   integration), `pnpm format:check`.
