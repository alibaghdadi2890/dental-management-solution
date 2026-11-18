# Possible families on the Patients list (families B)

Patients module. ADR-0093. Migration `0061_family_dismissals`. Third of three pieces on families (A:
`2026-11-18-phone-contact-suggestion-design.md`, C: `2026-11-18-billing-contacts-design.md`).

## The gap

Existing patients who belong together are never pointed out: only exact name + date-of-birth twins
are (duplicates). Linking a family means opening each child and adding the parent by hand.

## Decisions (user, 2026-11-18)

- **F1 What a possible family is.** People: active patients with a phone, and live contacts who
  are no patient with a phone. Their **phone key** is the digits of the stored phone (the first
  word of `phone_search`: the E.164 digits of a valid number, the typed digits of any other). A
  possible family is the people sharing one key — at least two, at least one a patient — who are
  **not already one family**: every one of them connected to the others through contact links
  (a patient and the contact they link; a patient and their own linked contact are one person;
  links through anyone outside the group count). **A shared family name alone never makes one.**
- **F2 Family name.** The last word of each name key. `sameFamilyName` when all the group's people
  share it: the card says so, and such groups come first, then larger groups, then by key.
- **F3 Not a family.** Saved for the whole clinic in `family_dismissals`: one row per phone key
  with the people (patient and contact ids) it was answered for. The group stays hidden while
  every person in it is among them; a new person with that phone brings it back. Answering again
  replaces the row. `patient:write`; audited `contact.family_dismiss` (resource `family_dismissal`).
- **F4 Link family.** `POST /patients/families/link` (`patient:write`):
  `{ payer: { patientId } | { contactId } | { newContact: { fullName, phone } }, members: { patientId, relationship, isGuardian, isBillingContact }[] }`
  (1–20 members, each with a role; the payer patient is never a member). One transaction: the
  member patients and a payer patient locked `FOR UPDATE` in one statement (the lock order's level
  1), a new contact created first, then each member linked to the payer exactly as
  `POST /patients/:id/contacts` (the same checks, audit `contact.link`, `ContactLinked`; errors at
  `members.<i>…`). A member already linked to the payer gets the ticked roles added
  (`contact.roles`). A billing link becomes the member's primary billing contact, so Outstanding and
  the dashboard group the family. Answers `{ linked }` (the number of members changed).
- **F5 `GET /patients/families`** (`patient:read`) → `FamilySuggestion[]`:
  `{ phoneKey, phone, sameFamilyName, patients: { id, fullName, displayNumber, dateOfBirth, contactIds, selfContactId }[], contacts: { id, fullName }[] }`.
  `contactIds` are the contacts each patient links; `selfContactId` the contact that is them. The
  list's length is the strip's count.
- **F6 The review strip** replaces the duplicates banner over the active list: one strip with
  "N possible duplicates [Review & merge]" (amber) and "M possible families [Review & link]"
  (indigo), each half shown while its count is above zero, its button with `patient:write`.
- **F7 The review panel** (`?panel=families`): a right panel "Possible families", one card at a
  time ("1 of M"):
  - the reason: "Share {phone}" and, when true, "· same family name";
  - **Who pays / is guardian**: each adult patient (or one without a date of birth), each contact,
    or **Someone else** (name; the shared phone). Default: the first contact, else the oldest
    adult, else Someone else;
  - **each other patient**: Include (on), the payer's relationship to them (`parent` for a minor,
    else `other`), **Guardian** (on for a minor) and **Billing contact** (on); one already linked
    to the payer shows "Already linked" and is left out;
  - **Link family** (primary), **Not a family**, **Skip**. After Link or Not a family the list
    reloads and the next card shows; nothing left: "No possible families left".

## Copy (en; ar and fr alongside)

Under `patients:families`: `strip` "{{count}} possible families" (plural), `review` "Review &
link", `title` "Possible families", `progress` "{{index}} of {{count}}", `share` "Share {{phone}}",
`sameName` "same family name", `payer` "Who pays / is guardian", `someoneElse` "Someone else",
`name` "Name", `members` "Family members", `include` "Include {{name}}", `relationship`
"{{payer}} is their", `alreadyLinked` "Already linked", `link` "Link family", `dismiss` "Not a
family", `skip` "Skip", `linked` "Family linked", `dismissed` "Marked as not a family", `done` "No
possible families left", `minor` "Minor".

## Tests

- Unit (`domain/family-suggestions.ts`): grouping by key, a patient and contact together, already
  one family (direct, through an outside contact, through a patient's own contact), dismissed and
  brought back by a new person, family name and order.
- Integration: the list, Link family (payer patient, existing contact, new contact; primary billing;
  an already-linked member widened), Not a family; tenant isolation (another clinic's people never
  group, their ids are 422/404).
- SPA: the strip's two halves and permissions; the panel's defaults, Link family's request, Not a
  family, Skip.

## Docs

`docs/modules/patients.md`, `CLAUDE.md` (patients owns `family_dismissals`), ADR-0093.
