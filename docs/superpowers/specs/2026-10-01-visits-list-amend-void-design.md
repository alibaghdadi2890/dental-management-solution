# Feature 4b — Visits list, amend/void, patient history tabs — design

Date: 2026-10-01 · Status: Implemented (2026-10-01); see §Implementation notes for the
changes made while building it

## Goal

Staff browse every visit of their branch on `/visits`, open one in a side panel, and — as a
dentist or owner — amend or void a completed visit with a reason. Amend and void never rewrite
history: an amendment is an append-only snapshot, and `billing` follows each change with its own
ledger entry. The patient record gains its three remaining tabs (Visits & history with a Visits
and a Clinical view, Dental chart, Balance & payments), and the patients list gains Last visit,
Visits and a working _Not seen 6+ months_ view. The 4a follow-ups ride along.

References: the 4b prompt (decisions L1–L8), `Dental Clinic POC/Visits.dc.html`,
`ClinicalWorkspace.dc.html` and `clinical-workspace-spec.md` §Screen 3. The POC is a guide, not
the spec: where it differs from the decisions below, the decisions win.

Owner module: `clinical`. `billing` reacts to amend/void and serves the money views; `patients`
gains one search internal. No new dependency edge.

**Out of scope:** payments, refunds, receipts/invoices/quotes ("Plan quote", "Invoice/Receipt",
"Record payment" are not rendered), the "Request a change" workflow, scheduling, sortable
columns on the visits list and patients list, the 30/90/365-day Last visit filters.

## Decisions

| #   | Topic                     | Decision                                                                                                                                                                                                   |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Amend scope               | Per-tooth services: change tooth and surfaces. Any service: remove. Visit: change discount (mode + value). Per-line discounts, prices, adding services: not editable. The new total includes the discount. |
| D2  | Plan-linked service       | Removing a service that performed a plan returns the plan to `planned` (performed fields cleared, audited). Its tooth/surfaces cannot be edited.                                                           |
| D3  | Last service              | At least one service must remain; removing everything is a void.                                                                                                                                           |
| D4  | Repeat                    | An amended visit can be amended again and voided. Voided is final.                                                                                                                                         |
| D5  | Who                       | Any holder of `visit:amend` / `visit:void` (owner, dentist). No own-visit rule, no time limit.                                                                                                             |
| D6  | Void and the record       | Diagnoses, plans (including those performed in the visit) and tooth status stay as recorded. The chart is not recomputed. Tooth history and the Clinical view mark steps from a voided visit.              |
| D7  | Ledger date               | Adjustments and reversals are dated the tenant's local date of the correction. They carry no lines; the before/after lives in `visit_amendments`.                                                          |
| D8  | Concurrency               | Amend and void send the visit's `updatedAt`; a stale one gets 409 `visit.stale`.                                                                                                                           |
| D9  | Display number            | `V-` + 6-digit zero-padded per-tenant sequence (`V-000123`), minted at start; existing visits backfilled by `started_at`; discarded visits keep their number.                                              |
| D10 | Branch scope              | The list shows the active branch's visits; the Room filter lists that branch's rooms. A patient's own history (record tab) spans all branches.                                                             |
| D11 | Which visits              | _All_ = live + completed + amended + voided, never discarded. _In progress_ includes paused (pill "Paused"). The date filter is on `local_date`.                                                           |
| D12 | Paging                    | Cursor on `(started_at desc, id desc)`, Previous/Next, 10/25/50 rows. Footer "N visits · $X billed" from a separate aggregate. No column sort. Tab counts ignore the filters.                              |
| D13 | Audit trail               | Shown in the detail panel only with `audit:read`, cursor-paged with "Show more".                                                                                                                           |
| D14 | Request a change          | Front desk sees a note and a link; the toast reads "Ask {dentist} to amend or void this visit". No workflow.                                                                                               |
| D15 | History views             | Visits & history has two views: **Visits** and **Clinical** (treatment threads, below).                                                                                                                    |
| D16 | Voided/amended in history | Voided visits stay in the patient's history, struck through at 70 %. Amended visits carry an amber pill.                                                                                                   |
| D17 | Chart tab                 | Read-only. "Mark exfoliated / Still present" hidden; "Treated today" dropped from the legend.                                                                                                              |
| D18 | Last visit / Visits       | Count completed + amended visits only. _Not seen 6+ months_ = last counted visit more than 180 days before the tenant's today, or never.                                                                   |
| D19 | Payments check on void    | `billing` vetoes the void inside the transaction when `paid > 0` (`visit.has_payments`); the SPA checks first to show "Refund payments first" (ADR-0026).                                                  |
| D20 | 4a follow-ups             | Included: see §4a follow-ups.                                                                                                                                                                              |

