# Feature 5 — Payments, refunds, receivables and printables — design

Date: 2026-10-02 · Status: Implemented (2026-10-02); see §Implementation notes for the
changes made while building it

## Goal

Staff take payments on a patient's **account** (never on a visit), refund or void them, see
receivables on `/payments`, and print receipts, invoices, statements and plan quotes. Balance
stays `Σ ledger`; allocations are a stored, derived explanation of which charges each credit
covered, used for per-visit Paid/Unpaid, aging and receipts.

References: the feature 5 prompt (B1–B11), `Dental Clinic POC/Payments.dc.html`,
`Invoice.dc.html`, `clinical-workspace-spec.md` §Record Payment, §Payment allocation,
§Balance & payments. The POC is a guide; the decisions below win.

Owner module: `billing`. No new dependency edge (`billing` already depends on `patients`,
`clinical`, `tenancy`, `users`). `clinical` is unchanged: the void veto already exists (ADR-0026).

**Out of scope:** email/SMS of documents, reminders ("Send reminder" not rendered), insurance
claims, multi-currency payments, RTL printables, cash drawer / end-of-day, configurable
allocation order, stored quotes, scheduling.

## Decisions

| #   | Topic             | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | Account model     | A payment is a ledger credit on the patient. Balance = Σ ledger entries (unchanged). Cap: amount ≤ the tenant-currency balance (> 0).                                                                                                                                                                                                                                                                                                                                                                                                            |
| P2  | Targets & sources | **Targets** (what can be paid): `opening_balance` > 0, `adjustment` > 0, `visit_charge` (netted with its visit corrections). **Sources** (what pays): `payment`, `adjustment` < 0 (write-off), `opening_balance` < 0. Allocation rows link a source entry to a target entry. Only same-currency pairs (tenant currency).                                                                                                                                                                                                                         |
| P3  | Order             | Payment: (1) manual target (B4), capped at its outstanding; (2) `contextVisitId`'s charge; (3) open targets oldest first by date (opening balance `asOf`, adjustment `effectiveDate`, charge `effectiveDate`; ties by `created_at`, id). The patient-record panel has no context visit (prompt wins over the POC's "most recent first").                                                                                                                                                                                                         |
| P4  | Settle            | One routine, `settle(patient)`, runs in the transaction of every ledger write: (a) a target whose net fell below its allocations releases the excess, newest allocation first; (b) every source with unallocated money is applied to open targets per P3 (sources oldest first). Hence credit is applied **immediately** to existing open charges, and to any later charge (B3, Q2). Applying credit emits `CreditApplied`.                                                                                                                      |
| P5  | Credit            | Credit = Σ unallocated source amounts; shown as a negative balance ("Credit $40"). Only payment-sourced credit is refundable; write-off credit just waits for the next charge.                                                                                                                                                                                                                                                                                                                                                                   |
| P6  | Refund            | `payment:refund`. Amount ≤ payment − prior refunds; several partial refunds allowed. Reason required; method defaults to the original; date ≤ today. Releases the payment's unallocated part first, then its allocations **proportionally** (cents by largest remainder). Visits reopen. Ledger `payment_refund` (+amount). Receipt shows "Refunded $X on …".                                                                                                                                                                                    |
| P7  | Void              | `payment:refund`, mis-entries only: whole payment, no prior refunds, reason required. Ledger `payment_void` (+amount), all allocations released. Excluded from Collected; listed muted. A household receipt is voided as a whole (every row).                                                                                                                                                                                                                                                                                                    |
| P8  | Visit void guard  | Unchanged code `visit.has_payments` (4b already ships it and the "Refund payments first" dialog). `paidOn(visitId)` = Σ **payment-sourced** allocations on the visit charge. Write-off allocations on a voided charge are released by settle. The dialog links to the patient's Balance & payments tab.                                                                                                                                                                                                                                          |
| P9  | Household         | The payer = the patient's primary billing contact (null = the patient). If that contact bills for more than one patient, or is a patient with a balance, the panel offers **Pay for: this patient / household (n · total)**. Household = the payer's own patient record (if linked and owing) + `patientsBilledBy(contact)`. One payment row per patient with a balance taken, sharing one receipt number and `household_group_id`; split by P3 across all their targets oldest first (context visit first). Refund per row.                     |
| P10 | Numbers           | `RCT-` + 6-digit per-tenant sequence (`payment_counters`, minted like `visit_counters`); shared by a household group. Invoice = `INV-` + the visit number digits. Quote = `EST-<patient no.>-<YYYYMMDD>`, not stored (Q3).                                                                                                                                                                                                                                                                                                                       |
| P11 | Idempotency       | `POST /billing/payments` requires an `Idempotency-Key` header (uuid). It is stored on the payment (unique per tenant): a replay returns the original result, a different body under the same key → 409 `payment.idempotency_mismatch`.                                                                                                                                                                                                                                                                                                           |
| P12 | Dates             | `paidAt` is a date, ≤ tenant today, may be back-dated. KPI windows and the transactions date filter use it.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P13 | Aging             | Each open target's remainder, aged from its date on the tenant's today: 0–30 / 31–60 / 61–90 / 90+. A patient's bucket = their oldest unpaid remainder; the Outstanding bucket filter uses that.                                                                                                                                                                                                                                                                                                                                                 |
| P14 | KPIs              | Collected 30d = Σ payments (not voided) with `paidAt` in the last 30 days; Refunds 30d = Σ refunds; Outstanding = Σ positive patient balances. Tenant-wide (all branches). Payments store the recording branch for later reports.                                                                                                                                                                                                                                                                                                                |
| P15 | Merge             | The existing merge job also re-points `payments.patient_id` and then settles the kept patient (credit meets open charges). Allocations follow their entries.                                                                                                                                                                                                                                                                                                                                                                                     |
| P16 | Printables        | A4, LTR, browser print stylesheet, rendered by SPA routes outside the app shell (`/print/...`). Clinic block from tenant + active branch; patient + primary billing contact. Receipt per receipt number (household split listed); Invoice per visit (lines, discount, total, allocations, balance; "VOID" when voided); Statement per patient (all time: opening balance, charges, corrections, payments, refunds, running balance, outstanding); Quote from the patient's open plans (prices as planned, 60-day validity, two signature lines). |

