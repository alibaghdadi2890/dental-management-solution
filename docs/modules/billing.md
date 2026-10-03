# `billing` module

**Status:** implemented for feature 3: the patient ledger, opening balances, adjustments,
balances, the patient views that need a balance (Owes balance, sort by balance, CSV export) and
the job that moves ledger entries after a patient merge. Feature 4a adds the visit charge, posted
in the completion's transaction, and a completed visit's financial summary (ADR-0024). Feature 5 adds payments, refunds and voids on the patient account, their stored allocations,
receivables (KPIs, aging, outstanding) and the data of the printables (ADR-0027 to ADR-0029).
Stored invoices and price lists come later.

## Purpose

What a patient owes. It is a ledger of signed entries: the opening balance a patient carries
over from a previous system, adjustments (feature 3), and the charge of each completed visit
(feature 4a). The balance is the sum of the entries in each currency (design Q13). `billing`
depends on `patients`; `patients` never imports `billing` (design Q1), so the Patients list views
that need a balance are composed here, on top of `PatientsService.search` (design Q4, Q5;
ADR-0017).

- **Money:** `numeric(12,2)` plus a `currency` (CLAUDE.md §7). Positive means the patient owes;
  negative is a credit. Amounts travel as decimal strings and are summed exactly: by Postgres on
  `numeric`, then by `domain/balances.ts` on integer cents (`bigint`). Floats are never used.
  Inputs are bounded by one `numeric(12,2)` (`decimalAmountSchema`, 10 integer digits), but a
  sum can be wider: balances use `balanceMoneySchema` (`balanceAmountSchema`: up to 18 integer
  digits, always 2 decimals).
- **Currency:** each entry gets the tenant currency at write time. Changing the tenant currency
  converts nothing (ADR-0015). A patient can therefore have balances in several currencies:
  `balances` lists each non-zero one, ordered by currency code, and `[]` when there are none.
- **Owing:** any currency's balance is positive. It is evaluated in SQL
  (`group by patient_id, currency having sum(amount) > 0`).
- **Dates:** `asOf` (opening balance) and `effectiveDate` (adjustment) must not be after the
  tenant's today, computed from the injected clock in the tenant time zone. The contract only
  rejects dates that are obviously in the future. The service is the source of truth: a later
  date → 422 `validation_failed` at that path.
- **Opening balance only on create** is enforced by the route (`POST /billing/opening-balances`
  creates the patient). The schema does not enforce it: a merge moves both records' opening
  balances onto the kept patient (design Q12).
- **Locking against merges:** every ledger write first calls
  `PatientsService.lockForDependentWrite` (named `lockForLedger` before feature 4a, W22), which
  reads the patient `FOR SHARE` in the same transaction as the insert. A merge locks both records
  `FOR UPDATE`, so it waits for in-flight ledger writes, and the re-point job then finds their
  entries. A merged-away patient refuses new entries: 409 `patient.merged` (the entry
  belongs on the kept record). An archived patient that was not merged accepts them, for
  example to write off a debt.

## Owns

