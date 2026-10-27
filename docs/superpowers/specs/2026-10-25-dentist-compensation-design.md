# Dentist compensation: agreements, monthly statements, payouts — design

Date: 2026-10-25. Feature 13b. New module `compensation`; read building blocks in `billing`,
`clinical`, `users`; filters in `audit`; `contracts`; the SPA. ADR-0058 to ADR-0060. Migration 0053. Source: the 13b prompt (`15-dentist-compensation-prompt.md`). Its rules stand unless a
decision below says otherwise. This page records only the decisions and contracts, and what
closes the prompt's gaps.

## Why

The clinic defines, per dentist, how the dentist is paid. The system computes a monthly statement
from the ledger that already exists. The owner records adjustments and payouts and closes the
month. The dentist reads their own statement.

**The rule:** every amount traces to one visit, one payment, one adjustment or one payout, with
the rate that applied. A closed month never changes. Later corrections show up as new dated lines
in the open month.

**Live deployment:** the migration is additive. No recorded row is touched. Existing modules gain
read building blocks and one event. Nothing else about them changes.

## Precondition (checked 2026-10-25)

- `compensation:read` and `compensation:manage` are in the catalog (manage ⇒ read).
- Migration 0050 seeds owner with both and dentist with `read`.
- `RequestContext.hasPermission` refuses `compensation:*` to a platform admin in a tenant.
- No role data is migrated.

## Decisions

### Model

- **K1 — Module.** `compensation` depends on `users`, `clinical`, `billing`, `patients`,
  `tenancy` and `audit`.
  - `patients` is a new edge (C1 left it out): statement lines name the patient
    (`PatientsService.names`).
  - No module imports `compensation`.
- **K2 — Agreement.** One row per agreement: `staff_profile_id`, `preset`, `components` (jsonb,
  Zod), `effective_from`, `effective_to?`, `statement_visible_to_dentist`, `note`.
  - Components and presets are as the prompt says. The form defaults are C4.
  - Live agreements of one dentist never overlap. This is an exclusion constraint on
    `(tenant_id, staff_profile_id, daterange(effective_from, effective_to, '[]'))` where
    `superseded_at is null`. It needs `btree_gist`.
  - The row is append-only except for the end columns and the supersede columns.
- **K3 — Supersede** (closes gap A: "billed from Oct 1" while an Oct 1 agreement exists).
  - Change terms dated on the current agreement's first day **supersedes** it:
    `superseded_at`, `superseded_by`, `supersede_reason`. The row stays in history, struck
    through, and the new agreement takes its dates.
  - Allowed only while none of the old agreement's months is closed for that dentist. Otherwise
    422 `compensation.period_closed`.
  - A later date ends the old agreement on `date − 1` and creates the next one. Both happen in
    one transaction (C5).
- **K4 — Ending.** End sets `effective_to`, or shortens it.
  - `effective_to ≥ effective_from`. Otherwise 422 `compensation.effective_date`.
  - The end date may not fall inside a closed month (422 `compensation.period_closed`).
  - An agreement is never lengthened. A longer term is a new agreement.
- **K5 — Deactivation** (C11). `users.deactivate` publishes the new `StaffDeactivated`
  (`userId`, `profileId`, `date` = the tenant-local day) inside its transaction.
  - `compensation` reacts with `@OnDomainEventInTransaction` and does two things:
    - it ends the agreement in force on `date`;
    - it supersedes agreements that start after `date`. Both carry the reason "staff
      deactivated".
  - This reaction checks no permission, because the actor holds `user:write`, not
    `compensation:manage`. It never refuses, so a deactivation cannot fail because of
    compensation. K9 means `date` is never inside a closed month.
  - Reactivation restores nothing.

### Statement

