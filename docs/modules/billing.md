# `billing` module

**Status:** partly implemented. The patient ledger, opening balances, adjustments and balances are
done (feature 3). The patient views that need a balance (`GET /billing/patients`, the owing
count, CSV export) and the job that moves ledger entries after a patient merge arrive in the next
task. Invoices, payments and price lists come later.

## Purpose

What a patient owes. In feature 3 that is a ledger of signed entries: the opening balance a
patient carries over from a previous system, and adjustments. The balance is the sum of the
entries in each currency (design Q13). `billing` depends on `patients`; `patients` never imports
`billing` (design Q1).

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
  - Entries are never edited or deleted. The merge job (next task) will be the only writer that
    updates a row, and it will change `patient_id` only.

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

Every write records the entry and audits `ledger_entry.create` (resource type `ledger_entry`,
after = the entry, reason for adjustments) in the same transaction. It emits
`LedgerEntryRecorded` after commit.

Patient existence comes from `PatientsService` (`getMany`, `lockForLedger`), which requires
`patient:read`. In
practice, reads and writes here need `patient:read` as well as the `payment:*` permission. Every
system role holds it.

### Pure rules (`domain/balances.ts`)

- `sumBalances(entries)`: Σ per currency on integer cents. Zero sums are dropped and the result
  is ordered by currency code.
- `rankByBalance(patients, dir, tenantCurrency)` → `{ ids, restAt }`: the order of "sort by
  balance", using the tenant-currency amount only (other currencies count as zero).
  - `desc`: debts, largest first; then everyone else; then credits, least negative first.
  - `asc`: the mirror image.
  - Ties keep input order, so passing patients in name order breaks ties by name.
  - `ids` holds only the patients with a non-zero balance.
  - `restAt` is a **0-based insertion index**: everyone else sorts strictly between
    `ids[restAt - 1]` and `ids[restAt]`.
  - Note for the patient-views task: `PatientsService.search`'s `rank.restAt` is a 1-based
    `array_position` value, and it ties with the id at that position. `restAt: k` there would mix
    the rest with `ids[k - 1]`. The view has to bridge this. One option is to make the patients
    rank key fractional or doubled. The other is a sentinel id at the gap.

## HTTP

| Route                                    | Access          | Notes                                                                                                      |
| ---------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------- |
| `POST /billing/opening-balances`         | `payment:write` | Body `{ patient, openingBalance }`; the service also requires `patient:write`. 201 `{ patient, balance }`. |
| `GET /billing/balances?patientIds=`      | `payment:read`  | 1–100 comma-separated ids, de-duplicated. 200 `PatientBalance[]`.                                          |
| `GET /billing/patients/:id/balance`      | `payment:read`  | 200 `{ patientId, balances }`.                                                                             |
| `POST /billing/patients/:id/adjustments` | `payment:write` | Body `{ amount, effectiveDate, reason, note? }`. 201 with the balance.                                     |

Path layout for the next task: `GET /billing/patients`, `/billing/patients/owing-count` and
`/billing/patients/export` will live in a second controller. They cannot be swallowed by the
routes above, which all have three segments under `patients/` (`:id/balance`,
`:id/adjustments`). If a two-segment `patients/:id` route is ever added, declare the static paths
first. Across controllers, that means registering the patient-views controller first.

## Known gaps

- No `Idempotency-Key` on the money mutations yet (CLAUDE.md §12: mutations clients may retry,
  such as payments, accept one). A retried `POST /billing/opening-balances` or adjustment
  records twice. This is platform infrastructure, to be added with payments (feature 5).

## Events

- Emits (after commit; the generic audit subscriber records each one):
  `LedgerEntryRecorded { entryId, patientId, kind }`.
- Consumes: none yet. The next task consumes `PatientsMerged` to re-point entries (design Q9).

## Depends on

- `patients`: existence (`getMany`), the ledger-write lock (`lockForLedger`), and `create` for
  the opening-balance create.
- `tenancy`: currency and time zone (`currentTenant`).
- `audit`.

`clinical` joins in feature 5 (CLAUDE.md §4).

## Permissions

- `payment:read`: owner, dentist, assistant, front desk.
- `payment:write`: owner, dentist, front desk. The assistant does not have it.
- A platform admin acting in the tenant holds both.