- `ledger_entries` (tenant RLS): `id`, `tenant_id`, `patient_id`, `kind` (`ledger_entry_kind`
  enum: `opening_balance`, `adjustment`, the visit kinds `visit_charge`,
  `visit_charge_adjustment`, `visit_charge_reversal`, and the payment kinds `payment` (negative),
  `payment_refund` and `payment_void` (positive), one per `payments` row), `amount numeric(12,2)` (signed; check
  `amount <> 0`), `currency char(3)`, `effective_date date`, `note?`, `reason?`, `created_by`
  (the actor's auth user id), `visit_id?`, `amendment_id?`, timestamps.
  - `patient_id` has no foreign key, because `patients` owns that table. Existence is always
    checked through `PatientsService`: `lockForDependentWrite` for writes, `getMany` for reads.
  - `visit_id` is the visit a visit-kind entry is about, set iff the kind is one of the three
    (check `ledger_entries_visit_iff_visit_kind`, which compares `kind::text`: enum values are
    added in the same migration run, see ADR-0024). No foreign key: `clinical` owns `visits`.
  - `amendment_id` is the `visit_amendments` row a `visit_charge_adjustment` posts, set iff the
    kind is that (feature 4b, ADR-0025); no foreign key either.
  - `ledger_entries_visit_kind_unique` on `(tenant_id, visit_id, kind, coalesce(amendment_id,
<nil uuid>))` where `visit_id` is set: a visit is charged once, reversed once and adjusted once
    per amendment. (No enum literal in the predicate: index predicates must be immutable and an
    enum's text cast isn't.)
  - Indexes: `tenant_id`, `(tenant_id, patient_id)`, `(tenant_id, visit_id)` where set, the unique
    index above, and the unique `(tenant_id, id)` that `ledger_entry_lines` references.
  - Entries are never edited or deleted. The merge job is the only writer that updates a row,
    and it changes `patient_id` (and `updated_at`) only; `created_by`, `visit_id` and the amount
    stay. Enforced by grants (migration `0011_ledger_append_only`, like `audit_log`): the runtime
    roles have no `DELETE` or `TRUNCATE`, and only `dcm_app` may `UPDATE`, on those two columns.
- `ledger_entry_lines` (tenant RLS, feature 4a): the lines of a `visit_charge` (spec V7), a
  snapshot of the visit's services as charged: `id`, `tenant_id`, `entry_id` → `ledger_entries`
  (composite with `tenant_id`), `position` (1-based, the visit's service order; unique per
  entry), `code`, `name`, `tooth_code?`, `surfaces text[]`, `amount numeric(12,2) ≥ 0` (the final
  line price: base − line discount), `currency`, timestamps. The entry's amount is the visit
  total after the visit-level discount, so it need not equal the sum of its lines. Append-only:
  the runtime roles have no `UPDATE`, `DELETE` or `TRUNCATE` (migration
  `0018_ledger_lines_append_only`). A merge re-point moves the entry, and its lines with it.
- `payments` (tenant RLS, feature 5): `id`, `tenant_id`, `patient_id` (no FK), `kind`
  (`payment_kind`: `payment`, `refund`, `void`), `amount numeric(12,2) > 0`, `currency`, `method`
  (`payment_method`: `cash`, `card`, `bank_transfer`, `insurance`), `paid_at date`, `reference?`,
  `note?`, `reason?` (set iff a refund or void), `receipt_number` (the `RCT-` sequence; refunds and
  voids carry their payment's; indexed, not unique: a household shares one, and a merge may bring two rows of one receipt onto one patient (migration `0025_payments_indexes`)), `household_group_id?`,
  `payer_contact_id?` (no FK), `reverses_payment_id?` (set iff a refund or void, FK),
  `ledger_entry_id` (FK, unique), `idempotency_key?` (indexed; replays are serialised by an advisory lock on the key),
  `balance_after numeric(20,2)?` (a payment's account balance right after it: the "partial" pill),
  `branch_id?`, `recorded_by` (auth user id), timestamps. Append-only (migration
  `0024_payments_append_only`): only `dcm_app` may update, and only `patient_id` and `updated_at`
  (the merge re-point).
- `payment_counters` (tenant RLS): `tenant_id` (PK), `last_value`, timestamps. The receipt
  sequence, minted like `visit_counters`; a rolled-back payment frees its number.
- `payment_allocations` (tenant RLS): `id`, `tenant_id`, `seq` (identity, orders rows written in one
  transaction), `source_entry_id` and `target_entry_id` (FKs to `ledger_entries`), `amount`
  (signed, non-zero: a release is negative), `kind` (`allocation_kind`: `allocation`, `credit_applied`,
  `release`), `manual` (B4), timestamps. Append-only. A pair's allocation is Σ its rows. Named
  for payments, but write-offs are sources too (ADR-0027).

## Public API (`index.ts`)

`BillingModule`, `BillingService`, and the event name and type (`LEDGER_ENTRY_RECORDED`,
`LedgerEntryRecorded`). The visit charge write is internal (`VisitChargeSubscriber`, below).

`BillingService`: inputs are the contract's Zod output, and results are plain data.

| Method                                                               | Access                            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createWithOpeningBalance({ patient, openingBalance })`              | `payment:write` + `patient:write` | One `TenantDb` transaction. `asOf` is checked before anything is written (path `openingBalance.asOf`). Then `PatientsService.create`, which is `patient`'s whole create schema — including `contacts` (linked in the same transaction, design addendum C4) and `linkContactId` — and the `opening_balance` entry; the new patient is not re-read. The patient, its display number, any contact links, and the `opening_balance` entry, with their audit entries and events, commit or roll back together (a failed link or a failed entry leaves nothing: no patient, no contact, no link, no entry, and the display-number counter is not advanced). The patient's field errors (contacts included) come back under `patient.` (e.g. `patient.phone`, `patient.contacts.0.target.contactId`, `patient.linkContactId`). Returns `{ patient, balance }`. |
| `recordOpeningBalance(patientId, { amount, asOf, note? })`           | `payment:write`                   | A building block for the feature 6 import. Checks `asOf` (path `asOf`) and locks the patient. Unknown patient → 404 `patient.not_found`; merged away → 409 `patient.merged`. Returns the patient's balance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `adjustBalance(patientId, { amount, effectiveDate, reason, note? })` | `payment:write`                   | The amount is signed and non-zero. A reason is required and is written to the entry and the audit entry. Locks the patient: unknown → 404, merged away → 409 `patient.merged`, archived allowed. Returns the balance after the entry. There is no UI for it in feature 3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `balanceOf(patientId)`                                               | `payment:read`                    | `{ patientId, balances, charged }`; `charged` is Σ the visit kinds (charges, adjustments, reversals) per currency (_Lifetime billed_, W8), non-zero currencies only. Unknown patient → 404.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `balancesFor(patientIds)`                                            | `payment:read`                    | Returned in input order, de-duplicated, each with `balances` and `charged`. Ids the tenant can't see are omitted. Patients without entries get `balances: []` and `charged: []`. One aggregate query for all ids.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `patientIdsOwing()`                                                  | `payment:read`                    | Ids of the patients owing in any currency, archived ones included, in id order. One SQL aggregate. A building block for `billing`'s patient views.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `visitSummary(visitId)`                                              | `payment:read`                    | A completed visit's figures, in the visit currency: `visit.total` = Σ its visit entries, `visit.paid` = Σ allocated to it (every source), `outstanding`, `previous` = the balance less this visit's outstanding, `totalOutstanding` = the balance, and `payments` (the payments covering it, for the invoice). Also requires `visit:read`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `balancesForVisits(visitIds)`                                        | `payment:read`                    | Per visit, in input order: `{ visitId, currency, charged, paid, outstanding }`; `paid` = Σ allocated to it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `paidOn(visitId)`                                                    | none (internal)                   | Σ the **payment**-sourced allocations on the visit (P8): what vetoes a void (ADR-0026). Read in the void transaction under the account lock.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `repointMergedEntries(keptId, droppedId)`                            | none (job only)                   | The merge re-point, run by `MergeLedgerWorker`: moves the dropped patient's entries **and payments** to the survivor, audits `ledger_entry.repoint` (after `{ droppedId, keptId, count, payments }`) and settles the survivor (P15).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Every write goes through the internal `LedgerWriter`: it records the entry (and a visit charge's
lines) and audits `ledger_entry.create` (resource type `ledger_entry`, after = the entry — with
its `lines` for a visit charge — reason for adjustments) in the same transaction. It emits
`LedgerEntryRecorded` after commit.

### Payments (feature 5, ADR-0027 to ADR-0029)

Spec `docs/superpowers/specs/2026-10-02-payments-design.md` (P1–P16).

- **Targets and sources** (`domain/allocate.ts`): a target is an `opening_balance` or `adjustment`
  above zero, or a visit (its `visit_charge`, else its first entry, netted with every entry of the
  visit). A source is a `payment` (capacity = amount − refunds − voids) or a credit entry
  (`adjustment` / `opening_balance` below zero). The SQL that lists them is
  `AllocationsRepository`'s `targetsQuery`; the pure rules are `planPayment`, `settle` and
  `refundReleases`.
- **`Settlement`** (`application/settlement.ts`, internal): `lock(patientIds)` (advisory locks
  `account:<id>` in id order, after the patients' `FOR SHARE`), `state`, and `settle(patientId)`:
  releases over-allocations newest first, then applies free source money to open targets oldest
  first (`credit_applied` for existing credit → `CreditApplied`). Every ledger writer calls it:
  `recordOpeningBalance`, `adjustBalance` (a write-off is a new source), `VisitChargeSubscriber`
  after each entry, `PaymentsService`, the merge re-point.
- **`PaymentsService`** (internal; `application/payments.service.ts`):

| Method                          | Access           | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preview(input)`                | `payment:write`  | The dry run: cap (`outstanding` of the paid accounts in the tenant currency), `remaining`, the allocation lines, `error` (`payment.over_outstanding`, `payment.nothing_outstanding`). No lock, no write.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `record(input, idempotencyKey)` | `payment:write`  | One transaction: `paidAt` ≤ today; the patient (and household) `FOR SHARE`; payer resolved (`ContactsService.contactsOf`, `patientsBilledBy`); accounts locked; cap check (422); receipt number; per paid account a `payment` entry, its allocations (manual target, context visit, oldest first), a settle, the `payments` row with `balance_after`; audit `payment.create` with allocations; `PaymentRecorded` after commit. A replayed key returns the first result; another body under it → 409 `payment.idempotency_mismatch`; a concurrent replay's unique violation is answered with the winner's rows. |
| `refund(paymentId, input)`      | `payment:refund` | Amount ≤ payment − refunds (409 `payment.over_refund`); not after today nor before the payment; releases credit first, then proportionally; `payment_refund` entry and `refund` row; settle; audit `payment.refund` with releases; `PaymentRefunded`.                                                                                                                                                                                                                                                                                                                                                          |
| `void(paymentId, input)`        | `payment:refund` | Every row of the receipt (a household's too); refused after a refund (409 `payment.has_refunds`) or twice (409 `payment.not_reversible`); `payment_void` entries and `void` rows; settle releases everything; audit `payment.void`; `PaymentVoided`.                                                                                                                                                                                                                                                                                                                                                           |

- **`PaymentViewsService`** (internal; `payment:read`; patient reads re-check `patient:read`,
  visit numbers `visit:read`): `transactions` (cursor on `(paid_at, id)` desc; `q` matches a
  patient, a receipt `RCT-12`/`12` or a visit `V-12`), `exportTransactions` (CSV in `en`/`ar`/`fr`),
  `receivables` (Collected and Refunds over the last 30 days, Outstanding, aging buckets of the
  unpaid remainders), `outstanding` (owing patients, oldest unpaid first, bucket of the oldest,
  cursor on `(oldest, patient id)`; `group=payer` groups owing patients into families by primary billing contact, the cursor on `(oldest, group key)`), `family` and `familyStatement` (a billing contact's family, ADR-0028 seen from the payer), `account` (balance card, credit, open charges, payer, payers,
  household, history with the running Remaining), `receipt` and `statement`.
- Errors: 422 `payment.over_outstanding`, `payment.nothing_outstanding`, `payment.invalid_target`,
  `payment.invalid_payer`, `payment.invalid_cursor`; 404 `payment.not_found`; 409
  `payment.over_refund`, `payment.has_refunds`, `payment.not_reversible`,
  `payment.idempotency_mismatch`.

### Visit charge (`application/visit-charge.subscriber.ts`, ADR-0024)

`VisitChargeSubscriber` is an in-transaction handler of `VisitCompleted`
(`@OnDomainEventInTransaction`, W23): it runs inside `VisitsService.complete`'s transaction and
request context, before commit (spec W2).

- A total of 0 posts nothing (W20: the ledger refuses 0).
- Otherwise it reads `VisitsService.chargeFacts(visitId)` (`visit:read`) through the open
  transaction, so it sees the completion; calls `lockForDependentWrite` (already held by
  `complete`); and appends, through `LedgerWriter`, the `visit_charge` entry — the frozen total,
  in the visit currency, `effective_date` = the visit's local date, `created_by` = the
  completing user (W10), `visit_id` — and its lines. `LedgerEntryRecorded` is dispatched after
  commit.
- Not gated by `payment:write`: the assistant who completes a visit doesn't hold it, and the
  trigger (`complete`) requires `visit:write`. Nothing outside `billing` can call the write.
- A failure rolls the completion back: the visit stays live. A unique violation on `visit_id`
  (a second charge for one visit) can only be a bug; it is raised, not ignored.

Patient existence comes from `PatientsService` (`getMany`, `lockForDependentWrite`), which
requires `patient:read`. In practice, reads and writes here need `patient:read` as well as the
`payment:*` permission. Every system role holds it.

### Visit corrections (feature 4b, ADR-0025, ADR-0026)

The same subscriber also handles, in the amend or void transaction:

- `VisitAmended` → a `visit_charge_adjustment` of the delta (negative for a credit), naming the
  amendment, dated the tenant's today, with the amendment's reason and no lines; a zero delta
  posts nothing.
- `VisitVoided` → if `paidOn(visitId) > 0`, `VisitHasPaymentsError` (409 `visit.has_payments`)
  rolls the void back; else a `visit_charge_reversal` of −Σ the visit's entries (nothing when they
  net to zero), dated today, with the void reason.

`visitSummary` reads every visit entry, so an amended visit's _This visit_ is its net charge and a
voided one's is 0.

### Visit views (`application/visit-views.service.ts`, feature 4b)

The Visits screen's money, composed on `VisitsService` like the patient views on
`PatientsService`. Every method requires `payment:read`; `VisitsService` re-checks `visit:read`.

- `unpaid(query)`: the visits list restricted to `visitIdsOwing()` (visits whose entries sum
  above 0) through `search`'s internal `idsIn`.
- `unpaidSummary(filters)`: the Unpaid footer (`count`, `billed`) and its tab chip (`tabCount`,
  filters ignored).
- `open(query, labels)`: the visits CSV export of any tab (_Unpaid_ included), read a cursor page
  at a time: Visit, Date, Time, Room, Patient, Patient ID, Dentist, Services, Subtotal, Discount,
  Total, Paid, Balance, Status (headers and statuses in `en`/`ar`/`fr`).

### Patient views (`application/patient-views.service.ts`)

Internal to the module (not exported); `http/billing-patients.controller.ts` and the export use
it. Every method requires `payment:read`, and `PatientsService.search`/`searchIds` re-check
`patient:read`. The query is `PatientListQuery`, the same as `GET /patients`, and the result the
same offset page (ADR-0018).

| Method           | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list(query)`    | `view=notSeen` → the active view without the patients `clinical` saw in the last 180 days; `lastVisit=never` → without any patient with a counted visit (`search`'s internal `idsNotIn`, feature 4b). `view=owing` → the active view restricted to `patientIdsOwing()` (`search`'s internal `idsIn`). `sort=balance` → `search`'s internal `rank` from `rankByBalance` over every non-zero tenant-currency balance (`sumsInCurrency`); works with every view, `owing` included, and with `q` and the filters. Any other query is passed through. |
| `owingCount()`   | The active patients owing in any currency (the tab chip): `search`'s total over the owing ids.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `notSeenCount()` | The Not seen tab chip: active patients without a counted visit in the last 180 days.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `idsFor(query)`  | Every patient id of a view (the list query without paging), in the view's order, unpaged (`PatientsService.searchIds`, same owing/balance handling). The export's snapshot. Bounded by the tenant's patient count (ADR-0018).                                                                                                                                                                                                                                                                                                                    |

### CSV export (`application/patient-export.service.ts`)

`open(query, labels)` requires `payment:read` and `patient:read`. It resolves the tenant and its
today, takes the **snapshot** — the ids to export, in order — and returns `{ fileName, chunks }`:

- **Rows:** `ids` (1–100) → exactly those patients, in that order, archived ones included; ids the
  tenant can't see are skipped. Otherwise every patient of the filtered and sorted view
  (`idsFor`, `owing` and `balance` included).
- **Chunks:** the rows are read with `PatientsService.listItemsByIds` 500 ids at a time (one query
  per chunk) as the chunks are pulled, then re-ordered to the snapshot (the method itself returns
  no particular order), with their balances (one aggregate per chunk) and dentist names. The
  first chunk holds the UTF-8 byte order mark (for Excel and Arabic), the header row and the
  first rows. Because the order is fixed up front, rows written while the file streams never
  shift or repeat; a patient created meanwhile is simply not in the file.
- **Columns** (the Patients table's order, one `COLUMNS` spec that also marks the numeric ones,
  plus two export-only additions): Patient ID (display number), Name, Age (whole years on the
  tenant's today; empty without a date of birth), Sex (localised; `unknown` is empty), Phone,
  **Guardian name** and **Guardian phone** (design addendum C14, resolved per C7 — the resolved
  primary guardian, export-only, no column of their own in the Patients table; empty when the
  patient has none), Last visit and Visits (empty until visits exist, feature 4), Dentist, Balance
  (`<label> (<tenant currency>)`: the tenant-currency amount as a plain decimal, `0.00` when
  none). Balances in another currency (after a tenant currency change) are not in the file.
  - The guardian columns sit right after Phone rather than at the end: both are "how to reach
    someone about this patient" and read better together than split across the sheet by the
    visit/billing columns (implementation choice for I1; the addendum only specified the two new
    columns, not their position).
  - **Guardian name**: the resolved primary guardian's full name, subject to the same CSV
    injection guard as every other cell (a name starting with `=`, `+`, `-`, `@` — full-width
    forms included — is prefixed with `'`).
  - **Guardian phone**: formatted exactly like the patient's own Phone column — the tenant
    country's numbers in national format, others in international format (guarded by the leading
    `'` because it starts with `+`). Resolved through `PatientsService.listItemsByIds`, the same
    `patients.listRowsByIds` resolution the Patients list uses (design addendum C14, resolved per
    C7): a guardian who is themself a patient is read from that patient's own name and phone.
- **Phone:** numbers of the tenant's country in national format (`formatPhoneFor`, e.g.
  `03 123 456`), other numbers in international format — which starts with `+`, so the
  injection guard writes them as `'+33 6 12 34 56 78` (unguarded, a spreadsheet would evaluate
  them). The feature 6 import must strip that leading `'` from phone cells
  (docs/modules/imports.md).
- **Dentist:** the display name of the patient's `primaryDentistId` (a staff profile id,
  ADR-0020) from `UsersService.practitionersByProfileIds` (inactive dentists included). That is a
  `users` building block with no permission check of its own; every system
  role holds `user:read`, which the Patients screen's dentist names need anyway, so the export
  shows nothing a `payment:read` + `patient:read` holder can't already see.