"Counted" below means status `completed` or `amended`.

## Data model

### `clinical` (migration 0019)

- `visit_status` enum gains `amended`, `voided`.
- `visit_counters (tenant_id pk, next_number int)` — RLS, same shape and mint as
  `patient_counters`. `visits.display_number int not null`, unique `(tenant_id, display_number)`;
  the migration backfills existing rows per tenant ordered by `(started_at, id)` and seeds the
  counter.
- `visits` gains `voided_at timestamptz`, `voided_by uuid`, `void_reason text`; CHECK
  `visits_voided_fields`: all three set iff `status = 'voided'`, `void_reason` ≥ 3 chars.
- `visits_completed_fields` and `visits_money_consistent` widen from `completed` to
  `completed | amended | voided`.
- `visit_amendments`: `id`, `tenant_id`, `visit_id` (composite FK to visits), `sequence int`
  (unique per visit, from 1), `reason text` (≥ 3), `before jsonb`, `after jsonb`, `delta
numeric(12,2)`, `currency char(3)`, `amended_by uuid`, `created_at`, `updated_at`. RLS;
  `dcm_app` has SELECT + INSERT only (append-only, like the ledger). Snapshot shape:
  `{ services: [{ id, code, name, toothCode, surfaces, final }], discount: { mode, value },
subtotal, discountAmount, total }`.
- Index `visits_branch_started_idx (tenant_id, branch_id, started_at desc, id desc)`.

### `billing` (migration 0020)

- `ledger_entry_kind` gains `visit_charge_adjustment`, `visit_charge_reversal`
  (`LEDGER_ENTRY_KINDS` in contracts).
- Replace `ledger_entries_visit_iff_charge` with: `visit_id is not null` iff kind is one of the
  three visit kinds.
- Replace `ledger_entries_visit_unique` with a unique index on `(tenant_id, visit_id, kind)`
  `WHERE kind in ('visit_charge', 'visit_charge_reversal')`. Adjustments are unlimited.
- Index `ledger_entries_visit_idx (tenant_id, visit_id) WHERE visit_id is not null`.

## Contracts (`packages/contracts`)

- `visits.ts`: `VISIT_STATUSES` + `amended`, `voided`; `COUNTED_VISIT_STATUSES`;
  `visitSchema` + `displayNumber`, `voidedAt`, `voidedBy`, `voidReason`, `amendmentCount`;
  `formatVisitNumber(n)` (pure helper).
- `visit-list.ts` (new):
  - `visitListQuerySchema` = `cursorPageQuerySchema` + `tab: all | in_progress |
voided_amended | history` (default `all`), `range: today | 7d | 30d | 90d | 12m | all`
    (default `90d`), `dentistId?`, `roomId?`, `q?` (≤ 100), `patientId?`. With `patientId` the
    branch scope does not apply.
  - `visitListItemSchema`: id, displayNumber, status, localDate, startedAt, completedAt,
    durationMinutes, pausedAt, pausedSeconds, branchId, room `{id,name} | null`, patient `{id,
displayNumber, firstName, lastName}`, dentist `{id, name}`, services `[{ id, code, name,
chargeUnit, toothCode, surfaces, planId, final }]`, notes, discount `{mode, value}`,
    currency, subtotal, discountAmount, total, amendmentCount, voidReason, updatedAt.
  - `visitListSummarySchema`: `{ count, billed: [{currency, amount}], tabs: { all, inProgress,
voidedAmended, today } }`.
  - `amendVisitSchema`: `{ expectedUpdatedAt, reason (3–500), discount: {mode, value}, services:
[{ id, toothCode?, surfaces? }] }` — the whole desired state; omitted services are removed.
  - `voidVisitSchema`: `{ expectedUpdatedAt, reason (3–500) }`.
  - `visitStatsSchema`: `[{ patientId, lastVisitDate: isoDate | null, visitCount }]`.
