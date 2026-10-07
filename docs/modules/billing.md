# `billing` module

**Status:** implemented for feature 3: the patient ledger, opening balances, adjustments,
balances, the patient views that need a balance (Owes balance, sort by balance, CSV export) and
the ledger re-point of a patient merge (in the merge transaction since feature 7, ADR-0036).
Feature 7 also adds the Adjust balance screen, retry safety on opening balances and adjustments,
and the currency lock (ADR-0035). Feature 4a adds the visit charge, posted
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
  `FOR UPDATE`, so it waits for in-flight ledger writes, and the re-point, which runs in the
  merge transaction, then finds their entries. A merged-away patient refuses new entries: 409 `patient.merged` (the entry
  belongs on the kept record). An archived patient that was not merged accepts them, for
  example to write off a debt.

## Owns

- `ledger_entries` (tenant RLS): `id`, `tenant_id`, `patient_id`, `kind` (`ledger_entry_kind`
  enum: `opening_balance`, `adjustment`, the visit kinds `visit_charge`,
  `visit_charge_adjustment`, `visit_charge_reversal`, and the payment kinds `payment` (negative),
  `payment_refund` and `payment_void` (positive), one per `payments` row), `amount numeric(12,2)` (signed; check
  `amount <> 0`), `currency char(3)`, `effective_date date`, `note?`, `reason?`, `created_by`
  (the actor's auth user id), `visit_id?`, `amendment_id?`, `idempotency_key?` and
  `idempotency_hash?` (the request that recorded an opening balance or an adjustment, H5; unique
  per tenant where set), timestamps.
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
  - Entries are never edited or deleted. The merge re-point is the only writer that updates a row,
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

| Method                                                                     | Access                            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createWithOpeningBalance({ patient, openingBalance }, key?)`              | `payment:write` + `patient:write` | Idempotent with a key (see [Retry safety](#retry-safety-feature-7-h5)). One `TenantDb` transaction. `asOf` is checked before anything is written (path `openingBalance.asOf`). Then `PatientsService.create`, which is `patient`'s whole create schema — including `contacts` (linked in the same transaction, design addendum C4) and `linkContactId` — and the `opening_balance` entry; the new patient is not re-read. The patient, its display number, any contact links, and the `opening_balance` entry, with their audit entries and events, commit or roll back together (a failed link or a failed entry leaves nothing: no patient, no contact, no link, no entry, and the display-number counter is not advanced). The patient's field errors (contacts included) come back under `patient.` (e.g. `patient.phone`, `patient.contacts.0.target.contactId`, `patient.linkContactId`). Returns `{ patient, balance }`. |
| `recordOpeningBalance(patientId, { amount, asOf, note? })`                 | `payment:write`                   | A building block for the feature 6 import. Checks `asOf` (path `asOf`) and locks the patient. Unknown patient → 404 `patient.not_found`; merged away → 409 `patient.merged`. Returns the patient's balance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `adjustBalance(patientId, { amount, effectiveDate, reason, note? }, key?)` | `payment:refund`                  | See [Balance adjustments](#balance-adjustments-feature-7-h4). The amount is signed and non-zero. `reason` is one of `ADJUSTMENT_REASONS`; the note is required for `other`. Locks the patient: unknown → 404, merged away → 409 `patient.merged`, archived allowed. Returns the balance after the entry. Idempotent with a key.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `balanceOf(patientId)`                                                     | `payment:read`                    | `{ patientId, balances, charged }`; `charged` is Σ the visit kinds (charges, adjustments, reversals) per currency (_Lifetime billed_, W8), non-zero currencies only. Unknown patient → 404.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `balancesFor(patientIds)`                                                  | `payment:read`                    | Returned in input order, de-duplicated, each with `balances` and `charged`. Ids the tenant can't see are omitted. Patients without entries get `balances: []` and `charged: []`. One aggregate query for all ids.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `patientIdsOwing()`                                                        | `payment:read`                    | Ids of the patients owing in any currency, archived ones included, in id order. One SQL aggregate. A building block for `billing`'s patient views.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `visitSummary(visitId)`                                                    | `payment:read`                    | A completed visit's figures, in the visit currency: `visit.total` = Σ its visit entries, `visit.paid` = Σ allocated to it (every source), `outstanding`, `previous` = the balance less this visit's outstanding, `totalOutstanding` = the balance, and `payments` (the payments covering it, for the invoice). Also requires `visit:read`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `balancesForVisits(visitIds)`                                              | `payment:read`                    | Per visit, in input order: `{ visitId, currency, charged, paid, outstanding }`; `paid` = Σ allocated to it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `paidOn(visitId)`                                                          | none (internal)                   | Σ the **payment**-sourced allocations on the visit (P8): what vetoes a void (ADR-0026). Read in the void transaction under the account lock.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `currencyLock()`                                                           | `tenant:read`                     | `{ locked, currency }`: locked once any ledger entry exists (ADR-0035).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

Every write goes through the internal `LedgerWriter`: it records the entry (and a visit charge's
lines) and audits `ledger_entry.create` (resource type `ledger_entry`, after = the entry — with
its `lines` for a visit charge — reason for adjustments) in the same transaction. It emits
`LedgerEntryRecorded` after commit. The audit row of an opening balance or an adjustment is an
action of its own on the Activity screen; the row of a payment's or a visit change's entry only
shadows that action and is kept out of the feed (`hidden`, ADR-0037).

### Balance adjustments (feature 7, H4)

A signed, reasoned, dated correction of what a patient owes: negative = owes less (write-off,
courtesy, correction), positive = owes more (a charge that has no visit, correction). It is a
sensitive money action, so it needs **`payment:refund`** (owner, dentist), the trust level of a
refund; front desk sees the action, explained ("Ask a dentist to adjust").

- `reason` is one of `write_off`, `courtesy`, `opening_balance_correction`,
  `charge_without_visit`, `other` (`ADJUSTMENT_REASONS`), stored as text in the entry's `reason`
  and on its audit row; entries older than the list hold free text, so reads type it as a
  string. `other` needs a note of at least 3 characters.
- A write-off is a source and is allocated like a payment (ADR-0027); a positive adjustment is a
  target that ages from its `effective_date`.
- It shows at once in the account's `adjustments` (the Payment history card: its own row type,
  labelled by reason, the amount coloured by direction, with the running Remaining), the
  statement (`kind: 'adjustment'`, with `reason`), Outstanding and aging. The Visits list is
  untouched: an adjustment is on the account, not on a visit.
- SPA: the **Adjust balance** right panel (`features/billing/adjust/`), opened from the balance
  card of the Balance & payments tab, the Overview balance card's ⋯ menu and an Outstanding
  row's ⋯ menu.

### Retry safety (feature 7, H5)

`POST /billing/opening-balances` and `POST /billing/patients/:id/adjustments` require an
`Idempotency-Key` (a uuid; 422 without), like `POST /billing/payments`. The key and a SHA-256 of
the validated request (`platform/kernel/request-hash.ts`; the adjustment's includes the patient)
are stored on the entry. A request whose key is already on an entry: the same fingerprint → the
first result, re-read (201 again; the patient and the balance as they are now); another → 409
`ledger.idempotency_mismatch`. Requests sharing a key run one at a time (an advisory lock on the
key), so a double click creates one patient with one opening balance. The opening balance's key
is on the entry only: the patient and the entry commit together, so finding the entry is finding
both. `POST /patients` has its own (`docs/modules/patients.md`).

### Currency lock (feature 7, H6, ADR-0035)

`CurrencyLockSubscriber` handles `tenancy`'s `TenantCurrencyChanged` inside the settings
transaction and throws 422 `tenant.currency_locked` when any ledger entry exists, which rolls the
change back. `GET /billing/currency-lock` tells the admin Settings tab to disable the select.

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
  household, history with the running Remaining, the balance adjustments), `receipt` and
  `statement`.
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
  posts nothing. A checkout discount (ADR-0030) arrives as the same event, possibly without a
  reason; on a paid visit the settle that follows leaves the difference as credit.
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

### Merge re-point (ADR-0036)

`MergeLedgerSubscriber` handles `PatientsMerged` **in the merge transaction**
(`@OnDomainEventInTransaction`), which already holds both patients `FOR UPDATE`. In order:

1. the two accounts' advisory locks, in patient id order (`Settlement.lock`), after the patient
   locks — the order every ledger writer uses;
2. every entry and every payment of the dropped patient moves to the kept one;
3. when anything moved: audit `ledger_entry.repoint` (resource type `patient`, resource id = the
   kept patient, after `{ droppedId, keptId, count, payments }`, the merging user as the actor),
   then a settle of the kept account (P15: the credit of one side meets the open charges of the
   other).

The kept patient's balance is right when the merge answers; a failure rolls the merge back. A
ledger write holds the patient `FOR SHARE`, so one in flight commits first and is moved, and one
that arrives later finds the patient merged (409 `patient.merged`). A merge chain (A into B, then
B into C) needs nothing more: each merge re-points in its own transaction. Not permission-gated:
the merge already required `patient:write`.

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
| `POST /billing/opening-balances`             | `payment:write`  | Requires `Idempotency-Key`. Body `{ patient, openingBalance }`; `patient` is the patients create schema, so its `contacts` and `linkContactId` are applied in the same transaction (errors under `patient.`). The service also requires `patient:write`. 201 `{ patient, balance }`.                                                     |
| `GET /billing/balances?patientIds=`          | `payment:read`   | 1–100 comma-separated ids, de-duplicated. 200 `PatientBalance[]`.                                                                                                                                                                                                                                                                        |
| `GET /billing/patients/:id/balance`          | `payment:read`   | 200 `{ patientId, balances, charged }`.                                                                                                                                                                                                                                                                                                  |
| `POST /billing/patients/:id/adjustments`     | `payment:refund` | Requires `Idempotency-Key`. Body `{ amount, effectiveDate, reason, note? }`. 201 with the balance.                                                                                                                                                                                                                                       |
| `GET /billing/currency-lock`                 | `tenant:read`    | 200 `{ locked, currency }`.                                                                                                                                                                                                                                                                                                              |
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
  - `PatientsMerged { keptId, droppedId }` (from `patients`), **in the merge transaction**, to
    re-point the dropped patient's entries and payments (ADR-0036).
  - `TenantCurrencyChanged { from, to }` (from `tenancy`), **in the settings transaction**, to
    refuse a currency change once there is money (ADR-0035).
  - `VisitCompleted { visitId, patientId, currency, total, localDate }` (from `clinical`),
    **in the completion's transaction**, to post the visit charge (ADR-0024).
  - `VisitAmended` and `VisitVoided` (from `clinical`), **in the amend or void transaction**, to
    post the adjustment or the reversal, or to veto the void (ADR-0025, ADR-0026).

## Depends on

- `patients`: existence checks (`getMany`), the export's rows and guardian columns
  (`listItemsByIds`, design addendum C14, resolved per C7), the ledger-write lock
  (`lockForDependentWrite`), `create` for the opening-balance create (contacts and
  `linkContactId` included), `search` and `searchIds` with their internal options for the patient
  views and the export; the `PatientsMerged` event.
- `tenancy`: currency, time zone and country (`currentTenant`); the `TenantCurrencyChanged`
  event.
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
- `payment:refund` (refund and void a payment; adjust a balance, feature 7): owner, dentist.
- A platform admin acting in the tenant holds both.
- Completing a visit needs no `payment:*` permission (ADR-0024), but it does need `visit:read` and
  `patient:read` on top of `visit:write`: `VisitChargeSubscriber` calls `VisitsService.chargeFacts`
  (`visit:read`) and `PatientsService.lockForDependentWrite` (`patient:read`) inside `complete`'s
  own transaction, so a completer missing either would fail the completion partway through, not
  just the charge. Every system role that holds `visit:write` (owner, dentist, assistant) also
  holds both (`docs/modules/roles.md`'s matrix), so this never surfaces in practice; it matters
  only if a future custom role grants `visit:write` without them.
