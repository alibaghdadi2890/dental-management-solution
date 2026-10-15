# Dentist specialties — implementation plan

Spec: `docs/superpowers/specs/2026-10-15-dentist-specialties-design.md` (D1–D11). No branch or
commit until the owner asks. Per task: the affected tests and that package's typecheck. Full lint,
typecheck, tests and build, then one review, in task 8.

Paths are under `apps/api/src/modules/` (API) or `apps/web/src/features/` (web) unless they start
with `apps/`, `packages/` or `docs/`. Integration specs are in `apps/api/test/integration/`. New
strings go to `apps/web/src/locales/{en,ar,fr}/` in the task that adds them.

## 1. Contracts (D1, D2, D5)

- `packages/contracts/src/users.ts`: `SPECIALTIES`, `specialtySchema`, `Specialty`,
  `specialtiesFit`; the fields on `staffUserSchema`, `staffUserCreateSchema` (refine),
  `staffUserPatchSchema` (pair rule).
- `packages/contracts/src/tenancy.ts`: the owner's two optional fields and their refine.
- `packages/contracts/src/session.ts`: `profile`.
- `users.spec.ts` (and `tenancy.spec.ts` for the owner).

Done: contracts tests and typecheck green.

## 2. Schema and migration (D3, D4)

- `users/persistence/schema.ts`: the two columns and the three CHECKs.
- `pnpm --filter @dcm/api db:generate` → `apps/api/migrations/0045_*.sql`; add the backfill `UPDATE`
  between the column adds and the CHECKs (by hand, before the CHECKs).

Done: the migration applies on a fresh database and on one with existing dentists.

## 3. Domain rule (D6)

- `users/domain/staff-rules.ts`: `SpecialtyRequiredError`, `SpecialtyNotAllowedError`,
  `resolveSpecialties(before, patch)`.
- `staff-rules.spec.ts`.

Done: domain tests green.

## 4. Repository, service, session (D5, D6, D7)

- `users/persistence/staff.repository.ts`: read and write the two columns.
- `users/application/users.service.ts`: `createStaffUser` and `updateStaffUser` store
  `resolveSpecialties`; `hydrate`/`load` map them onto `StaffUser`.
- `users/application/session.service.ts`: `profile`.
- `provisioning/application/provisioning.service.ts`: a dentist owner without specialties gets
  `general`.
- `users.int-spec.ts`, `session.int-spec.ts`, `provisioning.int-spec.ts` per the spec. Fix any
  fixture that builds a `StaffUser` or `Session` by hand (web test utils included).

Done: those suites and the API typecheck green.

## 5. Shared specialty controls (D8, D9)

- `platform/specialty-choice.ts`: pure helpers — `toggleSpecialty(state, key)`,
  `specialtiesForType(type, state)` (Dentist → `general` when empty; other → empty).
- `platform/specialty-fields.tsx`: chip group + primary select; error slot.
- Strings: `users.fields.specialties`, `users.fields.primarySpecialty`,
  `users.specialties.<key>`, `users.errors.specialties`.

Done: helper tests green.

## 6. User panel and Users tab (D8, D10)

- `platform/tenant-detail/user-form.ts`: the two fields on `UserForm`, `EMPTY_USER_FORM` on
  `general`, `userFormFrom`, the requests (patch sends both when either changed, or when the type
  changed), the error mapping.
- `platform/tenant-detail/user-panel.tsx`: the controls when the type is Dentist.
- `platform/tenant-detail/users-tab.tsx`: "· primary specialty" in the type column.
- `user-form.spec.ts`.

Done: web tests and typecheck green.

## 7. New clinic owner and Activity (D7, D9)

- `platform/new-tenant-form.ts` + `new-tenant-panel.tsx`: the owner's controls and request.
- `new-tenant-form.spec.ts`.
- `audit/changes.ts`: `specialties`, `primarySpecialty`, with labelled values; their labels in
  the `activity` namespace.

Done: web tests green.

## 8. Docs, verification, review

- `docs/adr/0050-dentist-specialties-are-a-fixed-list-on-the-staff-profile.md`.
- `docs/modules/users.md` (owns, invariants, errors), `docs/modules/provisioning.md` (owner),
  CLAUDE.md §4 module map (`users` row: specialties).
- Full `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`; a manual pass in the app
  (create a dentist with two specialties, switch to assistant and back, new clinic).
- One review over the working-tree diff.

Done: everything green; changes left uncommitted for the owner.