## Data model (migrations 0023–0024)

`0023`: `ledger_entry_kind` gains `payment`, `payment_refund`, `payment_void` (own migration:
enum literals can't be used in the transaction that adds them).

`0024`:

- `payments` (RLS, append-only grants like `ledger_entries`): `id`, `tenant_id`, `patient_id`
  (no FK), `kind` enum `payment | refund | void`, `amount numeric(12,2) > 0`, `currency`,
  `method` enum `cash | card | bank_transfer | insurance`, `paid_at date`, `reference?`, `note?`,
  `reason?` (required for refund/void), `receipt_number int?` (payments only), `household_group_id
uuid?`, `payer_contact_id uuid?`, `reverses_payment_id uuid?` (refund/void → payment, FK
  composite), `ledger_entry_id` (FK, unique), `idempotency_key uuid?` (unique per tenant),
  `branch_id`, `recorded_by`, timestamps. Checks: kind ↔ reverses/reason/receipt. `patient_id` is
  the only column the merge job may update.
- `payment_counters (tenant_id pk, next_number)`.
- `payment_allocations` (RLS, append-only): `id`, `tenant_id`, `source_entry_id`,
  `target_entry_id` (both FK → `ledger_entries`), `amount numeric(12,2) <> 0` (negative =
  release), `kind` enum `allocation | credit_applied | release`, `manual bool`, `payment_id?`
  (the refund/void that caused a release), timestamps. Indexes on source and target. Named
  `payment_allocations` per the prompt although write-offs are sources too.

Invariants (asserted in the domain and the integration spec): per target `0 ≤ Σ alloc ≤ net`;
per source `0 ≤ Σ alloc ≤ |amount| − refunded`; Σ target outstanding − Σ source unallocated =
balance.

## Domain (`billing/domain/`)

- `allocate.ts` — pure: `allocatePayment({ amount, targets, contextTargetId?, manualTargetId? })`
  and `settle({ targets, sources, allocations })` → new allocation rows. Integer cents. Exhaustive
  specs: partial, exact, over cap, context visit, manual cap + remainder, voided/zero-net
  targets skipped, corrections netted, release on amend down, credit immediate and on next
  charge, write-off sources, ordering ties, household split.
- `allocate.ts` also holds `refundReleases` — credit first, then proportional release with
  largest-remainder cents.
- `aging.ts` — buckets from remainders and dates.
- `running-balance.ts` — the running Remaining and the statement's balance (charges dated on or
  before a payment, then payments up to it; a voided payment and its void add nothing).

## Application (`billing/application/`)

`PaymentsService` (new, exported via `index.ts` only as needed by tools later):

