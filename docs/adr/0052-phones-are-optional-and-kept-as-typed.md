# ADR-0052: A phone is optional and kept as typed; the record says what is missing

- Status: Accepted (supersedes the phone rule of the patients design addendum C3 and the
  completeness of C10; amends the payment methods of ADR-0027)
- Date: 2026-10-17

## Context

The first clinic to migrate (a spreadsheet of ~460 patients) has adults with no phone, no date of
birth or no sex recorded, and numbers the phone library rejects: foreign numbers typed without
`+`, Lebanese numbers with a digit too many. The phone rule (C3: required unless the patient is a
minor; no date of birth = adult) and the strict format check would refuse those records, at import
and later at every edit. The clinic wants them in as they are, marked as incomplete instead.

The record's completeness badge (C10) asked for an email and an address, which the clinic does
not consider important; it does consider the date of birth, the sex and a way to reach someone
important. The clinic also takes payments through Whish Money.

## Decision

1. **No phone rule.** Any patient may be saved without a phone, an adult or one with no date of
   birth included, on create, edit and merge. There never was a database constraint; the rule was
   in `PatientsService`, the SPA's form and the merge panel, and is removed from all three.
2. **Any format.** A phone is stored by `storedPhone` (`@dcm/contracts`): E.164 when it is a valid
   number for the country it resolves to (the tenant's, or the one after a leading `+`), otherwise
   the text as typed, spaces collapsed. `phone_search` holds the E.164 and national digits of a
   valid number, the typed digits of any other. The same applies to contacts; a new contact still
   needs a phone (blank → 422 `required`). There is no `invalid_phone` error any more. Display
   formats a valid number nationally or internationally and shows any other as stored.
   `normalizePhone` stays the strict parse, for matching a typed number to a contact.
3. **Missing information** replaces completeness: `missingInformation` (`@dcm/contracts`) lists
   what the record lacks of the important fields — the date of birth, a sex other than `unknown`,
   and the patient's phone, which a guardian or billing contact stands in for. It is derived, never
   stored and never blocks a save. The Patient information tab's badge reads "Complete" or
   "Missing: …", and the Overview's Needs attention lists a **Missing information** row (last),
   whose **Complete details** opens the Patient information tab for those with `patient:write`.
4. **Whish** is a payment method (`whish`, migration 0047), between bank transfer and insurance.

## Consequences

- A clinic can no longer rely on every adult having a number to call or message. Reminders
  (`notifications`) must skip a patient with no phone and no guardian or billing contact, and a
  number kept as typed may not be dialable.
- The duplicate check and the guardian lookup match a number kept as typed only by the same text
  or by its digits.
