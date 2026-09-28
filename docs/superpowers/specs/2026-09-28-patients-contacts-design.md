# Feature 3 — Patients: contacts & family, dentist profile ids — design addendum

Date: 2026-09-28 · Status: draft for review · Amends
`docs/superpowers/specs/2026-09-27-patients-design.md` (the "base spec"), which stays the
reference for everything not changed here.

## Why

The revised feature brief (`03-patients-prompt.md`, 2026-09-28) replaces the guardian and
emergency-contact text fields with **contacts**: people known to the clinic who relate to
patients as guardians, billing contacts or emergency contacts, and who may themselves be patients.
It also makes the patient phone optional for minors and adds contact-phone search, "via" lines and
guardian columns. Separately, the product owner decided that **domain models refer to a dentist
by the staff profile id**, not the auth user id. `feat/patients` is not merged, so the existing
implementation is refactored in place (no compatibility layers, migration 0009 rewritten).

## Differences from the base brief

| Brief #  | Old                                                                               | New                                                                                                                                                                                                                                                                        | Effect on the built code                                                                      |
| -------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| P2       | `phone` required; `guardianName`, `guardianPhone`, `emergencyContact` text fields | `phone` required for adults, optional for minors; no guardian/emergency text fields                                                                                                                                                                                        | `patients.phone` nullable; three columns and their contract/form/merge/UI fields removed      |
| P3 (new) | —                                                                                 | `contacts` + `patient_contacts`, roles, primaries, `linkedPatientId`, exported read API, ADR                                                                                                                                                                               | New tables, service, routes, events, UI                                                       |
| P4       | Primary dentist: store "staff profile id" (we stored the auth user id, ADR-0016)  | Same wording; confirmed: **profile id** everywhere a domain model refers to a dentist                                                                                                                                                                                      | `primary_dentist_id` = `staff_profiles.id`; `users` exposes profile ids; ADR-0020 amends 0016 |
| P7       | Duplicates by name + DOB                                                          | + contacts never count as duplicates; a new contact whose phone matches a contact or patient is offered first                                                                                                                                                              | Lookup endpoint + search-or-create control                                                    |
| P8       | Merge fields, archive dropped, ledger follows                                     | + `patient_contacts` move (deduplicated), contacts linked to the dropped record re-pointed; merge panel lists contacts "will be kept"                                                                                                                                      | Merge transaction + panel                                                                     |
| P10      | Search: name, phone, email, number                                                | + **contact phone**                                                                                                                                                                                                                                                        | Search SQL                                                                                    |
| P11      | ⌘K phone digits                                                                   | + contact phone, "via {contact} · {relationship}"                                                                                                                                                                                                                          | List item `matchedContact`; palette row                                                       |
| P12      | Export table columns                                                              | + primary guardian name / phone                                                                                                                                                                                                                                            | Export columns                                                                                |
| P13      | Patient events                                                                    | + `ContactLinked/Unlinked/Updated`                                                                                                                                                                                                                                         | Events, audit                                                                                 |
| Screens  | Guardian pair under 18; Emergency row                                             | Guardian block (search-or-create) for minors, "Contacts & family" disclosure for adults, quick-view Contacts block, list "via" phone for minors, record guardian chip, Contacts row, Contacts & family card + Add contact panel; completeness counts a guardian for minors | Panels, list, palette, record                                                                 |

