# `billing` module

**Status:** implemented for feature 3: the patient ledger, opening balances, adjustments,
balances, the patient views that need a balance (Owes balance, sort by balance, CSV export) and
the job that moves ledger entries after a patient merge. Invoices, payments and price lists come
later.

## Purpose

What a patient owes. In feature 3 that is a ledger of signed entries: the opening balance a
patient carries over from a previous system, and adjustments. The balance is the sum of the
entries in each currency (design Q13). `billing` depends on `patients`; `patients` never imports
`billing` (design Q1), so the Patients list views that need a balance are composed here, on top
of `PatientsService.search` (design Q4, Q5; ADR-0017).

- **Money:** `numeric(12,2)` plus a `currency` (CLAUDE.md §7). Positive means the patient owes;
  negative is a credit. Amounts travel as decimal strings and are summed exactly: by Postgres on
  `numeric`, then by `domain/balances.ts` on integer cents (`bigint`). Floats are never used.
  Inputs are bounded by one `numeric(12,2)` (`decimalAmountSchema`, 10 integer digits), but a
  sum can be wider: balances use `balanceMoneySchema` (`balanceAmountSchema`: up to 18 integer
  digits, always 2 decimals).
- **Currency:** each entry gets the tenant currency at write time. Changing the tenant currency
  converts nothing (ADR-0015). A patient can therefore have balances in several currencies:
  `balances` lists each non-zero one, ordered by currency code, and `[]` when there are none.
- **Owing:** any currency's balance is positive. It is evaluated in SQL (`group by patient_id,
currency having sum(amount) > 0`).
- **Dates:** `asOf` (opening balance) and `effectiveDate` (adjustment) must not be after the
  tenant's today, computed from the injected clock in the tenant time zone. The contract only
  rejects dates that are obviously in the future. The service is the source of truth: a later
  date → 422 `validation_failed` at that path.
- **Opening balance only on create** is enforced by the route (`POST /billing/opening-balances`
  creates the patient). The schema does not enforce it: a merge moves both records' opening
  balances onto the kept patient (design Q12).
- **Locking against merges:** every ledger write first calls `PatientsService.lockForLedger`,
  which reads the patient `FOR SHARE` in the same transaction as the insert. A merge locks both
  records `FOR UPDATE`, so it waits for in-flight ledger writes, and the re-point job then finds
  their entries. A merged-away patient refuses new entries: 409 `patient.merged` (the entry
  belongs on the kept record). An archived patient that was not merged accepts them, for
  example to write off a debt.

## Owns

- `ledger_entries` (tenant RLS): `id`, `tenant_id`, `patient_id`, `kind` (`ledger_entry_kind`
  enum: `opening_balance`, `adjustment`), `amount numeric(12,2)` (signed; check `amount <> 0`),
  `currency char(3)`, `effective_date date`, `note?`, `reason?`, `created_by` (the actor's auth
  user id), timestamps.
  - `patient_id` has no foreign key, because `patients` owns that table. Existence is always
    checked through `PatientsService`: `lockForLedger` for writes, `getMany` for reads.
  - Indexes: `tenant_id`, and `(tenant_id, patient_id)`.
  - Entries are never edited or deleted. The merge job is the only writer that updates a row,
    and it changes `patient_id` (and `updated_at`) only; `created_by` and the amount stay.
    Enforced by grants (migration `0011_ledger_append_only`, like `audit_log`): the runtime roles
    have no `DELETE` or `TRUNCATE`, and only `dcm_app` may `UPDATE`, on those two columns.

## Public API (`index.ts`)

`BillingModule`, `BillingService`, and the event name and type (`LEDGER_ENTRY_RECORDED`,
`LedgerEntryRecorded`).

`BillingService`: inputs are the contract's Zod output, and results are plain data.

| Method                                                               | Access                            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createWithOpeningBalance({ patient, openingBalance })`              | `payment:write` + `patient:write` | One `TenantDb` transaction. `asOf` is checked before anything is written (path `openingBalance.asOf`). Then `PatientsService.create`, which is `patient`'s whole create schema — including `contacts` (linked in the same transaction, design addendum C4) and `linkContactId` — and the `opening_balance` entry; the new patient is not re-read. The patient, its display number, any contact links, and the `opening_balance` entry, with their audit entries and events, commit or roll back together (a failed link or a failed entry leaves nothing: no patient, no contact, no link, no entry, and the display-number counter is not advanced). The patient's field errors (contacts included) come back under `patient.` (e.g. `patient.phone`, `patient.contacts.0.target.contactId`, `patient.linkContactId`). Returns `{ patient, balance }`. |
| `recordOpeningBalance(patientId, { amount, asOf, note? })`           | `payment:write`                   | A building block for the feature 6 import. Checks `asOf` (path `asOf`) and locks the patient. Unknown patient → 404 `patient.not_found`; merged away → 409 `patient.merged`. Returns the patient's balance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `adjustBalance(patientId, { amount, effectiveDate, reason, note? })` | `payment:write`                   | The amount is signed and non-zero. A reason is required and is written to the entry and the audit entry. Locks the patient: unknown → 404, merged away → 409 `patient.merged`, archived allowed. Returns the balance after the entry. There is no UI for it in feature 3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `balanceOf(patientId)`                                               | `payment:read`                    | `{ patientId, balances }`. Unknown patient → 404.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `balancesFor(patientIds)`                                            | `payment:read`                    | Returned in input order, de-duplicated. Ids the tenant can't see are omitted. Patients without entries get `balances: []`. One aggregate query for all ids.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `patientIdsOwing()`                                                  | `payment:read`                    | Ids of the patients owing in any currency, archived ones included, in id order. One SQL aggregate. A building block for `billing`'s patient views.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `repointMergedEntries(keptId, droppedId)`                            | none (job only)                   | The merge re-point, run by `MergeLedgerWorker` (see below): moves the dropped patient's entries to the kept patient's survivor. Refuses to run outside a job or system task. Returns the number of entries moved.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

