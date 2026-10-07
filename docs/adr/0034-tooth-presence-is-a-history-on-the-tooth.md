# ADR-0034: Tooth presence is a history on the tooth; the succession override is retired

- Status: Accepted
- Date: 2026-10-06

## Context

The chart could not say that a tooth is not there. A patient with four wisdom teeth out, an
implant at 36, or a tooth lost in an accident was drawn with 32 healthy teeth.

Feature 4a had a narrower mechanism: `tooth_status` said, per succession position (a permanent
code at position 1–5), whether the primary tooth or its permanent successor was present. The
two-chart toggle (a patient is on the primary or the permanent chart) made it obsolete, and the SPA
stopped using it; the table, its route and its event stayed in the API.

Feature 7 (H1–H3) needs four states per tooth position — present, missing, not erupted, implant
— recorded like a diagnosis (a date, an author, an optional reason, a history), set in a visit or
on the patient record, and changed by the services that extract a tooth or place an implant.

We considered:

- **A state row per tooth** (`tooth_status` widened to four values, upserted). Simple to read,
  but an overwrite loses the history the decision asks for, and "removing the extraction restores
  the previous presence" needs the previous value kept somewhere.
- **Deriving presence from the services** (an extraction in the history means missing). It can't
  express a tooth lost elsewhere or before the first visit, and a later manual correction would
  have nowhere to live.

## Decision

1. **`tooth_presences` holds one row each time a presence is set**, by a person or by a service:
   the tooth (any of the 52 FDI codes), the presence, `occurred_on`, an optional reason, the
   dentist, the visit when there is one, and the visit service that caused it when one did. Rows
   are never overwritten.
2. **A tooth's presence is its latest live row**, by a sequence column; a tooth without a row is
   `present`. The row recorded last wins whatever its date: recording "missing since 2019" today
   states what is in the mouth now.
3. **Taking a presence back soft-deletes its row**, and the row before it applies again. That is
   one rule for the toast's Undo, removing the service that caused it, marking that service not
   finished, an amendment that removes or moves it, and a void. A later change made by hand is
   untouched by any of them.
4. **Setting by hand a presence the tooth already has writes nothing. A service always writes its
   own row.** An extraction on a gap and re-work on an implant are allowed and leave the chart as
   it is, but each such service has a row, so the tooth stays in that state for as long as any of
   them stands, whichever is removed, amended away or voided first.
5. **`occurred_on` is the visit's local date, or what was entered on the patient record; null
   means "before first visit".** A date that is not known is not invented (H3a).
6. **A catalog service says what it does to the tooth**: `procedures.tooth_effect` is `none`,
   `removes` or `implant`, and only a per-tooth service may have one. It is read from the catalog
   when the service is recorded or a plan is performed. The presence row names the service, which
   is all a restore needs, so nothing is snapshotted on the visit service.
7. **Every state stays chartable.** Nothing is refused on a missing, not-erupted or implant
   position: implants, pontics and crowns are charted on them, and a diagnosis may be recorded on
   an implant.
8. **A void restores what the visit's services did, not what the dentist set by hand in it.** A
   presence set by hand is an observation and stays, like the visit's other records.
9. **The succession override is removed**: the `tooth_status` table and its enum, the
   `PUT /visits/:id/teeth/:position` route, `setToothPresence`, `ToothStatusChanged`, the contract
   schemas and `SUCCESSION_POSITIONS`. The patient's chart toggle
   (`patients.dentition_override`) is a different thing and stays.

## Consequences

- The chart reads every presence row of the patient (bounded, like its other records) and derives
  the per-tooth state in `deriveChart`, the same function in the API and the SPA. A tooth that is
  not present always has an entry, even with nothing else recorded on it.
- A merge moves every row to the kept patient. They are history, so none is dropped; the row
  recorded last on a tooth, whichever record it came from, is that tooth's presence.
- A presence set in a visit is visit content: the visit cannot be discarded.
- Two writers on the same tooth at the same moment (one in a visit, one on the patient record)
  can each add a row. Both are true statements and the later one wins; no lock was added for it.
- `service_id` has no foreign key: `visit_services` has no tenant-scoped unique key to point at. A
  check keeps it inside a visit.
- The Overview's "Missing teeth · Implants" counts the teeth of the chart the patient is on, so an
  adult's long-gone primary molar is not counted as a missing tooth.
- Migrations 0036 and 0037 are split because drizzle-kit asks about renames when a table or enum
  is created and another dropped in one diff; 0036 creates, 0037 drops.
