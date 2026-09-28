# ADR-0020: Domain models refer to a dentist by the staff profile id

- Status: Accepted
- Date: 2026-09-28
- Amends: [0016](0016-patients-depend-on-users.md)

## Context

ADR-0016 decided that `patients.primary_dentist_user_id` stores the global auth user id, because
every other module (`roles`, `audit`, the session) already refers to people that way, and because
`staff_profiles.id` was seen as `users`' internal key.

The revised feature brief for patients (`docs/superpowers/specs/2026-09-28-patients-contacts-design.md`,
decision C13) reopens this: the product owner decided that whenever a domain model refers to a
dentist — starting with `patients.primary_dentist_id`, and later appointments and visits in
`scheduling`/`clinical` — it should store the **staff profile id**, not the auth user id. Two
problems with the auth user id surfaced once contacts and later modules were designed around
referring to "the person in this clinical role":

- The auth user id is a global identity (D7): the same person can have a profile in more than one
  tenant, and identity changes (an account merge, a future SSO migration) are `auth`'s concern,
  not a fact clinical records should be exposed to.
- `staff_profiles.id` is already the tenant-scoped, RLS-protected key `users` uses for everything
  else about a staff member (branches, the profile itself). It survives identity changes because
  `(tenant_id, auth_user_id)` is unique but `id` is what is generated and referenced first; a
  domain model that stores the profile id is referring to "the dentist as a staff member of this
  clinic", which is what a patient's primary dentist, an appointment's practitioner, or a visit's
  performer actually mean.

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
    staff, mirroring `practitionersByIds(userIds)` (ADR-0016's lookup, by auth user id).
- Existing callers that still store the auth user id (`patients.primary_dentist_user_id`, and
  `billing`'s CSV export, which reads it) keep using `listPractitioners()` and
  `practitionersByIds(userIds)` until they are migrated. The patients-contacts addendum (task
  H1/H2) renames the column to `primary_dentist_id`, stores the profile id, switches those callers
  to `practitionersByProfileIds`, and deletes `practitionersByIds` and the repository's
  `byUserIds`. Both methods stay undecorated (not `@deprecated`) in the interim: the project's
  ESLint config fails the build on any use of a `@deprecated`-tagged member, which would break the
  very callers this ADR asks to keep working until they are migrated; each method's doc comment
  says the same thing in prose instead.
- `sortByDisplayName`'s tie-break (`practitioner-order.ts`) keeps comparing the auth user id, not
  the profile id. `(tenant_id, auth_user_id)` is unique on `staff_profiles`, so either id gives a
  valid, deterministic order; the auth user id is kept because it is the field the existing
  practitioner-order tests and API consumers already pin, and changing it is not needed for this
  decision.

## Consequences

- CLAUDE.md §7 gains the rule: "A domain model refers to a staff member in a clinical role (e.g. a
  patient's primary dentist) by `staff_profiles.id`, never the auth user id (ADR-0020)."
- For one commit (this one), `users` carries both the profile-id and user-id lookups side by side;
  `patients` and `billing` still store and pass the auth user id. The next task (patients-contacts
  H1/H2) is responsible for moving `patients.primary_dentist_user_id` to `primary_dentist_id`
  (storing the profile id), switching `patients` and `billing` to `practitionersByProfileIds`, and
  deleting `practitionersByIds` / `byUserIds`. Leaving that migration incomplete after this commit
  is expected and tracked there, not a regression of this ADR.
- Nothing about ADR-0016's module dependency (`patients` depends on `users`) or the "no foreign
  key, validated through `UsersService`" shape changes; only which id is stored and passed changes.
