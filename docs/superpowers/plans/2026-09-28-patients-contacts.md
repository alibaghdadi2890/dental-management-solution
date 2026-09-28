# Patients — contacts & family, dentist profile ids — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax. As in the base plan, code lives in the commits; each task names its
> files, the tests to write first, and the verification commands.

**Goal:** Bring `feat/patients` in line with the revised brief per
`docs/superpowers/specs/2026-09-28-patients-contacts-design.md` (C1–C15), refactoring the built
feature in place (the branch is unmerged).

**Architecture:**

- `patients` gains `contacts` and `patient_contacts` (RLS). Contact links carry a relationship,
  role flags and one primary per role. A contact linked to a patient reads its name and phone
  from that patient.
- The guardian and emergency text fields are removed, and phone becomes optional for minors.
- Search and ⌘K match contact phones. List items carry the primary guardian and the matched
  contact.
- Merge moves the dropped record's contacts to the kept record.
- Dentists are referenced by staff profile id everywhere.
- Migration 0009 is rewritten, and 0010/0011 are regenerated after it.

**Tech stack:** unchanged from the base plan.

**Execution order (keeps every commit green):** G2 → **R1** → **R2** → H2 → I1 → J1 → J2 → J3 →
K1, where:

- **R1** combines G1's breaking contract changes with H1's schema rewrite. It removes the three
  fields, makes the minor phone optional, switches the dentist to a profile id, and rewrites
  0009 (including the still-unused contacts tables). It also makes the minimal API, billing and
  web adaptations so everything compiles, and deletes `practitionersByAuthUserIds`.
- **R2** is G1's additive contact schemas plus the rest of H1: the contacts domain, the
  repositories, contact-phone search, and `primaryGuardian`/`matchedContact` on list items.

Completeness with a guardian (C10) lands with H2/J3.

**Gate for every task:**

- `pnpm lint && pnpm typecheck` green.
- Contracts tests pass: `pnpm --filter @dcm/contracts test`.
- API unit and integration tests pass: `pnpm --filter @dcm/api test:unit test:integration`.
- Web tests pass: `pnpm --filter @dcm/web exec vitest run --maxWorkers=2 --testTimeout=30000`.
- Web build passes: `pnpm --filter @dcm/web build`.
- `pnpm format:check` is clean.
- Docs for touched modules are updated.
- One commit per task on `feat/patients`, with the `Co-Authored-By` trailer.

**Local environment rules:**

- The user's `pnpm dev` (`nest --watch`, `vite`, `tsc --watch`) is running. Never kill it.
- Never run the API build: it clears `apps/api/dist`, which `nest --watch` serves from.
- To make the dev API pick up changes, touch `apps/api/src/main.ts`.
- Postgres runs in Compose on port 55432 as `dcm_owner`. Local ports 5432 and 6379 belong to
  other processes.

---

## Step (g) — contracts and users

### Task G1: Contracts refactor

**Files:**

- `packages/contracts/src/patients.ts` (+ spec)
- `packages/contracts/src/contacts.ts` (+ spec), new
- `packages/contracts/src/patient-age.ts`: completeness
- `packages/contracts/src/billing.ts` (+ spec): `createWithOpeningBalanceSchema.patient` uses
  the create schema
- `packages/contracts/src/users.ts` (+ spec)
- `packages/contracts/src/index.ts`

- [x] **Tests first:**
  - `patientFields` has no `guardianName`, `guardianPhone` or `emergencyContact`.
  - `phone` is optional or null in the schema; the rule is server-side (C3).
  - `primaryDentistUserId` is renamed to `primaryDentistId`.
  - `MERGE_FIELDS` has no `guardian` or `emergencyContact`.
  - `contactRelationshipSchema` accepts exactly the 6 values.
  - `contactLinkInputSchema`:
    - the target is exactly one of `{ contactId }`, `{ patientId }`, `{ newContact }`;
    - `newContact` requires `fullName` and `phone`;
    - at least one role flag is true.
  - `contactLinkPatchSchema` accepts a partial relationship, roles and primaries, and rejects `{}`.
  - `contactPatchSchema` (name, phone, email) rejects `{}`.
  - `patientCreateSchema` = input + `contacts` (≤ 10) + `linkContactId?`.
  - `contactViewSchema` and `patientContactSchema` (C6).
  - `contactLookupQuerySchema` (`q` of 1–100 characters) and `contactLookupItemSchema`
    (contact | patient).
  - `patientListItemSchema` gains `primaryGuardian` and `matchedContact`.
  - `profileCompleteness({ email, address, minor, hasGuardian })`.
  - `practitionerSchema` gains `id` (profile id).
  - `staffUserSchema` gains `profileId`.