- `clinical-records.ts`: `patientChartSchema` and `toothHistorySchema` + `voidedVisitIds: id[]`.
- `billing.ts`: `visitBalanceSchema` `{ visitId, currency, charged, paid, outstanding }`;
  `unpaidVisitsSummarySchema` `{ count, billed, tabCount }`.
- Error codes: `visit.not_amendable`, `visit.not_voidable`, `visit.stale`,
  `visit.amend_no_change`, `visit.amend_last_service`, `visit.amend_unknown_service`,
  `visit.amend_plan_linked`, `visit.has_payments`.

## Backend — `clinical`

### Domain (pure)

- `visit-lifecycle.ts`: actions `amend` (`completed | amended` → `amended`) and `void`
  (`completed | amended` → `voided`). Live, discarded and voided visits throw
  `VisitNotAmendableError` / `VisitNotVoidableError`.
- `visit-amendment.ts`: `planAmendment(current, input, toothRules)` → `{ removed, edited,
plansToReopen, before, after, delta }` or a domain error (D1–D3, discount within the new
  subtotal via `visit-money`, "no change" rejected). Tooth/surface checks reuse the rules used
  when a service is added to a live visit.
- `visit-cursor.ts`: base64url JSON `[startedAtIso, id]`, same shape as audit's.
- `visit-range.ts`: `rangeStart(range, today)` → ISO date or null.

### `VisitsService`

- `amend(id, input)` — `visit:amend`. Lock the visit (`FOR UPDATE`); check status and
  `updatedAt`; `planAmendment`; soft-delete removed services; update edited services; reopen
  plans (`TreatmentPlansRepository.reopen`, audited `treatment_plan.reopen` with the reason);
  write the new money; `status = amended`; insert `visit_amendments` (next sequence); audit
  `visit.amend` (before/after/reason); publish `VisitAmended { visitId, patientId, amendmentId,
currency, delta, reason }` in the transaction. Returns the visit.
- `void(id, input)` — `visit:void`. Lock; check status and `updatedAt`; set voided fields;
  audit `visit.void` (reason); publish `VisitVoided { visitId, patientId, currency, reason }` in the
  transaction (billing may veto). Returns the visit.
- `start` mints the display number.
- `search(query, internal?: { idsIn? })` — `visit:read`. Branch = CLS branch unless `patientId`;
  never discarded; tab → status set (`history` = counted + voided); range on `local_date` from
  the tenant's today; `q` matches the display number (`V-123`, `123`), a non-deleted service's
  code or name (ILIKE), or `patient_id = any(PatientsService.searchIds({ q }))`. Fetch
  `limit + 1`. Enrich with `PatientsService.listItemsByIds`,
  `UsersService.practitionersByProfileIds`, `TenancyService.listRooms`. Live visits get their
  computed money.
- `summary(query, internal?)` — same filters: `count`, `billed` (Σ total of counted visits per
  currency); `tabs` ignore filters but keep the branch scope; `today` = visits with today's
  `local_date`.
- `lastVisitFor(patientIds)` — counted visits, any branch.
- `patientIdsSeenSince(date | null)` — internal, for the not-seen view.
- Reads switching to counted (+ voided where noted): `latestCompleted` (counted),
  `clinicalSummary` (counted), `completedForPatient` (counted + voided; the chart history keeps
  voided services, D6), tooth history (counted + voided), `voidedVisitIds` for the chart and
  tooth history.

### HTTP (`/api/v1`)

| Route                                                    | Access                        |
| -------------------------------------------------------- | ----------------------------- |
| `GET /visits` (`visitListQuery`)                         | `visit:read`                  |
| `GET /visits/summary` (same query)                       | `visit:read`                  |
| `POST /visits/:id/amend`                                 | `visit:amend`                 |
| `POST /visits/:id/void`                                  | `visit:void`                  |
| `GET /clinical/patients/visit-stats?patientIds=` (1–100) | `visit:read`                  |
| `GET /clinical/patients/not-seen` (patients list query)  | `patient:read` + `visit:read` |
| `GET /clinical/patients/not-seen/count`                  | `patient:read` + `visit:read` |

