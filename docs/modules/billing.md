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

## Public API (`index.ts`)

`BillingModule`, `BillingService`, and the event name and type (`LEDGER_ENTRY_RECORDED`,
`LedgerEntryRecorded`).

`BillingService`: inputs are the contract's Zod output, and results are plain data.

| Method                                                               | Access                            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createWithOpeningBalance({ patient, openingBalance })`              | `payment:write` + `patient:write` | One `TenantDb` transaction. `asOf` is checked before anything is written (path `openingBalance.asOf`). Then `PatientsService.create` and the `opening_balance` entry; the new patient is not re-read. The patient, its display number, both audit entries and both events commit or roll back together. The patient's field errors come back under `patient.` (e.g. `patient.phone`). Returns `{ patient, balance }`. |
| `recordOpeningBalance(patientId, { amount, asOf, note? })`           | `payment:write`                   | A building block for the feature 6 import. Checks `asOf` (path `asOf`) and locks the patient. Unknown patient → 404 `patient.not_found`; merged away → 409 `patient.merged`. Returns the patient's balance.                                                                                                                                                                                                           |
| `adjustBalance(patientId, { amount, effectiveDate, reason, note? })` | `payment:write`                   | The amount is signed and non-zero. A reason is required and is written to the entry and the audit entry. Locks the patient: unknown → 404, merged away → 409 `patient.merged`, archived allowed. Returns the balance after the entry. There is no UI for it in feature 3.                                                                                                                                             |
| `balanceOf(patientId)`                                               | `payment:read`                    | `{ patientId, balances }`. Unknown patient → 404.                                                                                                                                                                                                                                                                                                                                                                     |
| `balancesFor(patientIds)`                                            | `payment:read`                    | Returned in input order, de-duplicated. Ids the tenant can't see are omitted. Patients without entries get `balances: []`. One aggregate query for all ids.                                                                                                                                                                                                                                                           |
| `patientIdsOwing()`                                                  | `payment:read`                    | Ids of the patients owing in any currency, archived ones included, in id order. One SQL aggregate. A building block for `billing`'s patient views.                                                                                                                                                                                                                                                                    |
| `repointMergedEntries(keptId, droppedId)`                            | none (job only)                   | The merge re-point, run by `MergeLedgerWorker` (see below). Refuses to run outside a job or system task. Returns the number of entries moved.                                                                                                                                                                                                                                                                         |

Every write records the entry and audits `ledger_entry.create` (resource type `ledger_entry`,
after = the entry, reason for adjustments) in the same transaction. It emits
`LedgerEntryRecorded` after commit.

Patient existence comes from `PatientsService` (`getMany`, `lockForLedger`), which requires
`patient:read`. In
practice, reads and writes here need `patient:read` as well as the `payment:*` permission. Every
system role holds it.

### Patient views (`application/patient-views.service.ts`)

Internal to the module (not exported); `http/billing-patients.controller.ts` and the export use
it. Every method requires `payment:read`, and `PatientsService.search` re-checks
`patient:read`. The query is `PatientListQuery`, the same as `GET /patients`, and the result the
same offset page (ADR-0018).

| Method               | Notes                                                                                                                                                                                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `list(query)`        | `view=owing` → the active view restricted to `patientIdsOwing()` (`search`'s internal `idsIn`). `sort=balance` → `search`'s internal `rank` from `rankByBalance` over every non-zero tenant-currency balance (`sumsInCurrency`); works with every view, `owing` included, and with `q` and the filters. Any other query is passed through. |
| `owingCount()`       | The active patients owing in any currency (the tab chip): `search`'s total over the owing ids.                                                                                                                                                                                                                                             |
| `pages(query, size)` | Every patient of a view, `size` (≤ 500) at a time, in the view's order. The owing ids and the balance rank are computed once for the whole walk; each page is its own read, so rows written meanwhile may shift across pages (ADR-0018).                                                                                                   |

### CSV export (`application/patient-export.service.ts`)

`stream(query, labels)` requires `payment:read` and `patient:read`. It yields the file in chunks:
the UTF-8 byte order mark (for Excel and Arabic), the header row and the first page, then one
chunk per page of 500. Nothing runs before the first chunk is pulled, which is where the
permission checks and the first read fail.

- **Rows:** `ids` (1–100) → exactly those patients, in that order, archived ones included; ids the
  tenant can't see are skipped. Otherwise every patient of the filtered and sorted view
  (`pages`, `owing` and `balance` included).
- **Columns** (the table's order): Patient ID (display number), Name, Age (whole years on the
  tenant's today; empty without a date of birth), Sex (localised; `unknown` is empty), Phone
  (international format, `formatPhone`), Last visit and Visits (empty until visits exist,
  feature 4), Dentist (display name from `UsersService.practitionersByIds`, inactive dentists
  included), Balance (`<label> (<tenant currency>)`: the tenant-currency amount as a plain
  decimal, `0.00` when none). Balances in another currency (after a tenant currency change) are
  not in the file.
- **Format** (`domain/csv.ts`): RFC 4180 quoting (a cell with a comma, quote, CR or LF is quoted,
  quotes doubled) and CRLF line ends. CSV injection guard: a cell starting with `=`, `+`, `-`,
  `@`, tab or CR is prefixed with `'`, except a decimal string in a numeric column (Age, Visits,
  Balance — so a credit is `-50.00`). Phones start with `+`, so they are written as
  `'+961 71 123 456`: unguarded, a spreadsheet would evaluate them as a formula.