- **Format** (`domain/csv.ts`): RFC 4180 quoting (a cell with a comma, quote, CR or LF is quoted,
  quotes doubled) and CRLF line ends. CSV injection guard: a cell that starts with tab, CR or LF,
  or whose first non-whitespace character is `=`, `+`, `-`, `@` or a full-width form of them
  (U+FF1D, U+FF0B, U+FF0D, U+FF20), is prefixed with `'` — except a decimal string in a numeric
  column (Age, Visits, Balance), so a credit is `-50.00`.
- **Language** (`http/export-headers.ts`): the header and the sex values in `en`, `ar` or `fr`:
  the query's `lang` if given, else `Accept-Language` (the supported primary tag with the highest
  quality), else `en`.

### Merge re-point (design Q9, ADR-0017)

- `MergeLedgerSubscriber` handles `PatientsMerged` (dispatched after the merge commits). In the
  event's context (tenant, actor, platform-admin flag, request id) it enqueues `merge-ledger` on
  the `billing` queue with `{ keptId, droppedId }` and job id `merge_<droppedId>`
  (tenant-prefixed by `TenantJobs`), so a repeated event enqueues nothing new while the job is
  kept (24 hours or the last 1,000 completed jobs). The enqueue is **not awaited**: with Redis
  unreachable, ioredis queues commands offline and the add would not settle, and the merge
  request and the audit subscriber (both after-commit hooks) would wait for it. A failed enqueue
  is logged with ids only.