`GET /visits` and `/visits/summary` are registered before `GET /visits/:id`.

The not-seen routes compute `idsNotIn` (patients seen in the last 180 days for `view=notSeen`;
every patient with a counted visit for `lastVisit=never`) and call `PatientsService.search` /
`counts`. `patients` gains `idsNotIn` on `PatientSearchInternal` and refuses `notSeen` /
`lastVisit=never` without it (like `owing` without `idsIn`).

### Events

`VisitAmended`, `VisitVoided` in `events/visit-events.ts`, exported from `index.ts`. The generic
audit subscriber records them too.

## Backend — `billing`

- `visit-charge.subscriber.ts` gains, in the transaction:
  - `VisitAmended` → `visit_charge_adjustment` of `delta` unless zero; `effectiveDate` = tenant
    today; `reason` = the event's reason; no lines.
  - `VisitVoided` → if `paidOn(visitId) > 0` throw `VisitHasPaymentsError` (409
    `visit.has_payments`); else `visit_charge_reversal` of −Σ visit entries unless zero, with
    the void reason.
- `BillingService`: `balancesForVisits(ids)` (`paid` = 0 until feature 5), `paidOn(visitId)`,
  `unpaidVisitIds()` (Σ visit entries − paid > 0). `charged` (patient balance) and
  `visitSummary` count all three visit kinds.
- `VisitViewsService`: `unpaid(query)` / `unpaidSummary(query)` → `VisitsService.search` /
  `summary` with `idsIn`; `export(query)` → every page of `search` (or `unpaid`) + balances,
  CSV like the patients export.
- Patients export fills Last visit / Visits from `lastVisitFor`.

| Route                                                        | Access                        |
| ------------------------------------------------------------ | ----------------------------- |
| `GET /billing/visits/balances?visitIds=` (1–100)             | `payment:read`                |
| `GET /billing/visits/unpaid`                                 | `visit:read` + `payment:read` |
| `GET /billing/visits/unpaid/summary`                         | `visit:read` + `payment:read` |
| `GET /billing/visits/export` (query + `tab`, incl. `unpaid`) | `visit:read` + `payment:read` |

Export columns: Visit, Date, Time, Room, Patient, Patient ID, Dentist, Services, Subtotal,
Discount, Total, Paid, Balance, Status.

## Frontend

Files: `features/clinical/visits-list/` (page, table, filters, detail panel, amend, void),
`features/clinical/record/` (history tab with both views, chart tab), `features/billing/`
(balance & payments tab, visit balances). `features/patients/record/record-search.ts` gains
`tab: overview | history | chart | balance | information`, `visitId?`, `historyView: visits |
clinical`, `startVisit?`.

### Visits page (`/visits`)

- Header: title, "{today} today · {unpaid} with an open balance", Export CSV (downloads the
  billing export for the current tab and filters).
- Tabs with counts: All · In progress · Unpaid · Voided & amended. Unpaid uses the billing
  routes; the rest `/visits`.
- Filters in the URL: search (debounced), Date (default 90 days; _Clear filters_ resets to 90),
  Dentist, Room.
- Columns: Visit ID · Date/time · Room · Patient · Dentist · Services (2-line clamp, tooth labels
  in the tenant notation) · Total · Balance ("Paid" green / red amount / "—" for voided and
  live) · Status. Live rows show a running duration (`use-visit-timer`). Voided rows 70 %,
  total struck through.
- Footer: "N visits · $X billed" (per currency), Previous/Next, rows 10/25/50. The cursor stack
  lives in component state; changing a filter resets it.
- States: skeleton, error with request ID + Try again, empty, no matches + Clear filters.

### Detail panel (452px, pushes the list)

Header (number, status pill, patient, date · time · dentist · room), voided banner, services,
totals (Subtotal, Discount, Total, Paid, Balance), audit trail (`audit:read` only; `GET
/audit?resourceType=visit&resourceId=`, "Show more"; labels for `visit.start`, `visit.pause`,
`visit.resume`, `visit.complete`, `visit.amend` "Amended — {reason} · $A → $B", `visit.void`
"Voided — {reason}", generic fallback). Footer: Void + Amend (with the permission, on a counted
visit) · front desk note + Request a change (D14) · Open in record (history tab, visit
expanded).

