# ADR-0050: A dentist's specialties are a fixed list on the staff profile

- Status: Accepted
- Date: 2026-10-15

## Context

A dentist practises one or more specialties (orthodontics, endodontics, …), one of them their
main one. Later, the visit and the patient record screens will differ by specialty: an
orthodontist and a general dentist do not need the same steps. Nothing recorded a specialty, and
the only clinical label on a staff member was the practitioner type (`dentist`, `assistant`,
`frontdesk`, `other`) and a free-text title.

## Decision

1. **The specialties are a fixed list in `@dcm/contracts`** (`SPECIALTIES` in
   `practitioners.ts`): `general`, `orthodontics`, `endodontics`, `periodontics`,
   `prosthodontics`, `oral_surgery`, `pediatric`, `implantology`, `cosmetic`. Screens will branch
   on these keys, so a clinic cannot edit the list (unlike the medical history lists, ADR-0046).
   Adding one is a code change; its label goes to the three locales.
2. **Only a dentist has specialties, and always at least one, one of them primary.** Any other
   practitioner type has none. The shared rule is `specialtiesFit` in the contracts.
3. **They are two columns on `staff_profiles`**, owned by `users`: `primary_specialty text` and
   `specialties text[]` (every specialty, the primary included, in the order chosen). Three CHECKs
   keep the rule in the database. No junction table: the list is short, fixed and always read with
   the profile.
4. **A dentist created without specialties starts on General dentistry**, through `POST /users` and
   for a new clinic's owner alike; sending them is optional, as a pair. On update, changing a
   dentist to another type clears them, and making someone a dentist needs one
   (`422 user.specialty_required`); specialties for another type are refused
   (`422 user.specialty_not_allowed`). The dentists that existed before were set to General
   dentistry (migration 0045).
5. **The session carries them**: `GET /session` has
   `profile: { practitionerType, primarySpecialty, specialties }` (null without a staff profile,
   e.g. a platform admin), so a screen that differs by specialty needs no new read.
6. **A platform admin sets them** in the clinic's Users tab and in the New clinic owner section.

## Consequences

- A specialty-dependent screen reads `session.profile`; the API side of the same rule, when it
  comes, reads the caller's profile in `users`.
- The dentist picker (`GET /users/practitioners`) does not show specialties yet.
- Renaming a key needs a migration that rewrites stored values, like a permission rename.
