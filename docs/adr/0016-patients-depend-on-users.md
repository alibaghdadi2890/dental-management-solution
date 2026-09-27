# ADR-0016: `patients` depends on `users` for the primary dentist

- Status: Accepted
- Date: 2026-09-27

## Context

A patient has an optional primary dentist (feature 3, design Q2). The POC's Patients screen
filters and sorts by it and shows the dentist's name. CLAUDE.md §4 lists only `tenancy` as a
dependency of `patients`. The practitioner data lives in `users` (staff profiles), and the key
every other module already uses for a person is the auth user id.

We considered:

- Storing the staff profile id. It is `users`' internal key; every other module refers to
  people by auth user id (`roles`, `audit`, the session).
- Copying the dentist's name onto the patient. It goes stale when the profile changes, and
  validation would still need `users`.
- Not validating the id. A typo or another tenant's user id would be stored silently.

## Decision

- `patients.primary_dentist_user_id` stores the auth user id, with no foreign key: `users` owns
  the profiles (§4 rule 1).
- `patients` depends on `users` and reads it only through `UsersService`:
  - `listPractitioners()`, the active dentists of the tenant, validates a newly chosen dentist
    (422 `patient.unknown_dentist` otherwise). A dentist already assigned before an edit may be
    kept even after they are deactivated.
  - `practitionersByIds(ids)`, which includes inactive ones, gives the display-name order used by
    `sort=dentist`. Patients are ranked by the position of their dentist's id in that order
    (design Q7), so no query joins `users`' tables.
- The edge points down the graph: `users` depends on `auth`, `tenancy` and `roles`, and never on
  `patients`, so no cycle is possible.

## Consequences

- CLAUDE.md §4 module map: `patients` depends on `tenancy, users`.
- Deactivating a dentist leaves their patients assigned. The UI shows the name through
  `practitionersByIds` and offers reassignment. It does not happen automatically.
- `sort=dentist` costs one query for the distinct assigned dentist ids and one `users` call. That
  is small, because practitioners per tenant are few.