- **K6 — Lines and their identity.** Every line has a stable id: what it comes from, plus the
  month it belongs to.

  | Line               | Source                                                                               | Id                                | Own month                   | Rate date          |
  | ------------------ | ------------------------------------------------------------------------------------ | --------------------------------- | --------------------------- | ------------------ |
  | production         | visit-kind ledger entry of the dentist's visit                                       | entry id                          | `effective_date`            | visit `local_date` |
  | collection         | allocation row with a `payment` source onto an entry of the dentist's visit (signed) | allocation id                     | `created_at` in tenant time | visit `local_date` |
  | per-visit          | completed, non-voided, **not imported** visit (gap E)                                | `visit:<id>`                      | visit `local_date`          | same               |
  | per-visit reversal | a counted visit voided later                                                         | `visit:<id>:void`                 | visit `local_date`          | same               |
  | per-day            | a local date with ≥ 1 counted visit                                                  | `day:<date>`                      | that date                   | same               |
  | per-day reversal   | a counted day that lost its last visit                                               | `day:<date>:void`                 | that date                   | same               |
  | fixed              | `monthlyFixed`, per agreement and month                                              | `fixed:<agreementId>:<month>`     | the month                   | —                  |
  | threshold          | see K8                                                                               | `threshold:<agreementId>:<month>` | the statement month         | —                  |
  - A visit with no live agreement on its date earns nothing. Its line still shows, with rate
    "—".
  - Other-currency lines go under `notComputed` (C7).

- **K7 — Rates and rounding.**
  - **Arithmetic.** Bigint cents and exact rational intermediates. Each line's share is rounded
    half away from zero. Totals are the sum of the rounded lines.
  - **Blended percent.** It comes from the charge entry's `ledger_entry_lines`:
    1. Pro-rate the lines to the entry's net amount.
    2. Give each line its percent: the code's override, else the category's override (the
       current catalog category, via `categoriesByCodes`), else the default percent.
    3. Blend: Σ(line × percent) / net.
  - Adjustment entries, reversal entries and collections use the visit's blended percent.
  - An amendment adds no lines, so it does not re-blend (gap G, documented).
  - Check: 900 × 30 % + 45 × 40 % over 945 = 30.476 % → 500 × that = 152.38.
- **K8 — Threshold, per statement month** (gap D).
  - It applies per agreement that has a threshold, to every share line in this statement that
    used that agreement, **late entries included**. It is not pro-rated.
  - `base` = Σ those lines' bases.
  - `share = Σ line shares × max(0, base − threshold) / base`, rounded once.
  - Lines show their full shares. One **"Below minimum base"** line carries
    `share − Σ line shares`.
- **K9 — Periods.**
  - A period is a calendar month in the tenant time zone, `YYYY-MM`.
  - A month may be closed only after it has ended: its last day is before today (422
    `compensation.month_not_ended`).
  - **Months close in order** (gap C). Closing M needs M−1 closed, unless M is the dentist's
    first month. That is the month of their earliest agreement, adjustment or payout. Otherwise
    409 `compensation.previous_period_open`.
  - Reopen needs a reason, and only while M+1 is not closed (409
    `compensation.next_period_closed`).
  - So a dentist's closed months are always a prefix of their months. The last closed month is
    the **anchor**.
