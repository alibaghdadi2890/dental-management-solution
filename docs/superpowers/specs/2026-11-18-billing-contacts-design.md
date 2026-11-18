# Finding a billing contact and the family's balance (families C)

Patients (search, a contact read, the contact panel), billing (the dashboard's largest balances by
family). No migration, no ADR: no boundary or dependency edge changes. Second of three pieces on
families (A: `2026-11-18-phone-contact-suggestion-design.md`; B, family alerts, follows).

## The gaps

- No search matches a contact by name: `GET /patients` `q`, ⌘K and the Payments search match a
  contact's phone only (design addendum C7). A billing contact who is no patient can't be found.
- A family's total shows only as a card on one member's Balance tab (`family-card.tsx`).
- The dashboard's Largest balances (`BillingSummaryService.receivables`) is per patient.
- A contact can become a patient only by typing their phone into a new patient (A's This is…).

## Decisions (user, 2026-11-18)

- **C1 Search by contact name.** `q` on the patients search also matches a patient whose live
  contact's resolved name key contains `q`'s name key, as it already does for the contact's phone
  digits (`patient-search.sql.ts`: one uncorrelated subquery for both). `matchedContact` (the
  "via" line) is set for a row matched only through a contact, by name or phone. A patient-number
  query still matches numbers only. The Payments screen's search (`patientIdsMatching`) follows.
- **C2 `GET /contacts/:id`** (`patient:read`) → `ContactDetail`
  `{ contact: ContactView, patients: { patient: { id, fullName, displayNumber, archived }, relationship, isGuardian, isBillingContact, isEmergencyContact }[] }`:
  the contact, resolved, and every patient who links them, by name. Unknown or deleted → 404
  `contact.not_found`. `ContactsService.detail`.
- **C3 The contact panel** (`features/patients/contact-panel.tsx`): a slide-over from the inline
  end (Radix dialog, 440px), mounted once in the app shell (`ContactPanelProvider`), opened with
  `useOpenContact()(contactId)` from anywhere. It shows:
  - the name, the phone (left to right) and e-mail, and "Patient P-…" with **Open record** for a
    contact who is a patient; **Register as patient** (C4) for one who is not (`patient:write`);
  - **Linked patients**: each with its relationship and role pills, the name opening the record;
  - **Family balance** with `payment:read`, when they are anyone's billing contact: the family
    card's content (members and balances, total, Record family payment, Family statement),
    shown from one member on (the Balance tab's card still needs two).
- **C4 Register as patient.** From the contact panel and the Contacts & family card's ⋯ menu (a
  contact who is no patient). Opens the New patient panel prefilled with the contact's name, phone
  and e-mail and `linkContactId` set, shown as the "Will link to {name}" chip. That chip is pinned:
  a changed phone or date of birth does not drop it (the person chose this contact); its × does.
  Every link the contact has stays (`linkToPatient`).
- **C5 ⌘K Contacts group.** While searching, the palette also asks `GET /contacts/lookup` and lists
  up to 3 contacts who are no patient under the patients, headed "Contacts": name, phone,
  "Contact". ↑/↓ move across both groups; Enter or a click opens the contact panel. "Create …"
  shows only when neither group found anyone.
- **C6 Payments.** Outstanding grouped by payer: the family's name opens the contact panel.
- **C7 Dashboard: Largest balances by family.** `receivables()` groups the owing patients by family
  with Outstanding's rule (a patient's primary billing contact; a payer who is a patient joins the
  family they pay for unless someone else bills them), moved to `billing/domain/families.ts` and
  used by both. A `largest` item gains `payer: Payer | null` and `members` (owing members, ≥ 1);
  `patientId`/`fullName`/`displayNumber` are the family's first member (the patient, when alone).
  A row of a family of two or more reads "{payer} · {n} patients" and opens the contact panel;
  any other row is the patient and opens their record, as today.

## Copy (en; ar and fr alongside)

- `patients:contactPanel`: `eyebrow` "Contact", `patient` "Patient {{number}}", `openRecord`
  "Open record", `register` "Register as patient", `linked` "Linked patients", `none` "Not linked
  to any patient", `money` "Family balance", `failed` "Couldn’t load the contact."
- `patients:palette`: `contacts` "Contacts", `contact` "Contact".
- `patients:contacts.card`: `openContact` "Open contact", `register` "Register as patient".
- `dashboards`: `familyMembers` "{{count}} patients" (plural forms).

## Tests

- Integration (contacts): `q` by a contact's name finds the patient with `matchedContact`;
  `GET /contacts/:id` (links, roles, 404). Tenant isolation: another clinic's contact is a 404.
- Integration (dashboards): `largest` groups two children under their billing contact.
- Unit: `families.ts` (billing contact, payer who is a patient, payer billed by someone else).
- SPA: the palette's Contacts group (keys, Enter opens the panel, Create only when both empty);
  the contact panel (Register prefill and the pinned chip, money gated by `payment:read`); the
  dashboard's family row.

## Docs

`docs/modules/patients.md` (search, `GET /contacts/:id`, the contact panel, Register as patient),
`docs/modules/billing.md` (receivables by family, `families.ts`), `docs/modules/dashboards.md`.
