# ADR-0023: Live-visit concurrency, rooms and discard

- Status: Accepted
- Date: 2026-09-30

## Context

Feature 4a (`docs/superpowers/specs/2026-09-29-visit-workspace-design.md`) lets a dentist or an
assistant start a visit from a patient's record. Two invariants hold while a visit is live
(`in_progress` or `paused`):

- **one live visit per patient**: starting again resumes the one that is open (V4);
- **one live visit per room**: two patients can't be in the same room at once (V4).

Both are races. Two people may press _Start_ for the same patient in the same second, or put two
patients in one room. The brief's V4 enforced them by locking the patient and the room rows.
Those rows belong to `patients` and `tenancy`, and CLAUDE.md §4 rule 1 forbids a module from
reading or writing another module's tables, `SELECT … FOR UPDATE` included.

Other decisions from the same design are settled here too:

- which rooms a visit needs, since some clinics have none (W7);
- what happens to a visit started by mistake (W4);
- how visit start and patient merge avoid deadlocking (W22, W24).

## Decision

**The invariants are enforced on `clinical`'s own `visits` table (W1).**

- **Room:** a partial unique index.

  ```sql
  create unique index visits_room_live_unique on visits (tenant_id, room_id)
    where status in ('in_progress', 'paused') and room_id is not null;
  ```

  `VisitsService.start` inserts and maps the unique violation to 409 `visit.room_busy`. A
  concurrent insert for the same room waits on the index entry and then fails, so there is no
  "check then insert" window. A visit frees its room by leaving the live statuses (completed or
  discarded).

- **Patient:** `start` takes a transaction-level advisory lock, then looks for the patient's
  live visit and returns it with `resumed: true` when there is one.

  ```sql
  select pg_advisory_xact_lock(hashtextextended('visit-start:' || :patient_id, 0));
  ```

  The lock is held until the transaction ends, so a second start waits, then sees the first
  one's committed visit and resumes it.
  - Patient ids are uuids, unique across tenants, so the key needs no tenant part.
  - The `visit-start:` prefix keeps the key apart from any other use of advisory locks. There
    is none today.
  - A 64-bit hash collision would only serialise two unrelated starts. It never merges them.

- **Why not a unique index for the patient as well:** the merge exception below needs two live
  visits on one patient to be legal.
- **Why not `FOR UPDATE` on the patient or room row:** those are other modules' tables (rule 1).
  `PatientsService.lockForDependentWrite` is the patient's own public API for this. It reads
  the patient `FOR SHARE`, and two starts both hold that at once, so it can't serialise them.

**Lock order: patient, then visit (W22, W24).**

- `start` (and `complete`, feature 4a step 5) first calls `PatientsService.lockForDependentWrite`
  (renamed from `lockForLedger`, W22). That holds the patient `FOR SHARE`, so a concurrent merge,
  which locks both patients `FOR UPDATE`, waits for the start to commit. Then `start` takes the
  advisory lock and only then touches `visits`.
- A merge takes the patients first and then re-points `visits` in its own transaction. Both
  paths lock in the same order, so they can't deadlock.
- Every other lifecycle mutation (pause, resume, notes, discount, discard) locks only the visit
  row `FOR UPDATE`. None of them touches the patient, so no cycle exists.
- `lockForDependentWrite` refuses a merged-away patient (409 `patient.merged`) and allows an
  archived one (a ledger write-off). `start` itself also refuses an archived patient (409
  `patient.archived`).

**Merge exception.** After a merge, the kept patient can have two live visits: its own and the
one re-pointed from the dropped patient. Both stay usable and both complete normally.
`findLiveForPatient` resumes the oldest one, and the live-visit pill lists both. Refusing the
merge, or discarding one of the visits, would lose clinical work.

**Rooms are optional when the branch has none (W7).**

- When the session's branch has at least one active room, a visit must name one of them
  (422 `visit.room_required`; an inactive or foreign room gives 422 `visit.room_invalid`).
- A branch without rooms starts visits with `room_id` null, and the one-per-room rule doesn't
  apply. The partial index skips null rooms.
- Rooms stay in `tenancy` (ADR-0007), and `clinical` reads them through
  `TenancyService.listRooms`.

**Discard (W4).**

- A live visit can be discarded only while it is empty:
  - no services that aren't removed;
  - no diagnosis or plan recorded in it that isn't removed;
  - no diagnosis resolved in it, and no plan performed or cancelled in it;
  - no `tooth_status` row changed in it;
  - blank notes.
- A visit-level discount alone doesn't block a discard. The rule is `domain/discard-rule.ts`,
  and the facts come from one query of `exists` subqueries, each filtered on the visit's
  patient so it uses that table's `(tenant_id, patient_id, …)` index. Otherwise the answer is
  409 `visit.not_empty`.
- Discarding sets `status = 'discarded'`, `discarded_at` and `discarded_by` (the auth user id,
  W10), and clears `paused_at`. The room is then free.
- The change is audited (`visit.discard`) and emits `VisitDiscarded`.
- A discarded visit appears in no history, and `GET /visits/:id` answers 404. A mutation on it
  answers 409 `visit.not_live`.
- The dentist and the room of a live visit can't be changed. A wrong start is discarded and
  started again.

## Consequences

- The invariants hold under concurrency without `clinical` touching another module's rows. The
  integration suite starts one patient six times in parallel and expects one visit.
- The one-per-patient rule is enforced by the code path, not by a constraint. A future write
  path that inserts visits must take the same advisory lock first. `start` is the only insert
  today.
- A start holds the patient `FOR SHARE` for its short transaction, so a merge of that patient
  waits a moment. That is the price of the W24 guarantee that a visit's `patient_id` is always a
  live patient.
- Clinics without rooms work with no setup. Once a branch has a room, every start in it must
  choose one.
