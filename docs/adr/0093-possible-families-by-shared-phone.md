# ADR-0093: Possible families by a shared phone

- Status: Accepted
- Date: 2026-11-18

## Context

Clinics register children with a parent's phone, spouses and an elderly patient's son share one,
and nobody links them: the family's balance never adds up (Outstanding by payer, the dashboard).
The owner asked for alerts like the duplicates banner, and that a family name alone must never
raise one: whole villages share a family name.

## Decision

1. A possible family is two or more people — active patients and contacts who are no patient,
   at least one a patient — whose stored phones have the same digits (the first word of
   `phone_search`), and who are not already connected through contact links. A shared last name
   only orders the list and says "same family name".
2. It is derived on every read (`GET /patients/families`), never stored. Patients per clinic are
   bounded (ADR-0018), and only shared phone keys are read.
3. "Not a family" is the one stored fact: `family_dismissals`, one row per phone key with the
   people it was answered for, tenant RLS. A new person with that phone brings the group back.
4. Linking a family is one transaction over the existing link rules (lock order, audit, events);
   a billing link becomes the member's primary billing contact.

## Consequences

- No module boundary changes: `patients` owns the contacts, the links and the new table.
- Two people sharing a phone who are not related are asked about once; the answer is kept for the
  clinic.