**Amend mode:** tooth picker (patient's dentition) and surface toggles on per-tooth services,
remove on every service, discount mode/value; plan-linked services offer remove only with the
hint "Its plan returns to planned". Save disabled until changed; leaving with changes confirms.
Save → dialog: before → after total, "Patient will have $C credit" / "$C more to pay", reason
(≥ 3), "The original is kept in the trail". 409 `visit.stale` reloads and explains.

**Void:** fetch `/billing/visits/balances?visitIds=id`; `paid > 0` → "Refund payments first"
(Close). Else danger dialog "Void V-x?", the charge that will be reversed, reason (≥ 3).

### Record tabs

- **Visits & history — Visits view:** `GET /visits?patientId=&tab=history` with "Load more".
  Collapsed row: date + dentist, service chips "Name · #tooth", duration, Paid/Unpaid pill,
  total, caret. Expanded: services table (tooth links → tooth-history modal, surfaces, price),
  notes, money block (Subtotal / Discount / Visit total / Paid / Outstanding). Voided rows
  struck through at 70 %, amended rows an amber pill + "Amended n×". Empty state: "No visits
  recorded yet" + _Start first visit_ (`visit:write`). `visitId` in the URL expands and scrolls
  to that visit.
- **Visits & history — Clinical view (treatment threads):** pure `buildThreads(chart)` in
  `features/clinical/record/`. A thread is a diagnosis with its plans (`diagnosisRecordId`) and
  their performed services (`planId`), or a plan without a diagnosis. Groups: _Needs attention_
  (active diagnoses — flagged "No plan yet" when none — and open plans without a diagnosis),
  _Completed treatment_ (resolved diagnoses and performed plans; collapsed), _Treatment without
  a diagnosis_ (services with no plan, grouped by tooth). Each thread: tooth + surfaces, name,
  status, dentist, then a step line Diagnosed → Planned → Performed with dates. Filters: status
  chips with counts (Active / Planned / Resolved) and a tooth select. Dates jump to the Visits
  view with that visit expanded; tooth numbers open the modal; steps from `voidedVisitIds` are
  struck through and tagged "voided visit".
- **Dental chart:** full read-only `DentalChart`, legend (no "Treated today"), the 4a dentition
  selector, tooth panel in profile mode (no succession actions) with "Full tooth history".
- **Balance & payments:** balance card from `visitSummary(lastVisit.id)` — Most recent visit
  (total / paid / outstanding), Previous visits outstanding, Total outstanding; no visit →
  "Nothing billed yet". Payment history card: empty state "No payments recorded yet", no
  button.
- **Overview:** "All visits →" opens the history tab; Last visit and Treatment summary follow
  the counted rules.

### Patients list

Last visit and Visits filled from `/clinical/patients/visit-stats` (merged like balances).
`view=notSeen` and `lastVisit=never` go to `/clinical/patients/not-seen`; the Not seen chip
uses `/not-seen/count`. The Last visit filter is disabled in the Owing view.

## 4a follow-ups

1. Financial bar: muted "Open plans $X · not in today's total".
2. Cancelling an older plan: confirm popover, then a toast.
3. Visit completed elsewhere while open: workspace turns read-only with a banner "Completed by
   {name} at {time} · View summary"; one's own Complete still goes to the summary.
4. French buccal "V" (vestibulaire): keep; comment in the fr locale.
5. Patient-created toast: "Start visit" → record with `?startVisit=1`, which opens the
   start-visit popover once and drops the param.
6. UI language: saved choice → `session.tenant.locale` → browser.
7. Error messages: `apiErrorMessage(error, t)` looks up `{module}:errors.{code}`, falling back
   to the server text; keys in en/ar/fr for every clinical code, old and new.
8. Arabic: system roles (`system = true`) shown as `roles:system.{key}`; the clinic name gets
   `dir="auto"` + `unicode-bidi: isolate`.

## Testing

- **Unit (`domain/`):** lifecycle amend/void, `planAmendment` (each rule, delta with percent and
  amount discounts), visit cursor, `rangeStart`, `formatVisitNumber`.
- **Integration (Testcontainers, RLS on):**
  - amend: remove a service → total drops, negative adjustment, balance follows, plan
    reopened, `visit_amendments` row; tooth-only change → no ledger entry; stale → 409; live
    or voided → 409.
  - void: reversal, balance back to the pre-visit figure; void after amend reverses the net;
    `paidOn` stubbed > 0 → whole transaction rolls back.
  - ledger constraints: second reversal refused, several adjustments allowed.
  - one search test: tabs, range, dentist, room, q (number, service, patient), cursor, branch
    scope, discarded hidden, summary.
  - smoke: visit-stats, not-seen + count, visit balances, unpaid, visits export.
  - permissions: front desk and assistant get 403 on amend/void.
  - tenant isolation: `visit_amendments`, `visit_counters`, the new routes.
- **Web (Vitest):** `buildThreads`, amend form (dirty state, payload, plan-linked), void dialog
  branching, panel footer by role, list filters ↔ URL, `apiErrorMessage`.
- **Playwright:** complete a visit → Visits list → amend (remove a service, reason) → balance
  updates → void → struck through in the list and the patient history.

## Documentation

`clinical.md`, `billing.md`, `patients.md`, `roles.md` (where `visit:amend` / `visit:void` are
enforced); ADR-0025 _Visit amendments are append-only snapshots_; ADR-0026 _Billing vetoes a
void inside the transaction_; CLAUDE.md §4 module map (`visit_amendments`, `visit_counters`).

## Build order

1. Migrations, domain, amend/void services + integration tests.
2. Billing kinds, subscribers, visit balances, unpaid, exports.
3. List/search/summary, visit-stats, not-seen routes.
4. Visits page and detail panel.
5. Amend and void UI.
6. Record tabs, Overview link, patients list.
7. 4a follow-ups and error messages.
8. Playwright, docs, ADRs; full lint/typecheck/tests; one branch review.

## Known gaps

- `idsIn` / `idsNotIn` lists grow with the tenant (thousands of ids); acceptable while patients
  per tenant are bounded (ADR-0018).
- Billed sums and balances are per currency; a tenant changing currency sees two figures.
- The chart keeps treated marks from voided visits (D6).
- "Request a change" sends nothing.

## Implementation notes

Changes from the design above, made while building it:

- **Not seen and Never are `billing`'s.** The not-seen view, its count and the "Never" filter
  are served by `GET /billing/patients` and `GET /billing/patients/not-seen-count`, composed with
  `PatientsService.search`'s `idsNotIn` from `VisitsService.patientIdsSeenWithin`, instead of two
  `clinical` routes. `billing` already composes the patients list and its export, so Owing and
  Never combine and the export covers the view; the "Last visit filter is unavailable in the
  Owing view" gap is gone. `patients.counts()` lost its placeholder `notSeen`.
- **Ledger uniqueness.** The adjustment carries `amendment_id`; the unique index is
  `(tenant_id, visit_id, kind, coalesce(amendment_id, nil))` where `visit_id` is set. A partial
  index on `kind::text in (...)` is refused by Postgres (an enum's text cast isn't immutable).
- **Migrations** are four: 0019 (visit statuses), 0020 (visit corrections), 0021 (ledger kinds),
  0022 (ledger constraints), the enum additions alone in their own migration as in 4a.
- **Amend discount** is capped by `visitMoney` like a live visit's, rather than refused.
- **Contracts** gained `Visit.completedBy` (the workspace's "completed elsewhere" banner),
  `HistoryService.planId` (the treatment threads) and `Session.roles` (`{ key, name }`, in place
  of `roleNames`, for translated system role names).
- **Chart tab**: a tooth click opens the tooth-history dialog (charting and starting a visit are
  offered there); the workspace tooth panel needs a live visit, so there is no profile mode.
- **Record tabs** follow the permissions: history and chart need `visit:read`, balance
  `payment:read`; a link to a hidden tab shows the Overview. The Overview balance card now splits
  the most recent counted visit from the earlier ones too.
- **Cancel an older plan** confirms in the shared confirm dialog, not a popover.
- **French "V"** is documented in `docs/modules/clinical.md` (JSON has no comments).