- **Language** (`http/export-headers.ts`): the header and the sex values in `en`, `ar` or `fr`,
  from `Accept-Language` (the supported primary tag with the highest quality; `en` otherwise).

### Merge re-point (design Q9, ADR-0017)

- `MergeLedgerSubscriber` handles `PatientsMerged` (dispatched after the merge commits). In the
  event's context (tenant, actor, request id) it enqueues `merge-ledger` on the `billing` queue
  with `{ keptId, droppedId }` and job id `merge_<droppedId>` (tenant-prefixed by `TenantJobs`),
  so a repeated event enqueues nothing new. A failed enqueue is logged with ids only and not
  rethrown, so the audit subscriber still records the event.
- `MergeLedgerWorker` (a `TenantWorker`: the job's tenant, actor kind `job`, the merging user as
  the actor user) calls `repointMergedEntries`. One transaction moves every entry of the dropped
  patient to the kept one and, when anything moved, audits `ledger_entry.repoint` with resource
  type `patient`, resource id = the kept patient (so it shows in that patient's history), after
  `{ droppedId, count }`. Idempotent; retried with backoff, then dead-lettered (CLAUDE.md §9).
- Ledger writes hold the patient row `FOR SHARE` and a merge locks it `FOR UPDATE`, so an entry
  written during a merge commits first and the job moves it too.
- A crash between the merge commit and the enqueue skips the re-point: the after-commit window
  documented in ADR-0017. Recovery is enqueueing the job again.

### Pure rules (`domain/`)

- `sumBalances(entries)`: Σ per currency on integer cents. Zero sums are dropped and the result
  is ordered by currency code.
- `rankByBalance(patients, dir, tenantCurrency)` → `{ ids, keys, restKey }`: the keys for
  `PatientsService.search`'s rank ordering (ascending key, then name, then id), using the
  tenant-currency amount only (other currencies count as zero). A dense rank over the distinct
  amounts, zero included:
  - `desc`: debts, largest first (keys `1..p`); everyone else (zero or no balance) at
    `restKey = p + 1`; then credits, least negative first.
  - `asc`: the mirror image: credits, most negative first; the rest; debts, smallest first.
  - Equal amounts share a key, so the search orders them by name. `ids` holds only the patients
    with a non-zero balance.
- `csvRow(cells, { numericColumns })` (`csv.ts`): one CSV line with the quoting and injection
  guard above.

## HTTP

| Route                                    | Access          | Notes                                                                                                                                                                                                                                       |
| ---------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /billing/opening-balances`         | `payment:write` | Body `{ patient, openingBalance }`; the service also requires `patient:write`. 201 `{ patient, balance }`.                                                                                                                                  |
| `GET /billing/balances?patientIds=`      | `payment:read`  | 1–100 comma-separated ids, de-duplicated. 200 `PatientBalance[]`.                                                                                                                                                                           |
| `GET /billing/patients/:id/balance`      | `payment:read`  | 200 `{ patientId, balances }`.                                                                                                                                                                                                              |
| `POST /billing/patients/:id/adjustments` | `payment:write` | Body `{ amount, effectiveDate, reason, note? }`. 201 with the balance.                                                                                                                                                                      |
| `GET /billing/patients`                  | `payment:read`  | The `GET /patients` query (`view=owing` and `sort=balance` included). 200 `PatientPage`. The service also requires `patient:read`.                                                                                                          |
| `GET /billing/patients/owing-count`      | `payment:read`  | 200 `{ count }` (`owingCountSchema`). The service also requires `patient:read`.                                                                                                                                                             |
| `GET /billing/patients/export`           | `payment:read`  | The list query without `page`/`size`, plus `ids?` (1–100). 200 `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="patients-<tenant's today>.csv"`, `Cache-Control: no-store`. The service also requires `patient:read`. |

The patient-views routes live in `http/billing-patients.controller.ts`, registered before
`billing.controller.ts`. They are static two-segment paths, and the routes above that take an id
all have three segments under `patients/` (`:id/balance`, `:id/adjustments`), so neither
captures the other. If a two-segment `patients/:id` route is ever added, it must come after the
static paths.

The export is written by the handler itself (`@Res()`, Express types stay in `http/`): it pulls
the first chunk before setting any header, so a refused permission or a failed first read is
still an RFC 7807 problem; after that a failure can only abort the download (logged). The handler
pulls the chunks in its own loop and waits for `drain` when the socket buffer is full
(backpressure). It does not pipe a `Readable`: stream callbacks run outside the request's async
context, where the tenant (CLS) is unknown.

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

- `patients`: existence (`getMany`), the ledger-write lock (`lockForLedger`), `create` for the
  opening-balance create, and `search` with its internal options for the patient views and the
  export; the `PatientsMerged` event.
- `tenancy`: currency and time zone (`currentTenant`).
- `users`: dentist display names in the export (`practitionersByIds`).
- `audit`.

None of them imports `billing` (ADR-0017).

`clinical` joins in feature 5 (CLAUDE.md §4).

## Permissions

- `payment:read`: owner, dentist, assistant, front desk.
- `payment:write`: owner, dentist, front desk. The assistant does not have it.
- A platform admin acting in the tenant holds both.
