# ADR-0017: Opening balances and balance-aware patient views live in `billing`

- Status: Accepted
- Date: 2026-09-27
- Amends: ADR-0008, ADR-0010 (platform-admin authority applies only in the admin's own request)

## Context

Feature 3 (Patients) needs money before invoices and payments exist:

- a patient carried over from a previous system starts with an opening balance, entered in the
  create panel;
- the Patients list has an _Owes balance_ tab, a sort by balance, and a Balance column in the
  CSV export.

CLAUDE.md §4 gives money to `billing` (`billing → patients`). `patients` owns the list, its
filters, its sorts and its paging (ADR-0018), but it may not read `billing`'s tables (rule 1),
and importing `billing` would create a cycle (rule 4). A merge of two patients must also carry
the dropped record's balance over to the kept one.

We considered:

- **`patients` imports `billing`** to read balances inside `search`. That is a cycle
  (`billing` already imports `patients` for existence checks), and it puts money into the module
  that should not know about it.
- **The SPA makes two calls**: the patient page from `patients`, the balances from `billing`,
  merged in the browser. That works for the Balance column of one page, but not for "only the
  patients who owe" or "sort by balance": the filter and the order have to be applied before the
  page is cut, over every patient, and the total has to be right.
- **An event-driven opening balance**: `PatientCreated` carries the amount and `billing` records
  it in a handler. The patient and its balance would then commit separately (a failure leaves a
  patient without the balance the user typed), and an event would carry a business input, not a
  fact.

## Decision

1. **The ledger is in `billing`.** `ledger_entries` holds signed amounts (positive = the patient
   owes) in the tenant currency of the moment; a balance is Σ amount per currency (design Q13).
   `patient_id` has no foreign key: `patients` owns that table.
2. **`billing` orchestrates create-with-opening-balance.** `POST /billing/opening-balances` calls
   `PatientsService.create` and records the `opening_balance` entry in one `TenantDb`
   transaction (the `users.createStaffUser` pattern). The SPA uses it only when an amount is
   entered.
3. **`billing` composes the patient views that need a balance**, on top of
   `PatientsService.search` and its internal options, which HTTP never reaches:
   - `GET /billing/patients?view=owing`: `search` restricted to the owing ids (`idsIn`, from one
     SQL aggregate);
   - `sort=balance`: `search` ordered by integer rank keys (`rank: { ids, keys, restKey }`) that
     `billing` computes from the tenant-currency balances. Equal keys fall back to the name
     order, so equal balances are ordered by name. The same mechanism orders `sort=dentist` in
     `patients`;
   - `GET /billing/patients/owing-count` and the CSV export (`GET /billing/patients/export`),
     which snapshots the same view (every id, in order) and adds the Balance column.
4. **New edges:** `billing → patients` (existence, create, the list), `billing → tenancy`
   (currency, time zone) and `billing → users` (dentist names in the export). None of them
   imports `billing`, so the graph stays acyclic. `clinical` joins in feature 5.
5. **Ledger entries follow a merge through a BullMQ job.** `patients` emits `PatientsMerged`
   after the merge commits. `billing`'s subscriber enqueues a tenant job (`billing` queue,
   `merge-ledger`, job id `merge_<droppedId>` — BullMQ refuses `:` in custom ids) without
   awaiting it, so an unreachable Redis never holds up the merge request or the audit
   subscriber. The worker runs as a `job` actor (carrying the merging user and, for a platform
   admin, the admin flag — for the audit only, see below) and, in one transaction, checks that
   the dropped patient really was merged into the kept patient's chain (both resolve to the same
   survivor; otherwise it moves nothing and logs the ids), then moves the dropped patient's
   entries to the
   **survivor** of the kept patient — the kept patient itself, or the end of its merge chain if
   it has been merged away since (`PatientsService.survivorOf`, which holds the survivor
   `FOR SHARE`). The jobs of a chain (A into B, B into C) therefore end on C in any order. It
   audits `ledger_entry.repoint`. The job is idempotent (a re-run finds nothing to move),
   retried with backoff and dead-lettered (CLAUDE.md §9). Ledger writes hold the patient row
   `FOR SHARE`, and the merge locks it `FOR UPDATE`, so an entry written concurrently with a
   merge commits first and is moved by the job; after the merge, the dropped record refuses new
   entries (409 `patient.merged`).

## Consequences

- **The after-commit enqueue window.** Events are dispatched after the merge transaction
  commits, and the enqueue is a separate write to Redis. If the process crashes between the
  commit and the enqueue, or Redis refuses the job (the subscriber logs the ids and moves on),
  the re-point never runs: the dropped (archived) record keeps its entries, and the survivor's
  balance is short by that amount. The `PatientsMerged` audit entry still exists. **There is no
  automatic reconciliation.** Recovery is manual:
  - the job was never enqueued: enqueue `merge-ledger` again with the same payload and job id.
    This works only because no job with that id exists;
  - the job exists but failed (retries exhausted; it is in the queue's failed set and the
    dead-letter queue): retry it (`job.retry()`) or replay the dead letter. Enqueueing again
    with the same id does nothing while the failed job is kept.

  An outbox (the event written in the merge transaction, relayed to the queue) would close the
  window; it is platform work to do once a second consumer needs the same guarantee.

- **Locking:** the re-point walks both merge chains `FOR SHARE` while a merge takes `FOR UPDATE`
  on its pair; a merge first refuses archived or merged-away records with an unlocked read (409
  `patient.archived`, re-checked after `lockPair`), so it never locks the archived links the job
  walks, and a rare deadlock left over is resolved by Postgres and a BullMQ retry.
- Until the job has run, the survivor shows the balance without the dropped record's entries.
  In practice this is milliseconds.
- `repointMergedEntries` and `survivorOf` are not permission-gated: the re-point is the system's
  follow-up to a merge the user was allowed to make, and a job actor holds no permissions. Both
  refuse to run outside a job or system task.
- **Platform-admin flag in jobs: an audit fact, not authority** (amends ADR-0008 and ADR-0010).
  The job envelope carries `platformAdmin` so the job's audit entries record that an admin
  triggered it (`actor_platform_admin`). `RequestContext` keeps the fact
  (`isPlatformAdmin`) apart from the authority (`actsAsPlatformAdmin`: the flag in an
  `actorKind: 'user'` context, i.e. the admin's own authenticated request). Only the authority
  lets `hasPermission` grant everything in a tenant, `runInTenant` enter a tenant and
  `withoutTenant` bypass RLS. A job (or, later, an agent) carrying the flag gets none of it, so
  a job actor still holds no permissions and a forged Redis payload cannot escalate.
- The balance sort sends every non-zero tenant-currency balance to `search` as two arrays. That
  is fine for thousands of patients per tenant (ADR-0018's bound). Balances in another currency
  (after a tenant currency change) count as zero for the sort and are not in the CSV.
- The export takes its snapshot (every id of the view, in order: `PatientsService.searchIds`)
  before streaming, and reads the rows 500 ids at a time, so rows written meanwhile never shift
  or repeat. The id list is bounded by the tenant's patient count (ADR-0018).
- `GET /patients` refuses `view=owing` and `sort=balance` with 400; the SPA sends those queries
  to `GET /billing/patients`, which returns the same page shape.