- [x] **Implement, then verify** with `pnpm --filter @dcm/contracts test build`. API and web will
      not compile until G2–G8; that is expected within this chain. Commit anyway only if the
      repo gate can pass. Otherwise fold G1 into G3's commit — the implementer decides and
      reports which.
- [x] **Commit:** `refactor(contracts): contacts, optional minor phone and dentist profile ids`
      (folded into R1, `66e4ef9`).

### Task G2: Users expose staff profile ids

**Files:**

- `apps/api/src/modules/users/{persistence/staff.repository,application/users.service,http/users.controller}.ts`
- `apps/api/src/modules/users/domain/practitioner-order.ts`
- `apps/api/test/integration/users.int-spec.ts`
- `docs/modules/users.md`
- `docs/adr/0020-dentists-referenced-by-staff-profile-id.md` (amends 0016)
- `docs/adr/README.md`
- `CLAUDE.md`:
  - §6 or §7: a new rule — "a domain model refers to a staff member in a clinical role (e.g. the
    primary dentist) by `staff_profiles.id`, never the auth user id";
  - §4 unchanged.

- [x] **Integration tests first:**
  - `GET /users/practitioners` returns `{ id: profileId, userId, displayName, title }`;
  - `practitionersByProfileIds(profileIds)` includes deactivated staff;
  - `GET /users` items carry `profileId`.
- [x] **Implement.** Add `practitionersByProfileIds` / `byProfileIds` alongside the existing
      auth-user-id lookups, renamed `practitionersByAuthUserIds` / `byAuthUserIds` (not
      `practitionersByIds` / `byUserIds`, which would be ambiguous about which id they take now
      that both exist). `patients` and `billing` keep calling the auth-user-id lookup until
      H1/H2.
- [x] **Commit:** `feat(users): expose staff profile ids for practitioner references`.

## Step (h) — patients backend

### Task H1: Schema, migrations, domain, repositories

**Files:**

- `modules/patients/persistence/schema.ts`:
  - `patients`: `phone` and `phone_search` become nullable; drop `guardian_name`,
    `guardian_phone` and `emergency_contact`; rename `primary_dentist_user_id` to
    `primary_dentist_id`.
  - Add the `contact_relationship` enum and the `contacts` and `patient_contacts` tables (C1, C2).
- `modules/patients/persistence/contacts.repository.ts` and
  `patient-contacts.repository.ts`, new.
- `modules/patients/persistence/patients.repository.ts` and `patient-search.sql.ts`:
  - contact-phone match;
  - `primaryGuardian` and `matchedContact` in rows;
  - dentist column rename.
- `modules/patients/domain/contacts.ts` (+ spec), new: primary rules, merge contact plan, resolved
  view.
- `modules/patients/domain/merge.ts` (+ spec): fields without `guardian` and `emergencyContact`.
- Migrations:
  - Delete `0009_*`, `0010_*` and `0011_*` (SQL, snapshots, journal entries).
  - Regenerate `0009_patients` (`db:generate --name patients`) and `0010_billing`.
  - Recreate `0011_ledger_append_only` (`--custom`) with the same SQL as before.
- `apps/api/test/integration/patients-repository.int-spec.ts`.
- `test/integration/tenant-isolation.int-spec.ts`: it auto-discovers tables; confirm it covers
  `contacts` and `patient_contacts`.

**Dev database reset, once, for `dcm_owner` on port 55432:**

1. Drop `ledger_entries`, `patient_contacts`, `contacts`, `patients` and `patient_counters`, and
   the enums `ledger_entry_kind`, `contact_relationship` and `patient_sex`.
2. Delete the `__drizzle_migrations` rows for 0009–0011: the rows whose `created_at` is at or
   after the old 0009 `when`.
3. Run `pnpm --filter @dcm/api db:migrate`.
4. Verify the tables and the ledger grants.
5. Touch `apps/api/src/main.ts`.

Take a `pg_dump -Fc` backup into the scratchpad first.

- [x] **Unit tests first:**
  - Primary rules:
    - the first holder of a role becomes primary;
    - an explicit primary clears the previous one;
    - unlinking a primary promotes the oldest remaining holder;
    - a primary flag without its role is rejected.
  - Merge contact plan:
    - a contact on both records: roles OR-ed, kept primaries win;
    - the dropped primary is used only where the kept record has none;
    - self-links are removed;
    - linked contacts are folded.
  - Resolved view: a linked contact reads name and phone from the patient.
