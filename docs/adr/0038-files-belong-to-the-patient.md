# ADR-0038: Files belong to the patient, with optional links to a visit and a tooth

- Status: Accepted
- Date: 2026-10-07
- Amends: CLAUDE.md §4 (the `files` row of the module map)

## Context

Feature 8 adds a patient's images and documents. A panoramic taken in today's visit, an intraoral
photo of tooth 36, a referral letter and an ID scan are all "files of the patient", but only some
of them have a visit or a tooth.

The module map gave `files` one dependency, `tenancy`, written when it was thought of as generic
attachment storage. The feature needs more: a file must name a real patient and, when linked, one
of that patient's visits; a list shows who uploaded it; "taken on" is read in the clinic's time
zone.

We considered:

- **Attachments owned by each module** (`clinical` stores visit images, `patients` stores
  documents). Two upload flows, two galleries, and a file that changes meaning (a photo later
  linked to a visit) would have to move between tables.
- **A generic attachment table** keyed by `(resource_type, resource_id)`. A file could then hang
  off a visit with no patient, and "all files of this patient" would be a union over resource
  types that `files` cannot resolve without reading other modules' tables.

## Decision

1. **A file belongs to a patient, always.** `files.patient_id` is required and fixed at upload;
   only a patient merge changes it.
2. **The visit and the tooth are optional links on the same row**: `visit_id` and `tooth_code`
   (one tooth). Neither is required and neither blocks anything: completing, amending or voiding a
   visit leaves its files as they are.
3. **`files` depends on `patients`, `clinical`, `users`, `tenancy` and `audit`**, and nothing
   depends on `files`:
   - `patients`: `lockForDependentWrite` at upload and Save (a merge waits, a merged-away patient
     is refused), and `PatientsMerged` handled in the merge transaction, as `clinical` and
     `billing` do, so the files are on the kept patient when the merge commits.
   - `clinical`: `VisitsService.refsFor`, a new read that answers a visit's patient, number, day,
     start and status. `files` checks the visit is the patient's and shows the visit beside the
     file.
   - `users`: display names of uploaders. `tenancy`: the time zone.
4. **No foreign keys to `patients` or `visits`**: those tables belong to other modules (§4 rule
   1), as for `ledger_entries`.
5. **The other modules' screens compose files in the SPA.** The record, the visit workspace and
   the tooth panel render components of `features/files` over one query; no backend module reads
   files.

## Consequences

- One upload flow, one gallery and one viewer serve every entry point; the context only pre-fills.
- A file tagged to several teeth is not possible; it was ruled out of scope.
- `clinical` gains one small public read. Its direction (`files` → `clinical`) adds no cycle.
- Files do not count as something a visit has put on the record: a live visit holding only
  files can still be discarded. Its files stay on the patient; the read then shows them with no
  visit, and the row keeps the id.
