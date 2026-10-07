# ADR-0037: The audit log records what a row is about; the Activity screen reads it

- Status: Accepted
- Date: 2026-10-06
- Amends: CLAUDE.md §10 (three more fields), §12 (the routes that take an `Idempotency-Key`)

## Context

Feature 7 (H7) gives owners and dentists an Activity screen over the audit log: who did what, as
sentences ("Voided visit V-000045"), filtered by area, person, date and record.

The log could not answer that. A row names its resource by type and id, and most rows carry only
ids: of ten `visit.*` actions only `visit.start` holds the visit's patient, and a cancelled plan's
row holds neither its patient nor its visit. "Everything about this patient" could not be asked,
and a payment appeared four times (its row, its ledger entry's row, and two stored events).

`audit` depends on no module (every module depends on it), so it cannot look anything up.

We considered:

- **A new read module** that joins the log with patients, visits and payments. It would depend on
  nearly every module to translate ids the writers already hold when they write.
- **Storing display labels on each row** (a patient's name, a visit number). Every one of some
  seventy call sites would build a label, and old rows would have none.

## Decision

1. **`audit_log` gains `patient_id`, `visit_id` and `area`** (all nullable, no foreign keys).
2. **Writers say what a row is about, mostly once.** `AuditService.about({ patientId, visitId },
work)` marks everything recorded inside `work`; a service calls it where it locks the visit or
   the patient. A `record()` may still name its own. Without either, the row's resource (when it
   is a patient or a visit) or the `patientId` / `visitId` in its snapshots is used.
3. **`area` is derived from the action's first segment** by a pure function in `contracts`
   (`areaOfAction`): Patients, Visits, Payments, Catalog, Users, Settings, Contacts.
4. **The feed shows one row per thing a person did.** A row without an area is in the log but not
   on the screen: stored domain events (their names have no `resource.verb` shape) and the ledger
   entries that only shadow a payment or a visit change (`hidden`).
5. **`GET /audit` gains the feed's filters**: `feed`, `area`, `actorUserId`, `platformAdmin`,
   `from`, `patientId`, `visitId`. The two existing timelines keep reading by resource.
6. **Sentences are built in the SPA** from the action, the snapshots and names looked up per page
   of rows: staff from the staff list, patients from `GET /patients/names`, visit numbers from
   `GET /visits/numbers`. An action nobody wrote a sentence for reads as its code made readable.
7. **Old rows are backfilled once**, by the migration (0035), from their resource, their
   snapshots and the records they point at. The runtime roles still cannot update the log.

## Consequences

- `audit` stays dependency-free and still knows no table but its own. The vocabulary (areas, the
  action prefixes) is a constant in `contracts`, documented in `docs/modules/audit.md`.
- The log records ids, as before: names are resolved when it is read, so a renamed patient reads
  by their current name. The snapshots still hold what was true at the time.
- A new action gets an area by its prefix, or none; a new prefix is added to the constant, and a
  sentence to the three locale files. A spec lists the actions the API emits and fails when one
  has no sentence.
- A search is resolved by the SPA through the lists it already has (a patient, visit or receipt
  number, or a name) and then narrows the feed to that record. The feed has no text search.
- `AuditService.about` uses its own `AsyncLocalStorage`, not the request context: it is scoped to
  the work, not to the request.

### Routes that take an `Idempotency-Key` (CLAUDE.md §12)

Feature 7 (H5) adds three to `POST /billing/payments`: `POST /patients`,
`POST /billing/opening-balances` and `POST /billing/patients/:id/adjustments`. The key and a
SHA-256 of the validated request are stored on the row the request creates (`patients`,
`ledger_entries`), as payments store theirs. The same key with the same request answers with the
first result, re-read; with another request, 409 `…idempotency_mismatch`. Requests sharing a key
run one at a time (an advisory lock). No shared table was added: `platform/` owns none.
