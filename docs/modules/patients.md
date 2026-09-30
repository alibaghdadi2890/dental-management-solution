# `patients` module

**Status:** implemented. Patient records, search, duplicates, archive/restore and merge are done
(feature 3), with contacts & family (design addendum `2026-09-28-patients-contacts-design.md`,
ADR-0019): the tables, the domain rules, create with contacts, the contact routes, the lookup,
merge with contacts, the events and the exported read API (see [Contacts](#contacts)). Feature
4a adds the chart's dentition override (`setDentition`) and renames `lockForLedger` to
`lockForDependentWrite` (spec W22). The dental chart itself is `clinical`'s.

## Purpose

Patient records: demographics, phone and e-mail, insurance (as text), medical alerts/allergies,
primary dentist, notes, archive (soft delete) and merge; contacts (guardians, billing and
emergency contacts, who may themselves be patients: design addendum C1–C2). The POC's Patients
screen (list, quick view, create/edit, merge), the ⌘K palette and the patient record header are
the UI reference.
Balances are not here: views that need them (Owes balance, sort by balance, CSV export, create
with an opening balance) are composed by `billing` on top of this module (design Q5; ADR-0017).

- **Import key:** `externalId` is read-only over HTTP. It is not part of the create or edit
  contract; only the import (feature 6) will set it. Records created here have it null.
- **Display number:** `P-` plus at least 6 digits (`P-000001`). It comes from the tenant's
  `patient_counters` row, which the create transaction upserts. The row lock serialises
  concurrent creates, and a rolled-back create frees its number.
- **Phones:** normalised against the tenant `country` (`normalizePhone` in `@dcm/contracts`) and
  stored in E.164. A number typed with a leading `+` is accepted for any country.
  `phone_search` holds the E.164 digits and the national digits, so `03123…` and `96131…` both
  match.
- **Phone rule** (addendum C3): the phone is required unless the date of birth makes the patient
  a minor on the tenant's today (no date of birth = adult); blank means none. Create always
  checks it; an edit checks it when the patch touches `phone` or `dateOfBirth` (clearing an
  adult's phone, or giving a phoneless minor an adult or no date of birth), so a minor who has
  since come of age can still be edited without adding a phone first; a merge checks the resolved
  phone and date of birth the same way. Failure → 422 `validation_failed`, path `phone`, code
  `required`. A patient without a phone has `phone` and `phone_search` null and is never matched
  by phone digits.
- **Primary dentist:** `primaryDentistId` is the dentist's staff profile id (`staff_profiles.id`,
  `Practitioner.id`; ADR-0020, amending ADR-0016), never the auth user id. A newly chosen one
  must be among `UsersService.listPractitioners()` (active dentists); names, inactive dentists
  included, come from `practitionersByProfileIds`.
- **Dates:** the date of birth must not be after the tenant's today, computed from the injected
  clock in the tenant time zone (`localDate` in `platform/kernel`). Age bands use the same today.
- **Search `q`:** a diacritics-insensitive substring of `name_key`, the display number, the
  e-mail, and, when the query has at least 2 digits, the phone digits — the patient's own, and the
  resolved phone of any of the patient's live contacts (addendum C7). A query shaped like a
  patient number (`P-000123`, `p000123`: `/^p-?\d+$/i`) matches display numbers only, as
  `P-<digits>`; its digits never search phones. Bare digits (`000123`) are still a phone query.
  The alternatives are OR-ed over the whole `q`, not per word: a mixed query such as `Mona 0312`
  matches a name containing "mona 0312" (rarely any) **or** any phone containing `0312` (the
  digits of the whole query), so it finds everyone with those digits whatever their name. The
  contacts lookup (`ContactsRepository.lookup`) behaves the same way.
- **Archive** sets `deleted_at` (design Q11). The optional reason goes to the audit entry only.
  A merged-away record is archived and has `merged_into_id`; it can never be restored.
- **Merge** (design Q8): each pickable field (`MERGE_FIELDS`: full name, phone, date of birth,
  sex, e-mail, address, insurance, primary dentist, notes) comes from the kept record unless the
  choice is `drop`; a picked phone may be null (a minor), subject to the phone rule. Medical
  alerts are always the union of both records and are never truncated: more than 20 refuses the
  merge. `dentitionOverride` is not a merge field: the kept record keeps its own value, and the
  dropped record's override is simply discarded with the rest of the row.

## Owns

- `patients` (tenant RLS): the record, plus the internal search columns `name_key` and
  `phone_search`. `sex` is a Postgres enum (`patient_sex`) and `medical_alerts` is a `text[]`.
  `phone`/`phone_search` are nullable (a minor without a phone). `primary_dentist_id` is a staff
  profile id with no foreign key (ADR-0020; `users` owns `staff_profiles`). `dentition_override`
  is a nullable Postgres enum (`dentition`: `primary`, `mixed`, `permanent`; spec W14) — the
  chart's stored override of its otherwise age-derived dentition stage, set only by
  `setDentition`.
  `merged_into_id` points at the kept patient; checks keep it off active records and off the
  record itself. Indexes: unique `(tenant_id, id)` (target of the contact foreign keys); unique
  `(tenant_id, display_number)`; unique `(tenant_id, external_id)` where the id is set;
  `(tenant_id, name_key, date_of_birth)` where active (duplicates); `(tenant_id, updated_at)`
  (recent). `updated_at` always comes from the database clock.
- `patient_counters` (tenant RLS): one row per tenant (`tenant_id` PK, `last_value`).
- `contacts` (tenant RLS, soft delete): `full_name?`, `name_key?`, `phone?` (E.164),
  `phone_search?`, `email?`, `linked_patient_id?`. `name_key`/`phone_search` are internal search
  columns derived by the repository exactly as on `patients` (a check keeps `name_key` present
  exactly when `full_name` is). A contact linked to a patient stores no
  name, phone or e-mail of its own (they are read from the patient), so a check requires
  `linked_patient_id` or `full_name`. Unique `(tenant_id, id)`; at most one live contact per
  linked patient (partial unique `(tenant_id, linked_patient_id)` where linked and not deleted);
  `(tenant_id, linked_patient_id)` → `patients (tenant_id, id)`.
- `patient_contacts` (tenant RLS, junction: hard delete): PK
  `(patient_id, contact_id)`, `relationship` (Postgres enum `contact_relationship`: parent,
  spouse, child, sibling, caregiver, other — the contact's relation to the patient), the role
  flags `is_guardian`, `is_billing_contact`, `is_emergency_contact` and one primary flag per role.
  Checks: at least one role; each primary implies its role. At most one primary per role per
  patient (partial unique `(tenant_id, patient_id)` per primary flag). Composite foreign keys
  `(tenant_id, patient_id)` → `patients` and `(tenant_id, contact_id)` → `contacts` keep both
  ends in the link's tenant. Indexes on `tenant_id` and `contact_id`.

## Public API (`index.ts`)

`PatientsModule`, `PatientsService`, `ContactsService` (see [Contacts](#contacts)),
`PatientSearchInternal`, `PatientRankKeys`, the domain errors (`MergeAlertsOverflowError`,
`MergeSameError`, `PatientArchivedError`, `PatientMergedError`, `PatientNotFoundError`,
`UnknownDentistError`, `ContactAlreadyLinkedError`, `ContactConflictError`,
`ContactIsPatientError`, `ContactLinkedError`, `ContactNotFoundError`,
`ContactPrimaryWithoutRoleError`, `ContactRoleRequiredError`), and the event names and types
(patient and contact events).

`PatientsService` (every input is the contract's Zod output; it returns the contract types):

| Method                                                   | Access                         | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create(input)`                                          | `patient:write`                | An invalid `phone`, a missing one for an adult (the phone rule), or a date of birth after the tenant's today → 422 `validation_failed` at that path. A `primaryDentistId` that is not the profile id of an active practitioner → 422 `patient.unknown_dentist`. Mints the number, audits `patient.create`, emits `PatientCreated`. The input is `PatientCreate`: `contacts` are linked and `linkContactId` becomes this patient in the same transaction (see [Create with contacts](#create-with-contacts-c4)); any failing link rolls the whole create back, number included.                                                                                                                                                                                                                                                                                                                                                                                   |
| `update(id, patch)`                                      | `patient:write`                | The row is locked `FOR UPDATE`. 404 `patient.not_found`; archived → 409 `patient.archived`. Same field checks as create. A dentist kept from before may be inactive; a newly chosen one must be active. Only fields whose stored value changes are written; a patch that changes nothing writes, audits and emits nothing. Audits `patient.update` (before/after); emits `PatientUpdated { patientId, fields }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `setDentition(id, { override })`                         | `visit:write` + `patient:read` | Spec W14: sets or clears the chart's dentition override, from the workspace's chart card header only — so it needs `visit:write`, not `patient:write`, plus `patient:read` since it returns the full record. The row is locked `FOR UPDATE` like `update`; merged away → 409 `patient.merged`, else archived → 409 `patient.archived`. An override equal to the stored value changes, audits and emits nothing. Audits `patient.dentition` (before/after); emits no event — no consumer reacts to it, the audit entry is the record (CLAUDE.md §9/§10) — and `dentitionOverride` isn't a `PatientPatch` field anyway, so it wouldn't fit `PatientUpdated`. `PUT /patients/:id/dentition`.                                                                                                                                                                                                                                                                        |
| `get(id)`                                                | `patient:read`                 | Archived and merged records included; 404 otherwise.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `getMany(ids)`                                           | `patient:read`                 | For `billing` (existence checks): the visible patients among `ids`, archived included, in no particular order.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `listItemsByIds(ids)`                                    | `patient:read`                 | For `billing`'s export rows (design addendum C14, resolved per C7): the list items — with the resolved primary guardian — among `ids`, archived included, in no particular order (one `listRowsByIds` query; a caller that needs a particular order, like the export from its snapshot, re-orders itself). `matchedContact` is always `null` (it is a search-only field).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `lockForDependentWrite(id)`                              | `patient:read`                 | For a dependent module's write on this patient (`billing`'s ledger writes; `clinical`'s visit start and completion, W22, ADR-0023), inside the caller's open transaction (throws if there is none). Reads the row `FOR SHARE`, so a merge, archive or edit (`FOR UPDATE`) waits until the write commits. Unknown → 404 `patient.not_found`; merged away → 409 `patient.merged`. Archived but not merged is allowed (a debt write-off). Returns the record.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `survivorOf(id)`                                         | none (job only)                | For `billing`'s merge re-point, inside the caller's open transaction (throws if there is none). Follows `mergedIntoId` from `id` to the patient it finally lives on (`id` itself unless merged away; A into B, B into C → C), reading each record `FOR SHARE` so the survivor cannot be merged away before the caller commits. `null` when `id` (or a link) is not a patient of this tenant. A cycle or a chain over 100 links throws. Not permission-gated (a job actor holds no permissions) but refuses any actor other than a job or system task.                                                                                                                                                                                                                                                                                                                                                                                                            |
| `search(query, internal?)`                               | `patient:read`                 | Offset page `{ items, total, page, size }` (ADR-0018). See below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `searchIds(query, internal?)`                            | `patient:read`                 | Every matching id, in the order `search` would page them, unpaged: the snapshot `billing`'s CSV export streams from. Same query (paging ignored), internal options and validation as `search`. Bounded by the tenant's patient count (ADR-0018).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `counts()`                                               | `patient:read`                 | `{ active, notSeen, archived }`, ignoring filters. `notSeen` equals `active` until visits exist (design Q14).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `duplicates()`                                           | `patient:read`                 | Groups of active patients sharing `name_key` and a non-null date of birth, each ordered by number.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `checkDuplicates({ fullName, dateOfBirth, excludeId? })` | `patient:read`                 | Active twins, for the create/edit warning.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `archive({ ids, reason? })`                              | `patient:write`                | The rows are locked `FOR UPDATE` in id order before anything is read, so the audit's before-snapshot is the state the archive applies to. All-or-nothing: an id the tenant can't see → 404, and nothing changes. Already archived ids are no-ops. One `patient.archive` audit entry (with the reason) and one `PatientArchived` per archived patient. **Returns the patients this call archived, in input order**: what an undo should restore.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `restore({ ids })`                                       | `patient:write`                | Locked and all-or-nothing like archive; any merged-away id → 409 `patient.merged`, checked under the lock before anything changes. Already active ids are no-ops. `patient.restore` and `PatientRestored` per restored patient. Returns the patients restored, in input order.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `merge({ keepId, dropId, fieldChoices, reason })`        | `patient:write`                | One transaction. An archived or merged-away record is refused first, unlocked (fail fast, so a doomed merge never queues behind the re-point job's `FOR SHARE` walk); then both rows are locked `FOR UPDATE` in id order, so overlapping merges never deadlock, and the check is repeated under the lock. The same id → 422 `patient.merge_same` (over HTTP the contract answers first with 400 `validation_failed` at `dropId`). Either record archived → 409 `patient.archived`. Too many alerts → 422 `patient.merge_alerts_overflow`. The kept record gets the resolved fields (a picked phone is re-normalised for its search digits). The dropped one is archived with `merged_into_id`. Audits `patient.merge` on the kept id (reason; before = `{ kept, dropped }`; after = the kept record). Emits `PatientsMerged { keptId, droppedId }`. Contacts move with the record (see [Merge with contacts](#merge-with-contacts-c8)). Returns the kept record. |

### `search(query, internal?)`

- Items are `PatientListItem`s, which carry (addendum C7):
  - `primaryGuardian`: `{ contactId, fullName, phone, relationship }` of the patient's primary
    guardian link, resolved (a contact linked to a patient shows that patient's name and phone),
    or null. Also on `duplicates()` and `checkDuplicates()` items.
  - `matchedContact`: `{ fullName, relationship }` of the contact through whose phone a digit `q`
    matched the patient — only when the patient's own name, number, e-mail and phone did not
    match (else null, and always null without a phone query). Several matching contacts: the
    primary guardian first, then the oldest link.

- `query` is `PatientListQuery`: `view`, `q`, `dentist` (staff profile id or `none`), `age`
  (`child`/`adult`/`senior`, by date of birth against the tenant's today), `alerts`, `lastVisit`
  (no effect until visits exist), `sort`, `dir`, `page`, `size`.
- `view=notSeen` returns the active patients (design Q14).
- `sort`:
  - `name`, `age` (youngest first for `asc`; no date of birth last), `recent` (most recently
    updated first, whatever `dir` says).
  - `dentist`: ranks patients by their dentist in `UsersService.practitionersByProfileIds` over
    every assigned dentist (profile ids), inactive ones included, in display-name order
    (tenant-locale collation).
    `domain/dentist-rank.ts` gives each dentist an integer key, dense-ranked: dentists whose
    names are equal under that collation share a key, so their patients sort by patient name.
    `desc` reverses the keys. Patients without a dentist come last in both directions.
- Ties always break on `name_key`, then `id`.
- Rank ordering (`sort=dentist`, `sort=balance`; design Q7): `coalesce(keys[array_position(ids,
column)], restKey)` ascending, then `name_key`, then `id`; `dir` is ignored, the caller
  encodes the direction in the keys. `ids` and `keys` must have the same length and the keys
  must be 32-bit integers (`RangeError` otherwise).
- `internal` (`PatientSearchInternal`) is for other modules' services only. HTTP never reaches it.
  The rank shape is exported as `PatientRankKeys`.
  - `idsIn`: restricts the page to these ids. It is required for `view=owing`, which is read as
    active ∩ `idsIn`.
  - `rank { ids, keys, restKey }`: `keys[i]` is the sort key of patient `ids[i]`; unlisted
    patients get `restKey`. Equal keys tie and fall back to the name order. It is required for
    `sort=balance` (`billing`'s `rankByBalance`).
  - `size`: overrides the page size (1–500) for `search` (e.g. a one-row page when only the total
    counts).
  - Without them, `view=owing` or `sort=balance` → 422 `validation_failed` (path `view`/`sort`).

## Contacts

Contacts are people, not fields (ADR-0019): someone known to the clinic who relates to patients
as a guardian, billing contact or emergency contact, and who may be a patient (a linked contact
reads its name, phone and e-mail from that patient). Ledgers stay per patient; household views
are aggregates over `is_billing_contact` (`patientsBilledBy`).

### Persistence and domain

- **Contracts** (`@dcm/contracts` `contacts.ts`): `contactRelationshipSchema`,
  `contactRolesSchema`, `contactLinkTargetSchema` (exactly one of `{ contactId }`,
  `{ patientId }`, `{ newContact: { fullName, phone, email? } }`), `contactLinkInputSchema`,
  `contactLinkPatchSchema` (primaries can only be set to `true`), `contactPatchSchema`,
  `contactViewSchema`, `patientContactSchema`, `contactLookupQuerySchema`,
  `contactLookupItemSchema`; `patientCreateSchema` in `patients.ts` (the input plus up to 10
  `contacts` and `linkContactId`).
- **Domain** (`domain/contacts.ts`, pure):
  - `planLinkChange(patientId, links, change)` for `link`, `update` (relationship, roles,
    `makePrimary`) and `unlink`, returning `{ deletes, updates, inserts }`. Primaries follow
    `assignPrimaries`: per role, an explicit primary, else the current one, else the oldest
    holder (link `created_at`, then contact id). So the first holder becomes primary, a new
    primary clears the old one, and removing the primary (unlink or role removal) promotes the
    oldest remaining holder. A primary without its role, a link without a role, linking twice
    and changing a link that does not exist are domain errors (`contact.primary_without_role`,
    `contact.role_required`, `contact.already_linked`, `contact.not_found`).
  - `planContactMerge(input)` (both ids, both link lists, both patients' linked contacts with their
    links) → `{ deletes, updates, moves, relinks, folds }` (addendum C8): the
    dropped record's links move to the kept one; a contact on both gets the roles OR-ed, and the
    kept link's relationship. Per role, the kept primary wins, else the dropped one, else the
    oldest holder. Links that would make the kept patient its own contact are deleted. The contact
    linked to the dropped patient is re-pointed to the kept one, or folded into the kept
    patient's linked contact (its links on other patients re-pointed, deduplicated with roles
    and primaries OR-ed, and the contact soft-deleted).
  - `resolveContact(contact, linkedPatient?)` → `ContactView`; `isOwnContact` /
    `assertNotOwnContact` (`contact.is_patient`: a patient is never their own contact).
- **Repositories** (every query through `TenantDb`, RLS only, no tenant parameters):
  - `ContactsRepository`: `insert` (derives `name_key`/`phone_search`), `insertLinked(patientId)`,
    `update` (live unlinked contacts only), `findById` (with the linked patient),
    `linkToPatient(contactId, patientId)` (sets the link and clears the own name, phone and
    e-mail in one update), `findByLinkedPatient`, `lookup(q, limit)` (resolved `name_key` or ≥ 2
    digits of the resolved phone digits), `findByPhone(e164)` (exact resolved E.164),
    `relink`, `softDelete`. Reads skip soft-deleted contacts; `lookup` and `findByPhone` order
    by name key in the "C" collation (`byNameKey`), then id. For planning, locked `FOR UPDATE`
    in id order: `lockForLinking(ids, linkedPatientIds)` (a link's existing contacts and the
    contacts that are its `{ patientId }` targets, one statement),
    `linkedToPatientsForUpdate(patientIds)` (a merge's two linked contacts) and
    `findByIdsForUpdate(ids)` (only `updateContact`'s contact). A race on "one live contact per
    linked patient" (`insertLinked`, `linkToPatient`, `relink`) → 409 `contact.conflict`.
  - `PatientContactsRepository`: `listForPatient` (resolved; primaries first, then oldest),
    `linksOf`, `listForContact`, `patientsBilledBy`; for planning, `linksOfForUpdate` and
    `listForContactForUpdate` (rows locked `FOR UPDATE`). Production code writes links only
    through plans: `applyLinkPlan`/`applyMergePlan` write one in one transaction, in an order the
    one-primary-per-role indexes accept (deletes, then the changed rows' primaries cleared, then
    their full state, then inserts, moves and re-points). A stale plan that still hits a primary
    index → 409 `contact.conflict`; one inserting an existing link → 409
    `contact.already_linked`. Inserted links take `created_at` from `clock_timestamp()`, so links
    created in one transaction keep their order (promotion picks the oldest holder).
  - Planning protocol: open a transaction; lock the rows in the [lock order](#lock-order); read
    the plan's inputs with the `…ForUpdate` methods (all of them throw outside a transaction);
    plan; apply. `ContactsRepository.lockForLinking(ids, linkedPatientIds)` locks, in one
    statement in id order, the contacts a link change targets and the contacts that are its
    `{ patientId }` targets. `PatientsRepository.lookupUnlinked(q, limit)` is the lookup's patient
    half and `listRowsByIds(ids)` gives `patientsBilledBy` its list rows.
- **Search SQL** (`patient-search.sql.ts`, `contact-resolution.sql.ts`): the contact-phone match
  is `patients.id in (select patient_id … where resolved phone_search like …)`. It is
  uncorrelated, so Postgres evaluates it once as a hashed subplan, and a patient is counted once
  however many contacts match (`count(*) over ()` stays exact). `matchedContact` is a correlated
  subquery behind `case when <own match> then null`, so it runs only for rows matched through a
  contact. `primaryGuardian` is a left join to the primary-guardian links, at most one per
  patient by the partial unique index. At 5,000 patients and 2,500 contacts the search runs in
  about 17 ms (ADR-0018 bounds).

### Lock order

Every contact write takes its row locks in one order, so two of them never deadlock
(`application/contact-links.ts` enforces it):

1. **Patient rows**, in id order, in one statement: the patient whose links change, plus the
   `{ patientId }` targets of a link (`ContactLinks.lockPatients`); for a merge, both records plus
   every other patient whose links a fold rewrites (`lockPair(keep, drop, others)`). A create
   takes the tenant's `patient_counters` row before this (only creates take it); its new patient
   row is its own.
2. **Contact rows**, in id order, in one statement (`lockForLinking`, `linkedToPatientsForUpdate`,
   `findByIdsForUpdate`).
3. **Link rows** (`linksOfForUpdate`, `listForContactForUpdate`). Every writer of a patient's
   links holds that patient's row lock, so link rows are never contended out of order.

A level may be skipped (a link patch or unlink locks the patient, then its links; `PATCH
/contacts/:id` locks only the contact), never reversed. A unique-index race that still slips
through becomes 409 `contact.conflict` (or `contact.already_linked`) and aborts the transaction;
nothing catches it and keeps writing.

### `ContactsService`

Exported for features 5–6 (addendum C12): `contactsOf`, `patientsBilledBy`,
`findContactsByPhone`. Writes re-check `patient:write`, are audited in their transaction and emit
after commit. A write on an archived patient → 409 `patient.archived`, on a merged-away one → 409
`patient.merged` (checked under the patient lock). Archive itself leaves links in place, and a
contact linked to an archived patient still resolves, with `linkedPatient.archived: true` (C9).

| Method                                    | Access          | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contactsOf(patientId)`                   | `patient:read`  | `PatientContact[]`, resolved, primaries first then oldest link; archived and merged-away patients too. Unknown → 404 `patient.not_found`.                                                                                                                                                                                                                                                                                                                  |
| `patientsBilledBy(contactId)`             | `patient:read`  | `PatientListItem[]` of the patients linking the contact with `is_billing_contact`, archived included, by name. Unknown or deleted contact → 404 `contact.not_found`.                                                                                                                                                                                                                                                                                       |
| `findContactsByPhone(phone)`              | `patient:read`  | `ContactView[]` whose resolved phone is `phone` normalised with the tenant country; an unparseable phone matches nobody (`[]`).                                                                                                                                                                                                                                                                                                                            |
| `lookup({ q })`                           | `patient:read`  | Search-or-create (C5): contacts (resolved), and active patients who are nobody's contact yet, whose name key contains `q` or whose phone digits contain its digits (≥ 2). A patient with a linked contact appears once, as that contact. Both halves are read in one transaction, each cut at 10 in SQL by name key in the "C" collation; the merged list keeps that order (code points), contacts before patients on equal keys, then id, and at most 10. |
| `link(patientId, input)`                  | `patient:write` | A `ContactLinkInput` (see [Linking](#linking)). Returns the patient's contacts.                                                                                                                                                                                                                                                                                                                                                                            |
| `updateLink(patientId, contactId, patch)` | `patient:write` | Relationship, roles, primaries (`isPrimary…: true` moves the primary). Not linked → 404 `contact.not_found`; no role left → 422 `contact.role_required`. A patch that changes nothing writes and audits nothing. Audits `contact.roles`. Returns the patient's contacts.                                                                                                                                                                                   |
| `unlink(patientId, contactId)`            | `patient:write` | Hard-deletes the link; a primary is replaced by the oldest remaining holder. The contact stays (the lookup still finds it). Not linked → 404. Audits `contact.unlink`, emits `ContactUnlinked`. Returns the remaining contacts.                                                                                                                                                                                                                            |
| `updateContact(contactId, patch)`         | `patient:write` | Name, phone (normalised; invalid → 422 at `phone`) and e-mail of an **unlinked** contact. Linked → 409 `contact.linked` (edit the patient record); unknown → 404. Only changed fields are written; audits `contact.update` (resource `contact`, before/after name, phone, e-mail), emits `ContactUpdated`. Returns the `ContactView`.                                                                                                                      |

### Linking

`ContactLinks.link` (shared by create and `POST /patients/:id/contacts`) resolves each
`ContactLinkInput` target under the locks and checks every target before anything is written:

- `{ contactId }`: a live contact of the tenant; unknown (or another tenant's) → 422
  `validation_failed` at `target.contactId`, code `not_found`.
- `{ patientId }`: that patient's linked contact, or a new contact linked to it; unknown → 422 at
  `target.patientId` (`not_found`); merged away → the same path, code `merged`. An archived
  patient may be linked.
- `{ newContact }`: a new contact, its phone normalised with the tenant country (invalid → 422 at
  `target.newContact.phone`).
- The patient itself (its `{ patientId }`, or the contact that is the patient) → 422
  `contact.is_patient`. Already linked → 409 `contact.already_linked`.

Each link is then planned with `planLinkChange` (the first holder of a role becomes its primary),
applied, audited `contact.link` and announced `ContactLinked`.

The audit entries `contact.link`, `contact.unlink` and `contact.roles` have resource `patient`
(the patient's id), so they appear in the patient's history. Their `after` (link), `before`
(unlink) or both (roles) is `{ contactId, fullName (resolved), relationship, isGuardian,
isBillingContact, isEmergencyContact, isPrimaryGuardian, isPrimaryBilling, isPrimaryEmergency }`:
no phone or e-mail.

### Create with contacts (C4)

`PatientsService.create(input: PatientCreate)` — also reached through `billing`'s
`POST /billing/opening-balances`, whose `patient` is the same schema. After the patient row and
its `patient.create` audit entry, in the same transaction, the `contacts` (≤ 10) are linked as
above, with errors at `contacts.<i>.target…` (under `patient.` through `billing`). Two targets
that resolve to the same contact (e.g. `{ patientId }` and that patient's `{ contactId }`) → 422
at `contacts.<i>`, code `duplicate`. `linkContactId` must be an unlinked contact (unknown → 422 at
`linkContactId`; linked → 409 `contact.already_linked`). It becomes the new patient first
(`linkToPatient` clears its own fields), audited `contact.update` (resource `contact`) and
announced `ContactUpdated`. Any failure rolls back the patient, its number and every new contact.

### Merge with contacts (C8)

In the merge transaction, after the field merge and the `patient.merge` audit entry, the two
linked contacts are locked, then both patients' links and, for a fold, the dropped contact's
links. `planContactMerge` is applied (`applyMergePlan`, then `relink`, then the folded contact is
soft-deleted):

- The dropped record's links move to the kept one. For a contact on both, the roles are OR-ed,
  the kept link's relationship stays and the kept primaries win; a dropped primary is used where
  the kept record has none.
- Links that would make the kept patient its own contact are deleted.
- The contact that is the dropped patient is re-pointed to the kept one, or folded into the kept
  patient's contact (its links on other patients re-pointed, or merged with an existing link).

Before locking, the merge reads (unlocked) which other patients a fold would touch, and locks
them together with the pair. If a link made meanwhile would touch a patient it did not lock, the
merge answers 409 `contact.conflict` and changes nothing.

When anything changed, one `contact.merge` audit entry on the kept patient summarises it:
`{ droppedId, movedLinks, updatedLinks, removedLinks, relinkedContactId, foldedContactId,
foldedIntoContactId }`. The re-pointed contact and the folded one each get `ContactUpdated`; link
moves emit nothing more (consumers follow `PatientsMerged`). A folded contact id maps to the kept
patient's linked contact (`foldedIntoContactId`): the folded contact is soft-deleted, and every
link it had now points at that contact.

## HTTP

| Route                                      | Access          | Notes                                                                                           |
| ------------------------------------------ | --------------- | ----------------------------------------------------------------------------------------------- |
| `GET /patients`                            | `patient:read`  | `view=owing` and `sort=balance` → 400 `validation_failed`; `GET /billing/patients` serves them. |
| `GET /patients/counts`                     | `patient:read`  |                                                                                                 |
| `GET /patients/duplicates`                 | `patient:read`  |                                                                                                 |
| `GET /patients/duplicates/check`           | `patient:read`  | `?fullName=&dateOfBirth=&excludeId=`                                                            |
| `GET /patients/:id`                        | `patient:read`  |                                                                                                 |
| `POST /patients`                           | `patient:write` | 201 with the record.                                                                            |
| `PATCH /patients/:id`                      | `patient:write` | At least one field.                                                                             |
| `PUT /patients/:id/dentition`              | `visit:write`   | Body `{ override: DentitionStage \| null }` (spec W14). 200 with the record.                    |
| `POST /patients/archive`                   | `patient:write` | 200 with the archived records.                                                                  |
| `POST /patients/restore`                   | `patient:write` | 200 with the restored records.                                                                  |
| `POST /patients/merge`                     | `patient:write` | 200 with the kept record.                                                                       |
| `GET /patients/:id/contacts`               | `patient:read`  | The patient's `PatientContact[]`.                                                               |
| `POST /patients/:id/contacts`              | `patient:write` | Body `ContactLinkInput`. 201 with the patient's contacts after the link.                        |
| `PATCH /patients/:id/contacts/:contactId`  | `patient:write` | Body `ContactLinkPatch`. 200 with the patient's contacts.                                       |
| `DELETE /patients/:id/contacts/:contactId` | `patient:write` | 200 with the patient's remaining contacts (not 204: a primary may have moved).                  |
| `GET /contacts/lookup?q=`                  | `patient:read`  | `ContactLookupItem[]` (search-or-create).                                                       |
| `PATCH /contacts/:id`                      | `patient:write` | Body `ContactPatch` (unlinked contacts only). 200 with the `ContactView`.                       |
| `GET /contacts/:id/billed-patients`        | `patient:read`  | `PatientListItem[]` (`patientsBilledBy`).                                                       |

Contact writes return the patient's whole contact list, because one change can move a primary on
another link. An unknown (or another tenant's) patient in the path → 404 `patient.not_found`; a
contact the patient does not link, or an unknown contact in the path → 404 `contact.not_found`;
an unknown id inside a body is a 422 at its path.

## Events

- Emits (after commit; the generic audit subscriber records each one):
  - `PatientCreated { patientId }`
  - `PatientUpdated { patientId, fields }`: the names of the changed patch fields.
  - `PatientArchived { patientId }`
  - `PatientRestored { patientId }`
  - `PatientsMerged { keptId, droppedId }`, published inside the merge transaction. Consumed by
    `clinical`, whose in-transaction handler re-points the dropped patient's visits, diagnoses,
    plans and tooth status before commit (a failure there fails the merge; spec W24), and by
    `billing` after commit, which re-points the dropped patient's ledger entries to the kept one
    through a BullMQ job (design Q9, ADR-0017).
  - `ContactLinked { patientId, contactId }`: a link was made (a contact route, or a create).
  - `ContactUnlinked { patientId, contactId }`.
  - `ContactUpdated { contactId }`: an unlinked contact's own fields changed; it became a
    patient (`linkContactId`); or a merge re-pointed it to the kept patient or folded it into the
    kept patient's linked contact (its successor).
  - Role and relationship changes and a merge's link moves are audited, not announced.
- Consumes: —

## Depends on

- `tenancy`: country (phones) and time zone (today).
- `users`: practitioners for the primary dentist, by staff profile id (`listPractitioners`,
  `practitionersByProfileIds`; ADR-0016, ADR-0020).
- `audit`.

Nothing here imports `billing` or `clinical`. `billing` depends on `patients` (`create` with
contacts, `getMany`, `listItemsByIds` (the export's rows and guardian columns),
`lockForDependentWrite`, `search`/`searchIds` with their internal options, `survivorOf`, and
`PatientsMerged`). `clinical` depends on `patients` (`get`, `getMany`, `lockForDependentWrite`,
and `PatientsMerged`).

## Permissions

- `patient:read`, `patient:write`: every system role (owner, dentist, assistant, front desk). A
  platform admin acting in the tenant also has them.
- `setDentition` also requires `visit:write` (spec W14; the permission catalog is
  `packages/contracts/src/permissions.ts`, used mainly by `clinical`'s visit routes): every
  system role but front desk holds it.