- [x] **Repository integration tests first:**
  - CHECK and partial unique indexes: one live contact per linked patient; one primary per role
    per patient; a primary implies its role; at least one role.
  - Contact-phone search, resolved through a linked patient's phone.
  - `primaryGuardian` in search rows.
  - RLS: tenant B sees no contacts.
- [x] **Implement and generate the migrations**, and review the SQL: enums, RLS on both new
      tables, partial indexes, CHECKs, and ledger grants unchanged.
- [x] **Reset the dev database** as above.
- [x] **Commit:** `refactor(patients): contacts tables, optional minor phone and dentist profile id`
      (landed as R1 `66e4ef9` and R2 `4671265`).

### Task H2: Service, routes, events, merge, exported API

**Files:**

- `modules/patients/application/patients.service.ts`: the phone rule (C3); create with
  `contacts` and `linkContactId` (C4); merge (C8); completeness (C10); dentist by profile id
  (`assertActiveDentist` and `rankFor` switch from `practitionersByAuthUserIds` to
  `practitionersByProfileIds`).
- `modules/patients/application/contacts.service.ts`, new: C5, C11, C12.
- `modules/patients/http/{patients.controller,contacts.controller}.ts`.
- `modules/patients/events/contact-events.ts`.
- `modules/patients/index.ts`: export `contactsOf`, `patientsBilledBy`, `findContactsByPhone`
  and the events.
- `apps/api/test/integration/{patients,contacts}.int-spec.ts`.
- `tenant-isolation-services.int-spec.ts`.
- Docs:
  - `docs/modules/patients.md`;
  - `docs/adr/0019-contacts-are-people.md` and the ADR index;
  - CLAUDE.md §4 patients row: owns `patients, patient_counters, contacts, patient_contacts`;
  - the base spec status line: "Amended by 2026-09-28-patients-contacts-design.md".

- [x] **Integration tests first**, covering every case in the addendum's Testing → Integration
      list:
  - phone rule;
  - atomic create with a new guardian;
  - the sibling reusing the mother by lookup;
  - the mother becoming a patient via `linkContactId`;
  - the husband as billing contact, and `patientsBilledBy`;
  - primaries;
  - search and `matchedContact`;
  - merge with contacts;
  - events and audit (`contact.link`, `contact.unlink`, `contact.roles`, `contact.update`);
  - permissions;
  - dentist by profile id;
  - isolation.
