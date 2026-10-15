# Dentist specialties — design

Date: 2026-10-15. Module: `users` (plus the `provisioning` owner and the platform admin's
screens). ADR-0050.

## Why

A dentist has one or more specialties, one of them primary. Later, the visit and patient record
screens will differ by specialty; this change only records them. A platform admin sets them when
creating or editing a dentist.

## Decisions

- **D1 — A fixed list in code.** `SPECIALTIES` in `@dcm/contracts` (`practitioners.ts`): `general`,
  `orthodontics`, `endodontics`, `periodontics`, `prosthodontics`, `oral_surgery`, `pediatric`,
  `implantology`, `cosmetic`. Screens will branch on these keys, so a clinic cannot edit the
  list. Labels in en/fr/ar (`admin` namespace, `users.specialties.*`).
- **D2 — Dentists only, and always at least one.** A staff profile of type `dentist` has
  `specialties` (1 to 9, no duplicates) and a `primarySpecialty` that is one of them. Any other
  type has `specialties: []` and `primarySpecialty: null`.
- **D3 — Two columns on `staff_profiles`.** `primary_specialty text` (nullable) and
  `specialties text[] NOT NULL DEFAULT '{}'` (every specialty, the primary included; ordered as
  chosen). Text + Zod, as `practitioner_type` is. Three CHECKs:
  `(practitioner_type = 'dentist') = (primary_specialty IS NOT NULL)`,
  `(primary_specialty IS NULL) = (cardinality(specialties) = 0)`,
  `primary_specialty IS NULL OR primary_specialty = ANY(specialties)`.
- **D4 — Migration 0045** adds the columns, sets every existing dentist to
  `primary_specialty = 'general', specialties = '{general}'` (owners included), then adds the
  CHECKs.
- **D5 — Contracts.**
  - `StaffUser` gains `primarySpecialty: Specialty | null` and `specialties: Specialty[]`.
  - `staffUserCreateSchema` gains both, optional as a pair (as the owner's): a dentist created
    without them starts on `general` (in `resolveSpecialties`, so provisioning passes the owner's
    through). When sent they must fit the type (`specialtiesFit`, the shared D2 rule). The
    practitioner type and specialties moved to `practitioners.ts` (`session.ts` needs them, and
    `users.ts` imports `session.ts`). The issue's path is `specialties`.
  - `staffUserPatchSchema`: the two fields travel together (both or neither) and must agree with
    each other; whether they fit the type is checked against the stored profile (D6).
  - `provisionTenantRequestSchema.owner` gains both, optional. A dentist owner without them gets
    `general` (the same create rule); a non-dentist owner with them is invalid.
  - `sessionSchema` gains `profile: { practitionerType, primarySpecialty, specialties } | null`
    — null for a caller with no staff profile in the tenant (a platform admin).
- **D6 — The rule on update** (`domain/staff-rules.ts`, pure):
  `resolveSpecialties(before, patch)` returns what to store.
  - The type after the patch is not `dentist` → stored as `[]` / `null`, whatever was there
    (changing a dentist to an assistant clears them). Sending a non-empty list with a
    non-dentist type → `422 user.specialty_not_allowed`.
  - The type after the patch is `dentist` → the patch's specialties, else the stored ones; none
    → `422 user.specialty_required` (an assistant made a dentist must be given one).
  - On create, the contract refine already guarantees D2; the service still calls the same rule.
  - A patch that changes neither the type nor the specialties does not write them.
- **D7 — Audit.** No new action: `user.create` / `user.update` already store the whole
  `StaffUser` before/after. The Activity feed's change list (`features/audit/changes.ts`) gains
  `specialties` and `primarySpecialty`; their values read as stored words ("oral surgery"),
  like the practitioner type's.
- **D8 — User panel** (`platform/tenant-detail/user-panel.tsx`). When the type is Dentist, under
  the type row: a _Specialties_ chip group and a _Primary specialty_ select offering only the
  ticked ones.
  - Ticking the first specialty makes it the primary; unticking the primary moves it to the first
    still ticked.
  - Switching the type to Dentist starts on `general` (ticked and primary); switching away hides
    both controls and the form sends `[]` / `null`.
  - A new user starts as a dentist on `general`.
  - A dentist left with no specialty ticked shows "Choose at least one specialty" on Save.
- **D9 — New clinic owner** (`platform/new-tenant-panel.tsx`): the same two controls under the
  owner's type when it is Dentist, starting on `general`. The controls are one shared component,
  `platform/specialty-fields.tsx`, with the toggle logic in `platform/specialty-choice.ts`.
- **D10 — Users tab table**: the type column reads "Dentist · Orthodontics" (title, else type,
  then the primary specialty's label).
- **D11 — Out of scope**: screens that differ by specialty, a clinic-editable list, the specialty
  in the dentist picker (`GET /users/practitioners`), the clinic's own (non-platform) staff
  screens.

## Errors

| Code                             | When                                                                          |
| -------------------------------- | ----------------------------------------------------------------------------- |
| `422 user.specialty_required`    | a dentist would end up with no specialty                                      |
| `422 user.specialty_not_allowed` | specialties sent for a non-dentist type                                       |
| `400` (Zod)                      | unknown key, duplicates, primary not in list, only one of the pair in a patch |

## Tests

- `users.spec.ts` (contracts): `specialtiesFit`, the create/patch refines, the provisioning owner.
- `staff-rules.spec.ts`: `resolveSpecialties` — each branch of D6.
- `users.int-spec.ts`: create a dentist with specialties; patch a dentist to assistant (cleared);
  patch an assistant to dentist without specialties (422) and with them; specialties on a
  non-dentist (422); the audit entry's after carries them.
- `profile` in the session: for a dentist in `users.int-spec.ts`, `null` for a platform admin in
  `session.int-spec.ts`.
- `provisioning.int-spec.ts`: the owner defaults to `general`; given specialties are kept.
- `user-form.spec.ts`, `new-tenant-form.spec.ts`: the toggle helper, type switching, the
  requests built.
- Tenant isolation: no new service; the existing users suite covers it.