Unchanged and kept as built (the brief restates older wording): the Owes-balance view and balance
sort are served by `GET /billing/patients` (base spec Q5, generalising `/billing/owing-patients`);
phone country comes from the tenant `country` (base spec Q3); zero opening balance means none.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | ADR  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- |
| C1  | **Contacts are people, not fields.** `contacts` (tenant-owned, RLS, soft delete): `id`, `full_name?`, `phone?` (E.164), `phone_search?`, `email?`, `linked_patient_id?`, `deleted_at?`, timestamps. A contact **linked** to a patient stores no name/phone/email of its own: they are read from the patient record (CHECK `linked_patient_id is not null or full_name is not null`; linking clears the own fields). At most one live contact per linked patient (partial unique index). Ledgers stay per patient; the billing contact is who you talk to and who pays, never whose account it is; household views are aggregates over `is_billing_contact`.                                                                                                                                                                                                                          | 0019 |
| C2  | **`patient_contacts`** (tenant-owned junction, hard delete): PK `(patient_id, contact_id)`, `relationship` (Postgres enum `contact_relationship`: parent, spouse, child, sibling, caregiver, other — the contact's relation _to the patient_), `is_guardian`, `is_billing_contact`, `is_emergency_contact`, `is_primary_guardian`, `is_primary_billing`, `is_primary_emergency`, timestamps. CHECKs: a primary flag implies its role; at least one role. Partial unique `(tenant_id, patient_id) where is_primary_<role>`. The first contact given a role becomes its primary; making another contact primary clears the previous one in the same transaction; removing a primary promotes the oldest remaining holder of that role. A patient is never its own contact.                                                                                                             | 0019 |
| C3  | **Phone rule**: required unless the DOB makes the patient a minor in the tenant time zone (no DOB = adult). The server re-checks on create and update (422 `validation_failed`, path `phone`, code `required`), including a DOB change that turns a phoneless minor into an adult.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | —    |
| C4  | **Create with contacts, atomically.** `patientCreateSchema = patientInputSchema + contacts?: ContactLinkInput[]` (≤ 10) `+ linkContactId?`. `ContactLinkInput = { target: { contactId } \| { patientId } \| { newContact: { fullName, phone, email? } }, relationship, isGuardian, isBillingContact, isEmergencyContact }`. `{ patientId }` reuses that patient's linked contact or creates one. `linkContactId` links an existing _unlinked_ contact to the new patient ("the mother becomes a patient"). Everything runs in the create transaction, including through `POST /billing/opening-balances`.                                                                                                                                                                                                                                                                            | —    |
| C5  | **After create, contact changes are immediate actions**, not part of a dirty form: `GET /patients/:id/contacts`, `POST /patients/:id/contacts` (a `ContactLinkInput`), `PATCH /patients/:id/contacts/:contactId` (relationship, roles, primaries), `DELETE /patients/:id/contacts/:contactId` (unlink), `PATCH /contacts/:id` (name/phone/email of an unlinked contact), `GET /contacts/lookup?q=` (search-or-create: contacts and patients by name or ≥ 2 phone digits, max 10, a patient with a linked contact appears once). `patient:read` for reads, `patient:write` for writes.                                                                                                                                                                                                                                                                                                | —    |
| C6  | **Resolved view**: `ContactView { id, fullName, phone, email, linkedPatient: { id, displayNumber, archived } \| null }`; `PatientContact { contact: ContactView, relationship, isGuardian, isBillingContact, isEmergencyContact, isPrimaryGuardian, isPrimaryBilling, isPrimaryEmergency }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | —    |
| C7  | **List and search.** `PatientListItem` gains `primaryGuardian: { contactId, fullName, phone, relationship } \| null` (resolved) and `matchedContact: { fullName, relationship } \| null` (set when a `q` matched only through a contact phone). `q` digits (≥ 2) also match contact phones, resolved (own `phone_search`, or the linked patient's). The list shows the guardian's phone with "via {first name}" for **minors with a primary guardian**; otherwise the patient's phone.                                                                                                                                                                                                                                                                                                                                                                                               | —    |
| C8  | **Merge** (one transaction, after the existing steps): move the dropped patient's `patient_contacts` to the kept one — for a contact on both, roles are OR-ed and the kept record's primaries win; a dropped primary becomes primary only where the kept record has none; links that would make the kept patient its own contact are removed. Contacts linked to the dropped patient: re-pointed to the kept one, or folded into the kept patient's existing linked contact (links moved, deduplicated, dropped contact soft-deleted).                                                                                                                                                                                                                                                                                                                                               | —    |
| C9  | **Archive** leaves contact links in place; a contact linked to an archived patient still resolves (with `archived: true`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | —    |
| C10 | **Completeness** = email and address present, and for minors a guardian.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | —    |
| C11 | **Events and audit**: `ContactLinked { patientId, contactId }`, `ContactUnlinked { patientId, contactId }`, `ContactUpdated { contactId }`. Link/unlink/role changes are audited with `resource_type = 'patient'` (so they appear in the patient's timeline: `contact.link`, `contact.unlink`, `contact.roles`); contact field edits with `resource_type = 'contact'`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | —    |
| C12 | **Exported read API** (`patients/index.ts`, for features 5–6): `contactsOf(patientId)`, `patientsBilledBy(contactId)` (patients linking this contact with `is_billing_contact`), `findContactsByPhone(phone)` (resolved, normalised with the tenant country). `patient:read`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 0019 |
| C13 | **Dentist = staff profile id.** `patients.primary_dentist_id` (no cross-module FK) holds `staff_profiles.id`; contract `primaryDentistId`; filter `dentist=<profileId>`; rank by profile ids. `users`: `Practitioner` gains `id` (profile id, `userId` kept for links to users); `StaffUser` gains `profileId`; `listPractitioners()` / `practitionersByProfileIds(profileIds)` are the end state `patients` and `billing` read through. (G2 adds `practitionersByProfileIds` / `byProfileIds` alongside the pre-existing auth-user-id lookups, renamed `practitionersByAuthUserIds` / `byAuthUserIds` so no method name is ambiguous about which id it takes; H1/H2 move `patients` and `billing` to the profile-id lookup and delete the auth-user-id ones.) CLAUDE.md gains the rule "domain models refer to a staff member in a clinical role (dentist) by `staff_profiles.id`". | 0020 |
| C14 | **Export** adds "Guardian name" and "Guardian phone" (primary guardian, resolved; national format for tenant-country numbers).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | —    |
| C15 | **Migration 0009 is rewritten** (patients, counters, contacts, patient_contacts, enums) and 0010/0011 regenerated after it. The local dev database is reset once for these three migrations (tenants are already empty): drop the patients/billing tables and enums and their three `__drizzle_migrations` rows, then `db:migrate`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | —    |

### Implementation notes

- **C14 column placement (I1):** Guardian name and Guardian phone sit right after Phone in the
  export, not at the end. Both are "how to reach someone about this patient", so grouping them
  with the patient's own phone reads better than splitting them across the sheet by the
  visit/dentist/balance columns. Guardian phone reuses the same national/foreign formatting and
  CSV injection guard as the patient's own phone column; a linked guardian who is themself a
  patient resolves from that patient's own name and phone (`PatientsService.listItemsByIds`,
  backed by the same `listRowsByIds` resolution the Patients list uses for C7).
- **Panels (J2):**
  - **Guardian toggles.** "Also billing contact" and "Also emergency contact" start on for the first
    guardian and off once one is linked or pending: a second guardian is rarely also the payer or
    the first call. They go back to that default after each add. A new contact from "Add new
    contact" is added at once, since it carries its relationship. An existing contact or patient is
    staged first, so its relationship can be chosen (default Parent).
  - **Adults.** Every pick is staged with its relationship (default Other: nothing is presumed of
    an adult's contact) and the three role checkboxes, none pre-checked. Add waits for at least one
    role.
  - **Role editing.** Each row has Edit and Remove. Edit opens an inline "Roles of {name}" editor
    (relationship + roles, applied together, only what changed). On a saved link it also offers
    "Make primary" per held role, which applies at once. Pending rows can be edited too; removing a
    pending row needs no confirm, while unlinking a saved one does.
  - **Link offer.** The typed phone, once valid for the tenant country, is looked up by its E.164
    digits (`GET /contacts/lookup`, debounced) and matched exactly against unlinked contacts. It
    is never offered for a contact already pending on this patient, since a minor's phone is often
    a parent's. The link holds while the phone stays that number, however it is typed.
  - **Edit panel.** The adult disclosure opens by itself when the patient has contacts.
  - **Merge.** "Contacts — will be kept" ORs the roles and keeps the kept record's relationship.
    It sets apart a contact that is one of the two records, since the merge removes that
    self-link.

## Frontend

- **Contact picker** (`features/patients/contact-picker.tsx`): the search-or-create control. 36px
  search input ("Search a parent by name or phone…") → `GET /contacts/lookup` (debounced) →
  rows: avatar, name, Mono phone, "Patient P-000042" badge when linked; "Add new contact" reveals
  name*, phone*, relationship select. Emits a `ContactLinkInput` target.
- **Create panel**: the guardian and emergency text fields are gone. For a minor (DOB), a
  **Guardian block** appears above the optional fields: the picker, relationship, and two
  checked-by-default toggles "Also billing contact", "Also emergency contact"; an amber "No
  guardian recorded" note when none (never blocks). Phone loses its required mark for minors. For
  adults the same control sits in a collapsed "Contacts & family (optional)" disclosure. When the
  typed phone matches an unlinked contact, the panel offers "Link to {name}" (`linkContactId`).
  Pending links are sent with the create.
- **Edit panel**: the same blocks show current contacts; link/unlink/roles apply immediately
  through the C5 routes (toast + refetch), independent of Save.
- **Quick view**: a Contacts block — name · relationship · role pills (Guardian / Billing /
  Emergency) · Mono phone.
- **Merge panel**: "Contacts — will be kept" lists both records' contacts beneath the grid.
- **List**: minors with a primary guardian show the guardian's phone plus an 11.5px muted "via
  {first name}" line. **Palette**: a hit via a contact shows "via {contact name} ·
  {relationship}".
- **Record**: guardian chip after the alert chips for a minor (`#eceef8` bg, `#c3c7ea` border,
  11.5px, "Guardian · {name} · {phone}"). Overview's Patient information card replaces
  "Emergency" with a "Contacts" row (primary guardian / billing contact names or "Not
  recorded"). The Patient information tab gains a **Contacts & family card**: rows avatar · name
  · relationship · role pills · Mono phone · ⋯ (Edit roles, Remove, Open record when linked);
  **Add contact** opens a small right panel on the record page (picker + relationship + three role
  toggles). Completeness per C10.
- Dentist select, dentist filter chip, table names and export use profile ids.

## Testing

- **Contracts**: contact schemas (target union, roles ≥ 1, relationship enum), create input with
  contacts ≤ 10, phone optional in the schema, list item fields, practitioner/staff profile ids.
- **Domain (api)**: primary rules (first holder, reassignment, promotion on removal), merge contact
  plan (OR roles, primaries, self-link removal, linked-contact fold), completeness with guardian.
- **Integration**:
  - adult without phone → 422 `phone`; minor without phone and guardian → 201; DOB edit to adult
    without phone → 422;
  - create minor with a new guardian (+ billing, emergency) in one transaction (a failing link
    rolls the patient back);
  - child B offered the mother by phone (`lookup`), linking the same contact; both children list
    her; one contact row;
  - mother created as a patient with `linkContactId` → contact linked, own fields cleared,
    resolved from the patient;
  - husband (patient) as billing contact of his wife and children → `patientsBilledBy` returns all
    three;
  - primaries: partial unique indexes, reassignment, promotion on unlink;
  - search/palette by guardian phone digits → `matchedContact`; list `primaryGuardian`;
  - merge moves and deduplicates contacts, folds linked contacts, audit;
  - export guardian columns;
  - dentist by profile id: create/update/filter/sort/export;
  - events and audit for link/unlink/roles/contact edits;
  - front desk manages contacts; no `patient:write` → 403.
- **Isolation**: `contacts`, `patient_contacts` RLS; B's contact ids 404 on every contact route;
  lookup never returns B's rows.
- **Web**: picker (lookup, add new, patient badge), guardian block show/hide with DOB, toggles
  default on, amber note, adult disclosure, link offer on phone match, edit immediate actions,
  quick view block, merge "will be kept", list via line, palette via, guardian chip, contacts row,
  contacts card + add-contact panel, completeness.
- **Playwright** (replaces the base flow): create a minor with a new guardian and an opening
  balance → the list shows the "via" phone and the balance → open the record → guardian chip →
  edit address → completeness flips → ⌘K by the guardian's phone digits shows "via".

## Documentation

- ADR-0019 "Contacts are people, not fields; ledgers stay per patient; household views are
  aggregates over `is_billing_contact`".
- ADR-0020 "Domain models refer to dentists by staff profile id" (amends ADR-0016).
- `docs/modules/patients.md` (owned tables incl. `contacts`, `patient_contacts`; contact API,
  routes, events), `users.md` (profile ids), `billing.md` (export columns), CLAUDE.md §4 patients
  row and the new staff-reference rule, ADR index, base spec status "Amended by
  2026-09-28-patients-contacts-design.md".