- [x] **Implement:**
  - Every mutation re-checks `patient:write`, audits and publishes after commit.
  - The lookup requires `patient:read`.
  - `PATCH /contacts/:id` on a linked contact → 409 `contact.linked` ("edit the patient
    record").
- [x] **Commit:** `feat(patients): contacts and family with roles, lookup and merge`.

## Step (i) — billing

### Task I1: Billing follows the patient model

**Files:**

- `modules/billing/application/{billing.service,patient-export.service}.ts`:
  - create-with-opening-balance accepts the create schema, including contacts;
  - the export adds the Guardian name and Guardian phone columns;
  - dentist names come from profile ids (`patient-export.service.ts` switches from
    `practitionersByAuthUserIds` to `practitionersByProfileIds` — the last caller, so this task
    also deletes `UsersService.practitionersByAuthUserIds` and
    `StaffRepository.byAuthUserIds`).
- `http/export-headers.ts`: labels in en, ar and fr.
- `test/integration/{billing,billing-views}.int-spec.ts`.
- `docs/modules/billing.md`.

- [x] **Tests first:**
  - opening balance plus a new guardian in one call → patient, link and entry are created, and
    a failure rolls back all three;
  - the export's guardian columns (national format), and the Dentist column from profile ids.
- [x] **Commit:** `feat(billing): guardian columns in the export and contacts on opening-balance create`.

## Step (j) — SPA

### Task J1: API, models and the contact picker

**Files:**

- `features/patients/contacts-api.ts` (+ spec): `contactsQuery(patientId)`,
  `contactLookupQuery(q)`, the link, patch, unlink and patch-contact mutations, and invalidation
  (patients + billing).
- `features/patients/patient-form.ts` (+ spec):
  - drop the guardian fields;
  - the phone requirement follows minor/adult;
  - `pendingContacts` for create;
  - `showGuardianBlock`;
  - completeness.
- `features/patients/merge-draft.ts` (+ spec): fields.
- `features/users/users-api.ts`, `use-staff-names.ts`: profile-id maps.
- `features/patients/contact-picker.tsx` (+ spec), new.
- Locales in en, ar and fr.

- [x] **Unit tests first:**
  - phone required for an adult and optional for a minor;
  - the guardian block shown and hidden with the DOB;
  - the pending-contacts payload;
  - the picker:
    - calls lookup once, debounced;
    - shows the "Patient P-…" badge;
    - "Add new contact" reveals name*, phone* and relationship;
    - emits a `ContactLinkInput`.
- [x] **Commit:** `feat(web): contacts API, form model and contact picker`.

### Task J2: Panels

**Files:**

- `panels/patient-form-panel.tsx` and `patient-form-fields.tsx`:
  - Guardian block for minors: picker, relationship, and the "Also billing contact" and "Also
    emergency contact" toggles, both on by default;
  - an amber "No guardian recorded" note;
  - the adult "Contacts & family (optional)" disclosure;
  - a "Link to {name}" offer when the phone matches an unlinked contact;
  - in edit mode, contact actions apply immediately.
- `panels/quick-view-panel.tsx`: the Contacts block.
- `panels/merge-panel.tsx`: "Contacts — will be kept".
- Specs for each.

- [x] **Tests first**, for every item in the addendum's web list for panels.
- [x] **Commit:** `feat(web): guardian and contacts in the patient panels`.

### Task J3: List, palette and record

**Files:**

- `patients-table.tsx`: the "via" phone for minors.
- `command-palette.tsx`: the "via" line.
- `record/record-header.tsx`: the guardian chip.
- `record/overview-tab.tsx`: a Contacts row replaces Emergency.
- `record/contacts-card.tsx` and `record/add-contact-panel.tsx`, new, plus a right-panel slot on
  the record page.
- `record/information-tab.tsx`: completeness.
- Dentist select, filter chip and table names use profile ids.
- Specs for each.

- [x] **Tests first**, for the addendum's list, palette and record items.
- [ ] **Commit:** `feat(web): contacts on the list, palette and patient record`.

## Step (k) — end to end and docs

### Task K1: Playwright and sweep

**Files:**

- `apps/web/e2e/patients.spec.ts`, rewritten to the addendum's flow.
- `identity.spec.ts`: front desk adds a contact.
- Docs sweep for accuracy:
  - the patients, billing, users and imports module docs (the feature 6 import columns
    `guardian_name`, `guardian_phone`, `guardian_relationship`, `billing_contact_phone` as
    "designed for");
  - CLAUDE.md;
  - the ADR index;
  - both specs and this plan (tick the checkboxes; add implementation notes to the addendum).

- [x] **E2E:** a minor with a new guardian and an opening balance → the list shows the "via"
      phone and the balance → open the record → the guardian chip → edit the address →
      completeness flips → ⌘K by the guardian's digits shows "via" → Enter opens the record.
- [x] **Full gate + `pnpm --filter @dcm/web e2e`**, run against the user's dev servers after the
      dev DB reset.
- [ ] **Commit:** `feat(web): contacts end-to-end flow and docs`.
- [ ] **Final whole-branch review**, then `superpowers:finishing-a-development-branch`.

---

## Coverage check

| Addendum item                                      | Task                       |
| -------------------------------------------------- | -------------------------- |
| C1–C2 contacts tables, primaries, linked contacts  | H1, H2                     |
| C3 phone rule                                      | G1, H2, J1                 |
| C4 create with contacts / `linkContactId`          | G1, H2, I1, J2             |
| C5 contact routes, lookup                          | H2, J1                     |
| C6 resolved views                                  | G1, H1                     |
| C7 list/search `primaryGuardian`, `matchedContact` | G1, H1, J3                 |
| C8 merge with contacts                             | H1, H2, J2                 |
| C9 archive keeps links                             | H2                         |
| C10 completeness                                   | G1, H2, J3                 |
| C11 events/audit                                   | H2                         |
| C12 exported read API                              | H2                         |
| C13 dentist profile id, CLAUDE.md rule, ADR-0020   | G1, G2, H1, H2, I1, J1, J3 |
| C14 export guardian columns                        | I1                         |
| C15 migration rewrite + dev reset                  | H1                         |
| Screens                                            | J1–J3                      |
| Playwright + docs                                  | K1                         |