Every write records the entry and audits `ledger_entry.create` (resource type `ledger_entry`,
after = the entry, reason for adjustments) in the same transaction. It emits
`LedgerEntryRecorded` after commit.

Patient existence comes from `PatientsService` (`getMany`, `lockForLedger`), which requires
`patient:read`. In
practice, reads and writes here need `patient:read` as well as the `payment:*` permission. Every
system role holds it.

### Patient views (`application/patient-views.service.ts`)

Internal to the module (not exported); `http/billing-patients.controller.ts` and the export use
it. Every method requires `payment:read`, and `PatientsService.search`/`searchIds` re-check
`patient:read`. The query is `PatientListQuery`, the same as `GET /patients`, and the result the
same offset page (ADR-0018).

| Method          | Notes                                                                                                                                                                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list(query)`   | `view=owing` → the active view restricted to `patientIdsOwing()` (`search`'s internal `idsIn`). `sort=balance` → `search`'s internal `rank` from `rankByBalance` over every non-zero tenant-currency balance (`sumsInCurrency`); works with every view, `owing` included, and with `q` and the filters. Any other query is passed through. |
| `owingCount()`  | The active patients owing in any currency (the tab chip): `search`'s total over the owing ids.                                                                                                                                                                                                                                             |
| `idsFor(query)` | Every patient id of a view (the list query without paging), in the view's order, unpaged (`PatientsService.searchIds`, same owing/balance handling). The export's snapshot. Bounded by the tenant's patient count (ADR-0018).                                                                                                              |

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

| Route                                    | Access          | Notes                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /billing/opening-balances`         | `payment:write` | Body `{ patient, openingBalance }`; `patient` is the patients create schema, so its `contacts` and `linkContactId` are applied in the same transaction (errors under `patient.`). The service also requires `patient:write`. 201 `{ patient, balance }`.                                                                                 |
| `GET /billing/balances?patientIds=`      | `payment:read`  | 1–100 comma-separated ids, de-duplicated. 200 `PatientBalance[]`.                                                                                                                                                                                                                                                                        |
| `GET /billing/patients/:id/balance`      | `payment:read`  | 200 `{ patientId, balances }`.                                                                                                                                                                                                                                                                                                           |
| `POST /billing/patients/:id/adjustments` | `payment:write` | Body `{ amount, effectiveDate, reason, note? }`. 201 with the balance.                                                                                                                                                                                                                                                                   |
| `GET /billing/patients`                  | `payment:read`  | The `GET /patients` query (`view=owing` and `sort=balance` included). 200 `PatientPage`. The service also requires `patient:read`.                                                                                                                                                                                                       |
| `GET /billing/patients/owing-count`      | `payment:read`  | 200 `{ count }` (`owingCountSchema`). The service also requires `patient:read`.                                                                                                                                                                                                                                                          |
| `GET /billing/patients/export`           | `payment:read`  | The list query without `page`/`size`, plus `ids?` (1–100) and `lang?` (`en`/`ar`/`fr`, overrides `Accept-Language`). 200 `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="patients-<tenant's today>.csv"`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`. The service also requires `patient:read`. |

The patient-views routes live in `http/billing-patients.controller.ts`, registered before
`billing.controller.ts`. They are static two-segment paths, and the routes above that take an id
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

- No `Idempotency-Key` on the money mutations yet (CLAUDE.md §12: mutations clients may retry,
  such as payments, accept one). A retried `POST /billing/opening-balances` or adjustment
  records twice. This is platform infrastructure, to be added with payments (feature 5).

## Events

- Emits (after commit; the generic audit subscriber records each one):
  `LedgerEntryRecorded { entryId, patientId, kind }`.
- Consumes: `PatientsMerged { keptId, droppedId }` (from `patients`), to re-point the dropped
  patient's entries through the `merge-ledger` job (design Q9).

## Jobs

- Queue `billing`, job `merge-ledger`, payload `{ keptId, droppedId }`, job id
  `merge_<droppedId>` (BullMQ refuses `:` in custom ids). Default retries and backoff
  (`platform/queue`), dead-lettered on the last failure.

## Depends on

- `patients`: existence checks (`getMany`), the export's rows and guardian columns
  (`listItemsByIds`, design addendum C14, resolved per C7), the ledger-write lock
  (`lockForLedger`), `create` for the opening-balance create (contacts and `linkContactId`
  included), `search` and `searchIds` with their internal options for the patient views and the
  export, `survivorOf` for the merge re-point; the `PatientsMerged` event.
- `tenancy`: currency, time zone and country (`currentTenant`).
- `users`: dentist display names in the export (`practitionersByProfileIds`, by staff profile
  id).
- `audit`.

None of them imports `billing` (ADR-0017).

`clinical` joins in feature 5 (CLAUDE.md §4).

## Permissions

- `payment:read`: owner, dentist, assistant, front desk.
- `payment:write`: owner, dentist, front desk. The assistant does not have it.
- A platform admin acting in the tenant holds both.