| Method                                                      | Access           | Notes                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preview(input)`                                            | `payment:write`  | Dry run of `record`: allocations per patient, remaining, cap. No lock, no write.                                                                                                                                                                                                                                                    |
| `record(input, idempotencyKey)`                             | `payment:write`  | One transaction: per-patient lock (`lockForDependentWrite` + `SELECT … FOR UPDATE` on the patient's ledger rows, sorted by patient id for households), cap check (422 `payment.over_outstanding`, `payment.nothing_outstanding`), mint receipt, ledger `payment` entry, allocations, settle, audit, `PaymentRecorded` after commit. |
| `refund(paymentId, input)` / `void(paymentId, input)`       | `payment:refund` | 409 `payment.over_refund`, `payment.already_voided`, `payment.has_refunds`; settle after; `PaymentRefunded` / `PaymentVoided`.                                                                                                                                                                                                      |
| `transactions(query)` / `exportTransactions(query, labels)` | `payment:read`   | Cursor on `(paid_at desc, created_at desc, id)`; filters: date range, method, kind, q (patient name / receipt). CSV like the visits export.                                                                                                                                                                                         |
| `receivables()`                                             | `payment:read`   | KPIs + aging buckets (`GET /billing/aging`).                                                                                                                                                                                                                                                                                        |
| `outstanding(query)`                                        | `payment:read`   | Patients with a positive balance: oldest unpaid date, open visit count, bucket, balance; cursor on (oldest unpaid, patient id); bucket filter.                                                                                                                                                                                      |
| `account(patientId)`                                        | `payment:read`   | Balance card figures, credit, open targets (for B4), payer + household summary, payment history with Remaining and allocations.                                                                                                                                                                                                     |
| `receipt(paymentId)` / `statement(patientId)`               | `payment:read`   | Printable data.                                                                                                                                                                                                                                                                                                                     |

`LedgerWriter` callers (`adjustBalance`, opening balance, visit charge subscriber) call `settle`
after their insert. `paidOn` reads payment-sourced allocations. `balancesForVisits`,
`visitSummary`, `visitIdsOwing` subtract allocations (paid = Σ allocations, outstanding = net −
paid).

## Contracts and routes

`packages/contracts/src/payments.ts`: inputs/outputs above, `PAYMENT_METHODS`, `PAYMENT_KINDS`,
aging buckets, error codes. Permissions unchanged (catalog and matrix already match B8).

| Route                                                                                              | Access           |
| -------------------------------------------------------------------------------------------------- | ---------------- |
| `POST /billing/payments` (Idempotency-Key)                                                         | `payment:write`  |
| `POST /billing/payments/preview`                                                                   | `payment:write`  |
| `POST /billing/payments/:id/refund`, `/void`                                                       | `payment:refund` |
| `GET /billing/payments`, `/billing/payments/export`                                                | `payment:read`   |
| `GET /billing/payments/:id/receipt`                                                                | `payment:read`   |
| `GET /billing/aging`                                                                               | `payment:read`   |
| `GET /billing/outstanding`                                                                         | `payment:read`   |
| `GET /billing/patients/:id/account`, `/statement`                                                  | `payment:read`   |
| `GET /billing/visits/:visitId/summary` gains `payments` (allocations to the visit) for the invoice | `payment:read`   |

## Web

- `features/billing/payments/record-payment-dialog.tsx` — POC modal (empty amount, Full/Half
  chips, method chips, date, reference, payer line + change (patient or a billing contact),
  household switch, "Apply to a specific visit" disclosure, preview debounced, Remaining, submit
  labels, toast with "Receipt"). Entry points: Overview balance card, Balance & payments tab,
  expanded visit row (B4 preselected), post-visit summary (`contextVisitId`, returns to it),
  Visits detail panel, Outstanding "Take payment".
- `routes/_app/payments` + nav item (`payment:read`): KPI cards, aging bar + bucket buttons,
  Transactions / Outstanding tabs, filters in the URL, cursor pager, Export CSV, refund/void
  dialog (front desk sees "Ask a dentist to refund").
- Balance & payments tab live: balance card, credit note, Payment history with Remaining,
  "n visits", Receipt link, Statement button. Void dialog link → that tab.
- `routes/print/{receipt.$id,invoice.$visitId,statement.$patientId,quote.$patientId}.tsx` +
  `print.css` (A4). Entry points per prompt §Screens 5.
- i18n `payments.json` + `printables.json` in en/ar/fr (printables LTR).

## Events and audit

`PaymentRecorded`, `PaymentRefunded`, `PaymentVoided`, `CreditApplied` (ids, amounts,
allocations). Audit `payment.create|refund|void` and `payment.credit_applied` with allocations
in `after`, reason in `reason`.

## Tests (lean)

Domain specs for `allocate`, `refund`, `aging`, `payment-history`. One payments integration spec
covering the six acceptance scenarios, refund/void, write-off allocation, merge settle,
idempotency and a concurrent double-submit at the cap. Tenant isolation for `payments`,
`payment_allocations`, `payment_counters`. One smoke spec for the read routes and export. SPA
specs: record-payment form (cap, chips, labels, household, manual target), refund/void role
gating, payments URL filters. Playwright: partial payment → receipt → refund → balance restored.

## Docs

`docs/modules/billing.md` (tables, kinds, service, routes), ADR-0027 account-level payments with
stored derived allocations (sources/targets, settle), ADR-0028 household payments, ADR-0029
credit handling (immediate application, write-off credit not refundable). CLAUDE.md §4 module
map: `billing` "Owns" gains payments and allocations; edges unchanged.

## Implementation notes

- **One migration** for the new kinds and tables (`0023_payments`) plus the grants
  (`0024_payments_append_only`): drizzle-kit runs pending migrations in one transaction anyway,
  and nothing in 0023 uses a new `ledger_entry_kind` literal.
- **Account lock** is a transaction advisory lock (`account:<patient id>`), taken after the
  patient's `FOR SHARE`, instead of `FOR UPDATE` on the charges: it also serialises accounts with
  no charge rows yet, and settle can take it again in the same transaction.
- **Idempotency key** is indexed, not unique: a household's rows share one, and a merge can bring two
  rows of one receipt onto one patient. Replays are serialised by an advisory lock on the key
  (`payment-key:<key>`), taken before the lookup, so a retry sent while the first request runs
  waits and replays it. The receipt-number index is not unique either (migration
  `0025_payments_indexes`); the counter keeps numbers unique.
- **Refund and void results** are `{ ids }` (`paymentWriteResultSchema`); the SPA refetches.
- **Small reads outside `billing`**, on existing edges: `VisitsService.numbersFor` (visit numbers
  on allocations) and `UsersService.namesByUserIds` ("Recorded by").
- **Transactions search** (`q`) matches a patient, a receipt (`RCT-12`, `12`) or a visit number
  (`V-12`, exact).
- **"Refund payments first"** (Visits panel) now opens Payments › Transactions filtered by the
  visit number, where the refund is made.
- **Printables** are SPA routes under `/print/*` (signed in, no app shell), opened in a new tab.
  The quote is also linked from the workspace's treatment-plan card.
- **Domain file** for the running balance is `running-balance.ts` (the plan said
  `payment-history.ts`): the statement uses it too.
- The pre-existing type error in `visit-detail-panel.spec.tsx` (`disabled` on `HTMLElement`) is
  fixed with a typed query.
- **Review fixes:** a payment settles its accounts after locking them and caps at the lesser of
  Σ target outstanding and the positive ledger balance, so an account written before payments
  existed (a write-off without allocations) can't be over-paid; a household replay accepts a
  key whose rows paid only siblings; `VisitBalance.paidByPayments` (payment-sourced allocations)
  gates the SPA's "Refund payments first", matching the server veto; printables open with an
  opener (then cut) so a platform admin's acting clinic carries over; the aging buckets count
  each patient once, in the bucket of their oldest remainder, like the Outstanding filter.
- **Known gaps:** a visit amended between a merge and its re-point job can briefly get a second
  allocation target (its correction entry on the kept patient); and Void stays offered on a
  household row whose sibling row was refunded, where the server refuses it (409
  `payment.has_refunds`).

## Addendum — family balances (2026-10-03)

Asked after the build: how to see what a billing contact owes for themself and their family.

- **Family** = the household of ADR-0028 seen from the payer: the contact's own record (when they
  are a patient) and every non-archived patient who lists them as a billing contact (primary or
  not). `GET /billing/contacts/:id/family` returns each member's balance, oldest unpaid date and
  open visits, the total of the owing balances, and `payFor` (a member to open the payment panel
  with, since a payer must be a billing contact of the patient paid for).
- **Balance & payments tab**: a "Family billed to …" card for each of the patient's billing
  contacts, and for the family the patient pays for themself (`PatientAccount.payerFor`), shown
  when the family has more than one account. It offers **Record family payment** (the panel opened
  with that payer and the household preset; `account?payerContactId=` gives the panel that
  payer's household) and **Family statement**.
- **Family statement** (`/print/family-statement/:contactId`, `GET …/family/statement`): one
  statement section per member and the family total; it may run over one A4 page.
- **Outstanding › Show by payer** (`group=payer`): one row per family, keyed by the primary billing
  contact — a parent who is a patient joins the family they pay for unless someone else bills
  them; a patient without a billing contact is their own row. Take payment opens the household.
  By patient, each row now says who it is billed to.
- New reads on `ContactsService` (existing edge): `contactView`, `contactOfPatient`,
  `primaryBillingContacts`.
- A family (all billing links) and an Outstanding family row (primary billing links only) can
  differ when a patient has two billing contacts; the aging bar still counts patients.
