# ADR-0036: The ledger follows a patient merge in the merge transaction

- Status: Accepted
- Date: 2026-10-06
- Amends: ADR-0017 (decision 5 and its "after-commit enqueue window" are replaced)

## Context

ADR-0017 moved a merged-away patient's ledger entries to the kept patient through a BullMQ job,
enqueued after the merge committed. Until the job ran the kept patient's balance was short by the
dropped record's entries, and when the enqueue or the job failed it stayed short: there was no
automatic reconciliation, only a manual replay.

`clinical` has re-pointed its records inside the merge transaction since feature 4a
(`@OnDomainEventInTransaction`, ADR-0024). Feature 7 (H8) asks the same of `billing`: after a
merge the kept record's balance must be right immediately.

## Decision

1. **`billing` handles `PatientsMerged` in the merge transaction.** The handler takes the two
   accounts' advisory locks, moves the dropped patient's `ledger_entries` and `payments` to the
   kept one, settles the kept account (one account now: the credit of one side meets the open
   charges of the other, P15) and audits `ledger_entry.repoint` on the kept patient, as the
   merging user.
2. **A failure rolls the merge back.** There is no state in which a patient is merged and its
   money is stranded.
3. **The job path is deleted**: the `merge-ledger` job and its worker, the `billing` queue,
   `BillingService.repointMergedEntries` and `PatientsService.survivorOf`. A merge chain (A into
   B, then B into C) needs nothing: each merge re-points in its own transaction.

## Consequences

- **Lock order.** The merge holds both patients `FOR UPDATE`, then the handler takes the account
  locks in patient id order. Every ledger writer takes the patient `FOR SHARE` and then its
  account lock, so the order is the same: a write in flight commits first and is moved, and a
  write that arrives later finds the patient merged (409 `patient.merged`).
- The merge request now does the re-point's work: two updates, the settle, an audit row. It is
  bounded by one patient's entries.
- `visitSummary` no longer sums over two patients for a "window" that cannot occur.
- The audit entry's actor is the merging user (`actor_kind = 'user'`), not a job. The
  platform-admin flag still records an admin's merge.
- `billing` uses no queue. Redis and BullMQ remain in the platform for the modules that will
  need them (CLAUDE.md §2); removing them is separate work.
- ADR-0017's rule that a job carrying the platform-admin flag gets no authority (its amendment of
  ADR-0008 and ADR-0010) stands: it is about jobs in general, not this one.