- `MergeLedgerWorker` (a `TenantWorker`: the job's tenant, actor kind `job`, the merging user as
  the actor user, the platform-admin flag carried in the job envelope for the audit only — it
  grants the job nothing, ADR-0017) calls `repointMergedEntries(keptId, droppedId)`. One
  transaction:
  - resolves the **survivor** of the kept patient (`PatientsService.survivorOf`: the kept patient
    itself, or the end of its `mergedIntoId` chain if it has been merged away since), holding it
    `FOR SHARE` so it can't be merged away before the transaction commits;
  - checks that the dropped patient resolves to the same survivor (`survivorOf(droppedId)`), i.e.
    it really was merged into the kept patient's chain; otherwise it moves nothing and logs the
    ids (a malformed or forged job cannot move a live patient's entries);
  - moves every entry of the dropped patient to the survivor;
  - when anything moved, audits `ledger_entry.repoint` (resource type `patient`, resource id =
    the survivor, so it shows in that patient's history; after `{ droppedId, keptId, count }`).

  So the jobs of a merge chain (A into B, then B into C) end on C whatever order they run in. An
  unknown kept patient (or another tenant's) moves nothing. Idempotent; retried with backoff,
  then dead-lettered (CLAUDE.md §9).

- Ledger writes hold the patient row `FOR SHARE` and a merge locks it `FOR UPDATE`, so an entry
  written during a merge commits first and the job moves it too.
- **When a re-point does not happen**, the dropped (archived) record keeps its entries and the
  survivor's balance is short by them. There is no automatic reconciliation. Recovery:
  - **The job was never enqueued** (a crash between the merge commit and the enqueue, or Redis
    refused it; the log has the ids): enqueue `merge-ledger` again with the same payload and job
    id. This works because no job with that id exists.
  - **The job failed** (retries exhausted, it is in the queue's failed set and in the
    dead-letter queue): retry that job (`job.retry()`), or replay the dead letter. Enqueueing
    again with the same id does nothing while the failed job is kept.

### Pure rules (`domain/`)

- `sumBalances(entries)`: Σ per currency on integer cents. Zero sums are dropped and the result
  is ordered by currency code.
- `patientBalance(patientId, sums)`: `{ patientId, balances, charged }` from the repository's
  per-currency sums (`amount` over every entry, `charged` over the visit charges), each by
  `sumBalances`.
- `rankByBalance(patients, dir, tenantCurrency)` → `{ ids, keys, restKey }` (the shape of
  `patients`' `PatientRankKeys`): the keys for `PatientsService.search`'s rank ordering
  (ascending key, then name, then id), using the tenant-currency amount only (other currencies
  count as zero). A dense rank over the distinct amounts, zero included:
  - `desc`: debts, largest first (keys `1..p`); everyone else (zero or no balance) at
    `restKey = p + 1`; then credits, least negative first.
  - `asc`: the mirror image: credits, most negative first; the rest; debts, smallest first.
  - Equal amounts share a key, so the search orders them by name. `ids` holds only the patients
    with a non-zero balance.
- `csvRow(cells, { numericColumns })` (`csv.ts`): one CSV line with the quoting and injection
  guard above.

## HTTP

| Route                                        | Access           | Notes                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /billing/opening-balances`             | `payment:write`  | Body `{ patient, openingBalance }`; `patient` is the patients create schema, so its `contacts` and `linkContactId` are applied in the same transaction (errors under `patient.`). The service also requires `patient:write`. 201 `{ patient, balance }`.                                                                                 |
| `GET /billing/balances?patientIds=`          | `payment:read`   | 1–100 comma-separated ids, de-duplicated. 200 `PatientBalance[]`.                                                                                                                                                                                                                                                                        |
| `GET /billing/patients/:id/balance`          | `payment:read`   | 200 `{ patientId, balances, charged }`.                                                                                                                                                                                                                                                                                                  |
| `POST /billing/patients/:id/adjustments`     | `payment:write`  | Body `{ amount, effectiveDate, reason, note? }`. 201 with the balance.                                                                                                                                                                                                                                                                   |
| `GET /billing/visits/:visitId/summary`       | `payment:read`   | 200 `VisitFinancialSummary` (`visitFinancialSummarySchema`). The service also requires `visit:read`. A live visit → 409 `visit.not_live`; unknown or discarded → 404 `visit.not_found`.                                                                                                                                                  |
| `GET /billing/patients`                      | `payment:read`   | The `GET /patients` query (`view=owing` and `sort=balance` included). 200 `PatientPage`. The service also requires `patient:read`.                                                                                                                                                                                                       |
| `GET /billing/patients/owing-count`          | `payment:read`   | 200 `{ count }` (`owingCountSchema`). The service also requires `patient:read`.                                                                                                                                                                                                                                                          |
| `GET /billing/patients/not-seen-count`       | `payment:read`   | 200 `{ count }`. The services also require `patient:read` and `visit:read`.                                                                                                                                                                                                                                                              |
| `GET /billing/visits/balances?visitIds=`     | `payment:read`   | 1–100 ids. 200 `VisitBalance[]`.                                                                                                                                                                                                                                                                                                         |
| `GET /billing/visits/unpaid`                 | `payment:read`   | The `GET /visits` query. 200 `VisitPage`. The service also requires `visit:read`.                                                                                                                                                                                                                                                        |
| `GET /billing/visits/unpaid/summary`         | `payment:read`   | The visit filters. 200 `{ count, billed, tabCount }`.                                                                                                                                                                                                                                                                                    |
| `GET /billing/visits/export`                 | `payment:read`   | The visit filters, `tab` (`unpaid` too) and `lang?`. 200 `text/csv`, `visits-<tenant's today>.csv`, streamed like the patients export. The service also requires `visit:read`.                                                                                                                                                           |
| `GET /billing/patients/export`               | `payment:read`   | The list query without `page`/`size`, plus `ids?` (1–100) and `lang?` (`en`/`ar`/`fr`, overrides `Accept-Language`). 200 `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="patients-<tenant's today>.csv"`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. The service also requires `patient:read`. |
| `POST /billing/payments`                     | `payment:write`  | Requires `Idempotency-Key` (a uuid; 422 without). Body `PaymentInput`. 201 `RecordPaymentResult`.                                                                                                                                                                                                                                        |
| `POST /billing/payments/preview`             | `payment:write`  | Body `PaymentInput`. 200 `PaymentPreview`.                                                                                                                                                                                                                                                                                               |
| `POST /billing/payments/:id/refund`          | `payment:refund` | Body `{ amount, reason, method?, refundedAt? }`. 201 `{ ids }`.                                                                                                                                                                                                                                                                          |
| `POST /billing/payments/:id/void`            | `payment:refund` | Body `{ reason }`. 201 `{ ids }` (one per voided row).                                                                                                                                                                                                                                                                                   |
| `GET /billing/payments`                      | `payment:read`   | Transactions filters + cursor. 200 `TransactionPage`.                                                                                                                                                                                                                                                                                    |
| `GET /billing/payments/export`               | `payment:read`   | Transactions filters + `lang?`. 200 `text/csv`, `payments-<today>.csv`.                                                                                                                                                                                                                                                                  |
| `GET /billing/payments/:id/receipt`          | `payment:read`   | A payment, refund or void id (the latter two give their payment's receipt). 200 `Receipt`.                                                                                                                                                                                                                                               |
| `GET /billing/aging`                         | `payment:read`   | 200 `Receivables` (KPIs and buckets).                                                                                                                                                                                                                                                                                                    |
| `GET /billing/outstanding`                   | `payment:read`   | `bucket?`, `q?`, `group?` (`patient` default, or `payer`: one row per family under its primary billing contact, with the payer's own record when they owe), cursor. 200 `OutstandingPage`; each item has `payer`, `members` and `payFor` (the patient to open the panel with).                                                           |
| `GET /billing/patients/:id/account`          | `payment:read`   | `payerContactId?` (the payer, and household, the panel opens with). 200 `PatientAccount` (with `payerFor`: the contact that is this patient, when they bill anyone).                                                                                                                                                                     |
| `GET /billing/contacts/:id/family`           | `payment:read`   | 200 `Family`: the contact's own record (if a patient) and every non-archived patient they bill for, each with balance and oldest unpaid date; `total` of the owing balances; `payFor`. Unknown contact → 404 `contact.not_found`.                                                                                                        |
| `GET /billing/contacts/:id/family/statement` | `payment:read`   | 200 `FamilyStatement`: one statement per member and the family total.                                                                                                                                                                                                                                                                    |
| `GET /billing/patients/:id/statement`        | `payment:read`   | 200 `Statement`.                                                                                                                                                                                                                                                                                                                         |

The patient-views routes live in `http/billing-patients.controller.ts` and the visit views in
`http/billing-visits.controller.ts`, both registered before `billing.controller.ts`, whose
`visits/:visitId/summary` would otherwise capture `visits/unpaid/summary`. They are static two-segment paths, and the routes above that take an id
all have three segments under `patients/` (`:id/balance`, `:id/adjustments`), so neither
captures the other. If a two-segment `patients/:id` route is ever added, it must come after the
static paths.

The export is written by the handler itself (`@Res()`, Express types stay in `http/`). It calls
`open` (permissions, snapshot) and pulls the first chunk before setting any header, so a refused
permission or a failed first read is still an RFC 7807 problem; after that a failure can only
abort the download (logged). `http/stream-chunks.ts` then writes the chunks from the handler's
own loop: it waits for `drain` when the socket buffer is full (backpressure), and checks after
every write whether the client went away, stopping without reading another chunk. It does not
pipe a `Readable`: stream callbacks run outside the request's async context, where the tenant
(CLS) is unknown. A download idle for 60 seconds is dropped.

## Known gaps

- `POST /billing/payments` takes an `Idempotency-Key` (stored on the payment, P11); opening
  balances and adjustments still don't: a retried one records twice.
- Payments are in the tenant currency only, and settle only pairs sources and targets of the same
  currency (multi-currency payments are out of scope).
- `visitSummary` and `balanceOf`/`balancesFor` only ever report the visit's (or the tenant's)
  current currency. A patient who also carries a balance in a currency the tenant used to bill in
  (before a tenant currency change, ADR-0015) has that balance left out of every figure here —
  `previous`, `totalOutstanding`, `balances` all silently omit it rather than converting it. The
  Patients list and Record show it separately (each non-zero currency, ADR-0018), so it is visible
  elsewhere; it just never rolls into a single number.

## Events

- Emits (after commit; the generic audit subscriber records each one):
  `LedgerEntryRecorded { entryId, patientId, kind }`; `PaymentRecorded { receiptNumber, paymentIds,
patientIds, householdGroupId, amount, currency, allocations }`, `PaymentRefunded { paymentId,
refundId, patientId, amount, currency, releases }`, `PaymentVoided { receiptNumber, paymentIds,
voidIds, patientIds }`, `CreditApplied { patientId, currency, allocations }`.
- Consumes:
  - `PatientsMerged { keptId, droppedId }` (from `patients`), after commit, to re-point the
    dropped patient's entries through the `merge-ledger` job (design Q9).
  - `VisitCompleted { visitId, patientId, currency, total, localDate }` (from `clinical`),
    **in the completion's transaction**, to post the visit charge (ADR-0024).
  - `VisitAmended` and `VisitVoided` (from `clinical`), **in the amend or void transaction**, to
    post the adjustment or the reversal, or to veto the void (ADR-0025, ADR-0026).

## Jobs

- Queue `billing`, job `merge-ledger`, payload `{ keptId, droppedId }`, job id
  `merge_<droppedId>` (BullMQ refuses `:` in custom ids). Default retries and backoff
  (`platform/queue`), dead-lettered on the last failure.

## Depends on

- `patients`: existence checks (`getMany`), the export's rows and guardian columns
  (`listItemsByIds`, design addendum C14, resolved per C7), the ledger-write lock
  (`lockForDependentWrite`), `create` for the opening-balance create (contacts and
  `linkContactId` included), `search` and `searchIds` with their internal options for the patient
  views and the export, `survivorOf` for the merge re-point; the `PatientsMerged` event.
- `tenancy`: currency, time zone and country (`currentTenant`).
- `users`: dentist display names in the export (`practitionersByProfileIds`, by staff profile
  id); "Recorded by" names (`namesByUserIds`, feature 5).
- `patients` (feature 5): `ContactsService.contactsOf` and `patientsBilledBy` for the payer and the
  household.
- `clinical` (feature 5): `VisitsService.numbersFor` (visit numbers on allocations) and `search`
  (the Transactions visit search).
- `clinical` (feature 4a, W21, ADR-0024): `VisitsService.chargeFacts` for the visit charge,
  `VisitsService.visitMoney` and `VisitNotLiveError` for the summary; the `VisitCompleted`
  event, handled in the transaction.
- `audit`.

None of them imports `billing` (ADR-0017, ADR-0024).

## Permissions

- `payment:read`: owner, dentist, assistant, front desk.
- `payment:write`: owner, dentist, front desk. The assistant does not have it.
- `payment:refund` (refund and void a payment): owner, dentist.
- A platform admin acting in the tenant holds both.
- Completing a visit needs no `payment:*` permission (ADR-0024), but it does need `visit:read` and
  `patient:read` on top of `visit:write`: `VisitChargeSubscriber` calls `VisitsService.chargeFacts`
  (`visit:read`) and `PatientsService.lockForDependentWrite` (`patient:read`) inside `complete`'s
  own transaction, so a completer missing either would fail the completion partway through, not
  just the charge. Every system role that holds `visit:write` (owner, dentist, assistant) also
  holds both (`docs/modules/roles.md`'s matrix), so this never surfaces in practice; it matters
  only if a future custom role grants `visit:write` without them.
