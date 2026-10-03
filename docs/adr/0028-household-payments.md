# ADR-0028: Household payments are one row per account under one receipt

- Status: Accepted
- Date: 2026-10-02

## Context

A parent often pays for several children at once. Contacts already model billing contacts
(ADR-0019), and `patients.patientsBilledBy(contactId)` lists the patients a contact pays for.
Ledgers stay per patient, so one payment cannot sit on several accounts.

## Decision

- The payer defaults to the patient's primary billing contact (none = the patient pays); the
  panel can pick another billing contact or the patient.
- **Household** = the patient, the payer's own patient record when the payer is a patient, and
  every non-archived patient the payer is the billing contact for.
- A household payment is split across those accounts by the normal allocation order (the context
  visit first, then oldest charge first across all of them) and recorded as **one `payments` row
  per account** that received money. The rows share one receipt number and a
  `household_group_id`.
- The receipt lists each patient's part and what it covered.
- A void cancels every row of the receipt (it is a mis-entry). A refund is per row: money goes
  back from one patient's account at a time.
- The cap is the sum of what the household's accounts owe.

## Consequences

- Each account's ledger, balance and allocations stay self-contained; the household is a view.
- Receipt numbers are shared by a household's rows, so the receipt index is not unique (the
  counter keeps numbers unique); a merge may then bring two rows of one receipt onto one patient.
- Refunding a whole household payment takes one refund per patient row.
