# ADR-0070: Quick patients and incomplete registration

- Status: Accepted
- Date: 2026-10-30

## Context

A phone booking is for someone not yet registered. The patient has one `fullName`, and the duplicate
check needed a date of birth.

## Decision

1. `POST /patients` takes `registrationIncomplete`; true requires a phone. The panel's first and last
   name are joined into `fullName`.
2. The duplicate check is additive: without a date of birth it matches the same name or the same phone,
   shows the matches inline and never blocks.
3. The flag clears in the same transaction as a save that leaves nothing important missing
   (`missingInformation`). Only the patient's own phone counts here.
4. Incomplete patients show a chip on the card, popover, board and record header.

## Consequences

- `PatientsService.refs` gives the calendar names without `patient:read`: anyone with
  `appointment:read` sees every column (A4), and a custom role may not hold `patient:read`.
