# The phone suggests a contact, at any age, in create and edit (families A)

Patients module (SPA and the contact lookup). No migration, no ADR: the boundary does not change.
Changes design addendum `2026-09-28-patients-contacts-design.md` C4 "Link offer". First of three
pieces on families. B (family alerts on the Patients list) and C (billing contacts: search, family
panel, Register as patient, family balances on the dashboard) get their own specs.

## The bug (why it "works sometimes")

`useLinkOffer` (`apps/web/src/features/patients/panels/use-link-offer.ts`) is silent when:

1. **Editing:** it is off outside create (`useLinkOffer(form, !editing)`).
2. **No date of birth, or an adult:** the guardian offer needs the date of birth to make the patient
   a minor. An adult is only asked "Is this patient {name}?", and only for a contact who is no
   patient. A phone that belongs to a patient gets no offer.
3. **The phone is on a minor's record:** a sibling registered with the parent's phone is filtered
   out (a minor is never a guardian), and that sibling's guardian is not looked at.
4. **The same number stored differently:** the hit must equal the typed phone exactly as stored
   (`phoneOf(item) === e164`). A number that is not valid for the country is stored as typed, so
   `03-123 456` and `03 123 456` never match.

## Decisions (user, 2026-11-18)

- **P1 Any age.** The date of birth no longer decides whether there is an offer. An elderly
  patient's son, or a husband and wife, share a phone as often as a parent and a child.
- **P2 Create and edit.** The offer runs in both panels. In edit it starts once the phone differs
  from the saved one (the user typed a phone). A patient whose phone is already shared with someone
  they are not linked to is B's job (the Patients list strip), not the edit panel's.
- **P3 Who is offered.** The hits of `GET /contacts/lookup` whose phone is the typed one by
  `samePhone` (P6), minus the patient itself, anyone already linked or pending, and anyone answered
  "Not now" in this panel:
  - a contact, or an adult patient, or a patient without a date of birth: that person;
  - a minor patient: their `familyContact` (P5) instead, when there is one and it is not excluded
    by the same rules; otherwise nobody.
  - One at a time: contacts first, then patients, in lookup order. After Not now the next one.
- **P4 The prompt** (one `LinkOffer` box, under the phone as today):
  - The person: "**{name}** uses this phone." Through a sibling: "This phone is on
    **{sibling}**'s record. Their {guardian | billing contact} is **{name}**."
  - **Add as contact** (primary): stages the person in the contacts section through
    `ContactLinker`'s `request`. A minor patient: the Guardian block, as today (relationship
    `parent`, the toggles' usual defaults). Anyone else: "Contacts & family", which opens if it is
    collapsed, staged with relationship `other` to pick and **Billing contact** ticked
    (`stagedDefaults`; an emergency contact on the patient's own phone is no use). The person picks
    the relationship and presses Add as in the picker. In edit, Add links at once through the API,
    as the picker does there.
  - **This is {name}**: only in create, only when the patient is not a minor and the person is a
    contact who is no patient (the old "Yes, same person": sets `linkContactId`, the "Will link to"
    chip).
  - **Not now**: not offered again in this panel.
  - While another contact is being added, Add is held back with the existing "Finish or cancel the
    contact you're adding first."
- **P5 Lookup: `familyContact`.** A `patient` item of `contactLookupItemSchema` gains
  `familyContact: { role: 'guardian' | 'billing', contact: ContactView } | null`: the patient's
  primary guardian, else their primary billing contact, resolved (the role words the prompt). Read with the lookup's patient half, in the same transaction (at most 10
  patients). The picker ignores it.
- **P6 `samePhone(a, b, country)`** in `@dcm/contracts` `phone.ts`: both through `storedPhone`, then
  `phoneDigits` of the values compared; either blank → false. Used for the match in P3.

## Copy (en; ar and fr alongside)

`contacts.linkOffer`:

- `uses`: "{{name}} uses this phone."
- `viaSibling`: "This phone is on {{sibling}}'s record. Their guardian is {{name}}."
- `viaSiblingBilling`: "This phone is on {{sibling}}'s record. Their billing contact is {{name}}."
- `addContact`: "Add as contact"; `same`: "This is {{name}}"; `notNow`: "Not now" (kept).
- Removed: `identity`, `different`, `guardian`, `addGuardian`.

## Tests (failing first, CLAUDE.md §14)

- `use-link-offer.spec`: a phone matching an adult patient with no date of birth on the form →
  offer; the edit panel, phone changed → offer, phone unchanged → none; the patient's own record
  (and its linked contact) never offered; a minor sibling holding the phone → their
  `familyContact`, a minor without one → none; a hit stored as `03-123 456` matches a typed
  `03 123 456` (an invalid number for the tenant).
- `phone.spec` (contracts): `samePhone`, valid and invalid numbers, blanks.
- `patient-form-panel.spec`: Add as contact stages an adult's contact in Contacts & family with
  Billing ticked; This is {name} only in create.
- Contacts integration spec: the lookup's patient items carry `familyContact` (guardian before
  billing; null without either).

## Docs

`docs/modules/patients.md`: the lookup's `familyContact`; `samePhone`; the SPA's offer (P1–P4).
