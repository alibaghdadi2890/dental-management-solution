# ADR-0019: Contacts are people, not fields; ledgers stay per patient

- Status: Accepted
- Date: 2026-09-28
- Context: design addendum `docs/superpowers/specs/2026-09-28-patients-contacts-design.md` (C1–C12)

## Context

The first patients brief recorded a minor's guardian and an emergency contact as text fields on
the patient (`guardian_name`, `guardian_phone`, `emergency_contact`). The revised brief needs
more than that:

- the same mother is the guardian of three children, and staff should pick her rather than
  retype her;
- she may be a patient herself (or become one later), and her phone should then come from her
  record, not from copies on each child;
- a husband pays for his wife and children; the clinic calls him about their balances;
- search and the ⌘K palette should find a child by the guardian's phone ("via Mona · parent");
- features 5 (billing, invoices) and 6 (import: `guardian_phone`, `billing_contact_phone`)
  need to ask "who is this patient's billing contact?" and "whom does this contact pay for?".

Text fields cannot answer any of these without string matching across rows.

## Decision

- **Contacts are people.** `patients` owns `contacts` (tenant-owned, RLS, soft delete) and
  `patient_contacts` (a junction: relationship, three role flags — guardian, billing contact,
  emergency contact — and one primary per role per patient). A contact is someone known to the
  clinic; one row serves every patient it relates to.
- **A contact may be a patient.** `contacts.linked_patient_id` makes the contact _be_ that patient:
  its own name, phone and e-mail are cleared and read from the patient record (a check keeps a
  contact either linked or named; at most one live contact per patient). Editing such a contact
  means editing the patient (`PATCH /contacts/:id` → 409 `contact.linked`). A patient is never its
  own contact.
- **Ledgers stay per patient.** The billing contact is who you talk to and who pays, never whose
  account it is: every ledger entry, balance and invoice belongs to the patient who received the
  care (ADR-0017 unchanged). There is no household account.
- **Household views are aggregates** over `patient_contacts.is_billing_contact`, computed at read
  time: `ContactsService.patientsBilledBy(contactId)` lists the patients a contact pays for, and a
  household balance is the sum of those patients' balances, composed by `billing`.
- **Read API for other modules** (`patients/index.ts`): `ContactsService.contactsOf(patientId)`,
  `patientsBilledBy(contactId)`, `findContactsByPhone(phone)` (normalised with the tenant
  country), all `patient:read`; events `ContactLinked`, `ContactUnlinked`, `ContactUpdated`.
- Contacts stay in `patients`, not a module of their own: they have no meaning without the
  patients they relate to, every write locks a patient row first, and merge must move them in
  the patient merge's transaction.

## Alternatives considered

- **Guardian columns on `patients`** (the first brief): no reuse across siblings, no link to a
  patient record, no billing role, phone search by string matching; each import row would copy
  the same guardian again. Rejected.
- **Contacts owned by `billing`** (as "payers"): guardians and emergency contacts are not billing
  concepts, and `patients` would need to call `billing` for its own record screens, reversing the
  dependency (`billing` depends on `patients`, CLAUDE.md §4 rule 4). Rejected.
- **Household (family) accounts**: one ledger per family with members. Moving a patient between
  households, divorced parents paying for different children, and a clinic's per-patient
  statements all break the one-ledger model; per-patient ledgers plus an aggregate over billing
  contacts give the same household view without a second source of truth. Rejected.

## Consequences

- Feature 5 builds household statements and "owed by this contact" views as aggregates over
  `patientsBilledBy` and per-patient balances; invoices stay per patient, addressed to the
  primary billing contact when there is one.
- Feature 6 imports `guardian_name`, `guardian_phone`, `guardian_relationship` and
  `billing_contact_phone` by matching `findContactsByPhone` first and creating a contact
  otherwise, through `PatientsService.create`'s `contacts` (one transaction per patient).
- Merge moves contacts with the record (roles OR-ed, kept primaries win) and re-points or folds
  the contacts that are the merged patients, so a household keeps pointing at the surviving
  record.
- Every contact write follows one lock order (patients → contacts → links;
  `docs/modules/patients.md`), so concurrent edits of one family never deadlock.
