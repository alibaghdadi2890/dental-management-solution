# ADR-0020: Domain models refer to a dentist by the staff profile id

- Status: Accepted
- Date: 2026-09-28
- Amends: ADR-0016

## Context

ADR-0016 decided that `patients.primary_dentist_user_id` stores the global auth user id, reasoning
that `staff_profiles.id` was `users`' internal key and that the auth user id was the simpler,
already-validated choice.

The revised feature brief for patients (`docs/superpowers/specs/2026-09-28-patients-contacts-design.md`,
decision C13) reopens this: the product owner decided that whenever a domain model refers to a
dentist — starting with `patients.primary_dentist_id`, and later appointments and visits in
`scheduling`/`clinical` — it should store the **staff profile id**, not the auth user id.

The real argument for this: `staff_profiles.id` is tenant-scoped (unlike the auth user id, which
is global identity, D7 — the same person can hold profiles in more than one clinic) and means
"this person as staff of this clinic". That is exactly what a clinical reference means — a
patient's primary dentist, an appointment's practitioner, a visit's performer are all statements
about someone's role in _this_ tenant, not about their sign-in identity. Storing the profile id
keeps those domain models out of identity-plane concerns entirely: they never need to know that
auth users are global, or reason about what happens to a reference if `auth`'s representation of a
person ever changes.

## Decision

- A domain model refers to a staff member in a clinical role (a patient's primary dentist; later,
  an appointment's or visit's practitioner) by `staff_profiles.id`, never the auth user id.
- `users` exposes both ids so callers can resolve either direction:
  - `Practitioner` (`GET /users/practitioners`, `practitionersByProfileIds`) carries `id` (the
    staff profile id — what a domain model stores) and `userId` (the auth user id, kept for links
    back to `users`, e.g. `GET /users/:id`, sign-in identity).
  - `StaffUser` (`GET /users`, `GET /users/:id`) carries `id` (the auth user id, unchanged — `:id`
    in the users routes) and the new `profileId` (`staff_profiles.id`).
  - `practitionersByProfileIds(profileIds)` looks staff up by profile id, including deactivated
    staff, mirroring `practitionersByAuthUserIds(authUserIds)` (ADR-0016's lookup, by auth user
    id — renamed from `practitionersByIds` so the name says which id it takes now that both exist).
- Existing callers that still store the auth user id (`patients.primary_dentist_user_id`, and
  `billing`'s CSV export, which reads it) keep using `listPractitioners()` and
  `practitionersByAuthUserIds(authUserIds)` until they are migrated. The patients-contacts
  addendum (task H1/H2) renames the column to `primary_dentist_id`, stores the profile id,
  switches those callers to `practitionersByProfileIds`, and deletes
  `practitionersByAuthUserIds` and the repository's `byAuthUserIds`. Both methods stay
  undecorated (not `@deprecated`) in the interim: the project's ESLint config fails the build on
  any use of a `@deprecated`-tagged member, which would break the very callers this ADR asks to
  keep working until they are migrated; each method's doc comment says the same thing in prose
  instead.
- `sortByDisplayName`'s tie-break (`practitioner-order.ts`) keeps comparing the auth user id, not
  the profile id. `(tenant_id, auth_user_id)` is unique on `staff_profiles`, so either id gives a
  valid, deterministic order; the auth user id is kept because it is the field the existing
  practitioner-order tests and API consumers already pin, and changing it is not needed for this
  decision.

## Consequences

- CLAUDE.md §7 gains the rule: "A domain model refers to a staff member in a clinical role (e.g. a
  patient's primary dentist) by `staff_profiles.id`, never the auth user id (ADR-0020)."
- Actor-based code is the exception, and stays on the auth user id: the session and CLS carry the
  auth user id (`auth`'s identity, populated by the global guard), not a profile id, because
  identity and sign-in are `auth`'s concern, not `users`'. Any future rule that compares "the
  acting user" to a staff reference — e.g. a dentist-scoped "my patients" or "own appointments"
  visibility rule in `authorization` — needs a user-id → profile-id mapping, which `users` must
  provide (a lookup alongside `practitionersByProfileIds`, not a workaround in the caller).
- Until the patients-contacts refactor (H1/H2), `users` carries both the profile-id and user-id
  lookups side by side; `patients` and `billing` still store and pass the auth user id. That task
  is responsible for moving `patients.primary_dentist_user_id` to `primary_dentist_id` (storing
  the profile id), switching `patients` and `billing` to `practitionersByProfileIds`, and deleting
  `practitionersByAuthUserIds` / `byAuthUserIds`. Leaving that migration incomplete until then is
  expected and tracked there, not a regression of this ADR.
- The patients refactor (R1) completed the switch; the auth-user-id lookups are deleted.
- Nothing about ADR-0016's module dependency (`patients` depends on `users`) or the "no foreign
  key, validated through `UsersService`" shape changes; only which id is stored and passed changes.
