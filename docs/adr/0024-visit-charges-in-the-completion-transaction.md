# ADR-0024: Visit charges in the completion transaction

- Status: Accepted
- Date: 2026-09-30

## Context

Feature 4a (`docs/superpowers/specs/2026-09-29-visit-workspace-design.md`) ends a visit with
_Complete_. The visit's money is frozen, and the patient then owes the visit total: `billing`
must post it to the ledger. Right after completing, the workspace shows the visit's financial
summary: _This visit_, _Previous_ (what the patient owed before) and _Total outstanding_.

The completion lives in `clinical`, the ledger in `billing`, and CLAUDE.md §4 rule 3 says
cross-module reactions use domain events, never a call into the other module to trigger a side
effect. CLAUDE.md §9 had two ways to react to an event: an after-commit handler, or a BullMQ job
for work that must survive a crash. The design had to decide:

- how the charge gets posted, and whether the completion can commit without it;
- what happens to a visit whose total is 0;
- who may post it, since an assistant completes visits but holds no `payment:write`;
- when `billing` starts to depend on `clinical` (CLAUDE.md §4 planned feature 5).

## Decision

**In-transaction event handlers (W23).** A handler decorated with
`@OnDomainEventInTransaction(name)` runs during `EventBus.publish`, inside the publisher's open
`TenantDb` transaction and request context, before commit. Handlers of one event run one at a
time, in registration order; a throw rolls the whole transaction back and reaches the publisher
with its original type. The after-commit dispatch (`@OnDomainEvent`, the audit subscriber) is
unchanged, and events published by an in-transaction handler dispatch after the one that
triggered it. The rules (CLAUDE.md §9): database work through `TenantDb` only — no HTTP, storage,
LLM or queue calls; each handler writes only its own module's tables through its own services;
and it stays fast, because it holds the publisher's locks. A reaction that must be atomic with
the change subscribes in the transaction; a slow or external one still enqueues a job.

**The charge is posted in the completion's own transaction (W2).**

- `VisitsService.complete` freezes the money, then publishes
  `VisitCompleted { visitId, patientId, currency, total, localDate }` inside its `TenantDb`
  transaction.
- `billing`'s `VisitChargeSubscriber` subscribes with `@OnDomainEventInTransaction`, so it runs
  in the completing request's context and transaction. It reads `VisitsService.chargeFacts`
  through that transaction, holds the patient `FOR SHARE` (already held by `complete`,
  re-entrant), and inserts the `visit_charge` entry and its lines. The entry is audited
  (`ledger_entry.create`), and `LedgerEntryRecorded` is dispatched after commit like every other
  entry.
- The completion and its charge commit together, or neither does. A failing ledger write fails
  `complete`, and the visit stays live; the user can complete it again.
- The entry is dated on the visit's local date (`effective_date = local_date`), in the visit
  currency, and `created_by` is the completing user (W10). Its lines (`ledger_entry_lines`) are
  a snapshot of the services as charged: code, name, tooth, surfaces and the final line price.
- **No double charge.** `complete` locks the visit `FOR UPDATE` and refuses anything but a live
  visit (409 `visit.not_live`), so a retried request can't complete twice. A partial unique index
  on `ledger_entries (tenant_id, visit_id) where visit_id is not null` is the second guard. A
  violation of it can only be a bug, so it is raised, not ignored, and rolls the completion back.

**A zero total posts nothing (W20).** An examination-only visit, or one with a 100 % discount,
completes with total 0. The ledger refuses zero amounts (`ledger_entries_amount_non_zero`), so
no entry is written, and the summary shows 0 for _This visit_.

**The write is internal to `billing` and not gated by `payment:write`.** The trigger is
`complete`, which requires `visit:write`, and the assistant who completes a visit must not be
refused. `billing` does not export the write: the handler posts through its internal
`LedgerWriter`, the one write path every entry uses. It is, however, gated on `visit:read` and
`patient:read`: `VisitChargeSubscriber` calls `VisitsService.chargeFacts` and
`PatientsService.lockForDependentWrite` inside `complete`'s own transaction, and each re-checks
its permission (CLAUDE.md §6). A completer without either would fail the whole completion, not
just the charge. Every system role holding `visit:write` also holds both
(`docs/modules/roles.md`), so this is a standing requirement on any future custom role, not
something the four seeded roles can hit.