- **K10 — Late entries** (replaces the prompt's `created_at > closed_at` test, gap B).
  - A line is late when both are true:
    - its own month is closed;
    - its id is not in any snapshot.
  - Since the closed months form a prefix, every late line is reported in the first open month
    (anchor + 1), under "Late entries from {month}" with its own date.
  - Closing that month puts the late lines' ids in its snapshot, so they are never counted
    twice.
  - Reopening the anchor moves its late lines back where they belong.
  - Why not compare timestamps: a payment that commits just after the close, with a `created_at`
    before `closed_at`, would be lost. Comparing ids cannot lose it.
- **K11 — Snapshot.** Closing writes `compensation_periods.snapshot`: every line with its id,
  section, inputs and amount; the totals; the agreement summaries.
  - A closed month is read from its snapshot and never recomputed.
  - The opening balance of M is M−1's snapshot closing balance when M−1 is closed. Otherwise it
    is computed forward from the anchor (0 before the first month).
- **K12 — Adjustments and payouts.**
  - Kinds, signs, note rules and void with reason are as the prompt says.
  - Dated in a closed month → 422 `compensation.period_closed`. Voiding one dated in a closed
    month gives the same error.
  - Voiding an already-voided row → 409 `compensation.not_reversible`.
  - The payout method is the payments enum (`PAYMENT_METHODS`), stored as text with a check.
    `compensation` does not reuse `billing`'s Postgres type.
  - `Idempotency-Key` works the payments way: the key and the request hash are on the row.
  - Close and reopen store the last key and hash on the period row.

### Access

- **K13 — Self-only rule.** A pure `canReadStatement(actor, profileId)` in `@dcm/contracts`, the
  pattern of `canReadVisit`.
  - It returns true when the actor has `compensation:manage`, or has `compensation:read` and
    `profileId` is their own.
  - Their profile is `RequestContext.staffProfileId`, which `authorization` already resolves
    through `UsersService.profileIdOf`.
  - `AuthorizationService.can('compensation:read', { profileId })` delegates to it.
  - There is no `compensation → authorization` edge.
  - Another dentist's statement → 403 `forbidden`.
- **K14 — Dentist visibility.** The latest live agreement overlapping a month decides
  `statementVisibleToDentist` for that month.
  - Without one, or when it is off, `GET /compensation/me/statement` → 404 `compensation.not_found`
    and the month is not listed in `/me/months`.
  - `/me/months` lists the months from the first visible agreement up to the current month.
- **K15 — Audit and Activity** (C8).
  - Actions: `compensation.agreement_create | agreement_end | agreement_supersede |
adjustment_record | adjustment_void | payout_record | payout_void | period_close |
period_reopen`.
  - Resource types: `compensation_agreement | compensation_adjustment | compensation_payout |
compensation_period`.
  - `audit` hides these rows, and the raw events in `COMPENSATION_EVENTS` (contracts), from
    anyone without `compensation:manage`. The dentist doesn't see their own rows either.
  - **`GET /platform/audit` always hides them** (decision of 2026-10-25).
  - Events: `AgreementCreated`, `AgreementEnded`, `AgreementSuperseded`, `AdjustmentRecorded`,
    `AdjustmentVoided`, `PayoutRecorded`, `PayoutVoided`, `PeriodClosed`, `PeriodReopened`.
    Payloads are ids plus minimal facts.

### Building blocks (C1, adjusted for K10 and gap F)

These are not permission-gated, and they are called only from services. Their windows also cover
**late candidates**: rows created after a date, whatever month they belong to.

- `billing.BillingService.visitChargesBetween({ from, to, createdSince })` returns visit-kind
  entries with `effective_date` in [from, to] or `created_at ≥ createdSince`. Each has `id`,
  `visitId`, `kind`, `amount`, `currency`, `effectiveDate` and `createdAt`; a `visit_charge` also
  has its `lines` (code, amount).
- `billing.BillingService.visitCollectionsBetween({ from, to, createdSince })` returns
  allocation rows with a `payment` source onto visit entries. Each has `id`, `visitId`, signed
  `amount`, `currency`, `createdAt` and `paymentId`. The window is by `created_at`.
- `billing.BillingService.unattributedCollectionsBetween(from, to)` returns the same for targets
  that are opening balances and debit adjustments. It feeds the report's Unattributed row.
- `clinical.VisitFactsService.completedByDentistBetween({ from, to, changedSince, dentistIds? })`
  returns completed visits (voided ones included) with `local_date` in [from, to], or
  `completed_at` / `voided_at ≥ changedSince`. Each has `visitId`, `displayNumber`, `dentistId`,
  `patientId`, `localDate`, `type`, `total`, `currency`, `voidedAt?` and `imported`.
- `clinical.CatalogService.categoriesByCodes(codes)` returns a `Map<code, category | null>`.
- `users`: `StaffDeactivated` (K5). Profile names for the report come from
  `practitionersByProfileIds`, which already exists.
- The CSV helper moves from `billing/domain/csv.ts` to `platform/kernel/csv.ts`. Billing imports
  it from there; its behaviour is unchanged.

## Contracts (`packages/contracts/src/compensation.ts`)

- `AGREEMENT_PRESETS`: `revenueShare | perVisit | monthlySalary | salaryCommission | perDay |
chairRent | custom`, each with its component set and label key.
- `ADJUSTMENT_KINDS` (the 8 kinds).
- `agreementComponentsSchema`: a discriminated union on `kind`, at most one of each kind, at
  least one component in all.
  - `monthlyFixed { amount (signed), prorate }`
  - `share { percent 0–100 (2 decimals), basis, rateOverrides[] ({ serviceCode | category,
percent }), threshold? }`
  - `perVisit { amount, byType?: Partial<Record<VisitType, amount>>, chargedOnly }`
  - `perDay { amount }`
- Agreements: `agreementSchema` (with `status: active | ended | superseded | future`),
  `createAgreementSchema`, `endAgreementSchema { date, reason? }` and `changeTermsSchema { date,
preset, components, statementVisibleToDentist, note?, reason? }`.
- Adjustments: `adjustmentSchema` and `recordAdjustmentSchema`.
- Payouts: `payoutSchema` and `recordPayoutSchema`.
- Periods: `voidSchema { reason }`, `reopenPeriodSchema { reason }`, `monthSchema`
  (`YYYY-MM`).
- `statementSchema`:
  - header: `profileId`, `dentistName`, `month`, `status: provisional | closed`, `currency`,
    `agreements` (summaries), `closedAt?`;
  - `earned` (groups by component, then lines), `late` (groups by own month, then lines),
    `adjustments[]`, `payouts[]`, `notComputed[]`;
  - `totals { opening, earned, late, adjustments, payouts, closing }`;
  - a line is `{ id, kind, date, visitId?, visitNumber?, patientName?, visitType?, entryKind?,
base?, rate?: { percent, blended, lines?[] }, count?, unitAmount?, amount }`.
- `compensationReportSchema`:
  - rows: `{ profileId, name, visits, production, collections, earned | null, adjustments,
payouts, balance, status: provisional | closed | none }`;
  - `unattributed { collections }`;
  - `kpis { production, collections, earned, balanceOwed }`.
- `myMonthsSchema`.
- `canReadStatement` (K13) and `COMPENSATION_EVENTS` (K15).
- The error codes: the prompt's, plus `compensation.previous_period_open` (409) and
  `compensation.month_not_ended` (422).

## Routes

These are the prompt's routes, unchanged. Change terms also supersedes when its date is the
current agreement's first day (K3). No other routes.

## Web

These are the prompt's screens. Where the codebase differs:

- **Nav.** No "Finance" group exists.
  - `compensation` (`compensation:manage`) goes into `MAIN_NAV` right after `payments`.
  - `myStatement` (`compensation:read`) goes after it. The sidebar shows it only when
    `GET /compensation/me/months` returns at least one month.
- **Staff panel.** `UserPanel` is shared with the admin portal. Add a `compensation` tab that the
  clinic Settings page passes in only with `compensation:manage` and
  `practitionerType = dentist`. The admin portal never passes it.
- **One statement view** for the owner (with actions) and `/my/statement` (read-only, with the
  Provisional note).
- Superseded agreements are listed struck through, with their reason.

## Out of scope

As the prompt says: 13c printables, tiers, lab costs, `performed_by`, payroll, cut-off day, multi
currency, cross-tenant statements, AI tools.