**The summary reads the ledger alone.** `GET /billing/visits/:visitId/summary` (`payment:read`,
and `visit:read` through `VisitsService.visitMoney`): _This visit_ = the visit's charge (0 if
none), _Previous_ = the patient's balance in the visit currency less the charge, _Total
outstanding_ = the balance. The charge is already there when `complete` returns, so the summary
never waits for anything. A live visit → 409 `visit.not_live`. It reports the visit's currency
only: a balance the patient carries in another currency (e.g. after a tenant currency change,
ADR-0015) is left out of every figure, not converted — a known gap, `docs/modules/billing.md`.

**The `billing` → `clinical` edge arrives in 4a (W21),** not in feature 5 as CLAUDE.md §4
planned. `billing` reads `VisitsService.chargeFacts` and `visitMoney` and consumes
`VisitCompleted` in the transaction. `clinical` never imports `billing`, so the graph stays
acyclic. This amends ADR-0017's "`clinical` joins in feature 5".

**Migrations.** `ledger_entry_kind` gains `visit_charge` in a migration of its own
(`0016_ledger_visit_charge_kind`). drizzle-kit applies every pending migration in one
transaction, and Postgres refuses a literal of an enum value added in that transaction ("unsafe
use of new value"). The check that ties `visit_id` to the kind therefore compares
`kind::text = 'visit_charge'`, which a fresh database can create in the same run.

## Alternatives considered

- **A BullMQ job enqueued after commit** (the `merge-ledger` pattern). The completion would
  commit without its charge, the summary would have to wait for the job or show a stale balance,
  and a lost enqueue or a dead-lettered job would leave a completed visit unbilled until someone
  replays it. It also adds Redis work, which 4a avoids. The ledger insert is a few rows in the
  database the completion already writes to: a job buys nothing here.
- **An after-commit handler.** The same window as the job, without the retries: a crash or a
  failed insert after the commit loses the charge silently.
- **`clinical` calling `BillingService` directly.** It breaks CLAUDE.md §4 rule 3 (a call made
  only to trigger a side effect) and would make `clinical` depend on `billing`, the reverse of
  the planned edge.
- **Posting 0 entries, or relaxing the non-zero check for visit charges.** A zero entry changes
  no balance and would only clutter the ledger; _This visit_ is 0 either way.

## Consequences

- A completed visit always has its charge, and a charge always belongs to a completed visit:
  there is no reconciliation job and no "unbilled visit" state.
- Completion now depends on the ledger write: a `billing` failure (a bug, a constraint) blocks
  completing visits. That coupling is intended — a visit that completes without its charge is
  the worse failure — and the error surfaces immediately instead of in a dead-letter queue.
- The handler holds the completion's locks (the patient `FOR SHARE`, the visit `FOR UPDATE`)
  while it writes, so it must stay small: database work on `billing`'s own tables only, no HTTP,
  storage, LLM or queue calls (W23, CLAUDE.md §9).
- `balanceOf` also answers `charged` (Σ `visit_charge` per currency), the Record's _Lifetime
  billed_ (W8).
- A visit completed after a merge charges the kept patient: the merge re-points visits in its own
  transaction and completion locks the patient first (W24, ADR-0023). Ledger entries written
  before the merge — including a charge posted for a visit that only later got merged onto another
  patient — still move through the `merge-ledger` job (ADR-0017), lines with their entry, so there
  is a window between the merge commit and that job where the visit already points at the kept
  patient but its charge still sits on the dropped one. `visitSummary` covers it: when the charge's
  own patient differs from the visit's, it sums both patients' balances (same currency) instead of
  just the visit's, so _this visit_ / _previous_ / the total stay correct throughout the window and
  collapse back to the ordinary single-patient sum once the job has moved the entry.
