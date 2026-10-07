# Feature 7: MVP hardening — design

Date: 2026-10-06 · Status: Implemented (2026-10-06); see §Implementation notes

## Goal

Close the gaps of the MVP review without adding scope: tooth presence (missing, not erupted,
implant), a UI for balance adjustments, retry safety on three create routes, the currency lock,
an Activity screen over the audit log, the ledger re-point inside the merge transaction, and four
small fixes. Decisions H1–H9 of the feature prompt stand; this page records how they are built and
the choices the prompt left open (D1–D22).

Owner modules: `clinical` (presence, catalog effect), `billing` (adjustments, idempotency,
currency veto, merge re-point), `patients` (idempotent create), `tenancy` (currency change event),
`audit` (context columns, feed filters). No new module and no new dependency edge: `billing`
already imports `tenancy` and `patients`. Redis: the `billing` queue is removed, nothing is added.

**Out of scope:** as in the prompt (imports, scheduling, files, notifications, user management,
custom roles, multi-currency, eruption by age, prosthetic markers beyond the implant state,
emailing statements, exporting the activity log).

## Step 0

Done by the owner: the slices and migrations 0027–0032 are on `main`, and `Dental Clinic POC/` was
removed from the working tree (not part of this work). Lint and typecheck pass on the clean tree;
the tests and Playwright flows run once as the baseline before the first change.

## Where the code differs from the prompt

| Prompt says                                               | Code today                                 | This design                                                                                 |
| --------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Adjust balance is a 440px right panel like Record payment | Record payment is a centred dialog (452px) | D11: the right panel, as the prompt says (owner's decision); Record payment stays a dialog. |
| ⋯ menus on the Overview balance card and Outstanding rows | Neither exists (one button each)           | D12: add the ⋯ menu to both, holding Adjust balance.                                        |
| Default template has implant placement codes              | It has `EXT` only                          | D7: add `IMP` to the template for new clinics.                                              |
| Print styles need `@page { size: A4 }`                    | `styles.css` already has it                | H9b: verified by a Playwright print check; fix only what that shows.                        |
| Owner type default                                        | Already `dentist` for new tenants          | H9a: data migration for the older ones only.                                                |

## Decisions

| #   | Topic                             | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Presence storage                  | Append-style table `tooth_presences`: one row per time someone, or a service, set a tooth's presence. The tooth's presence is its latest live row (by `seq`); no row means `present`. History is the rows. Nothing is overwritten.                                                                                                                                                                                                                  |
| D2  | Undo and restore                  | Undo, removing the causing service, an amendment that removes or moves it, **Not finished**, and a void all soft-delete the row they made; the previous row is the presence again. A later manual change is never touched by this (extraction, then a manual "implant", then the extraction is amended away: the tooth stays an implant).                                                                                                           |
| D3  | Which wins                        | The row recorded last, whatever its date. A dentist who records today "missing since 2019" is stating what is in the mouth now. The history lists rows by their date, undated ("before first visit") first.                                                                                                                                                                                                                                         |
| D4  | Manual presence in a voided visit | Kept. Only rows made by a service are restored by a void; a presence the dentist set by hand is an observation, shown with the voided mark like the visit's other records.                                                                                                                                                                                                                                                                          |
| D5  | Discard                           | A presence set in a visit is visit content: the visit cannot be discarded (as the old `tooth_status` rule).                                                                                                                                                                                                                                                                                                                                         |
| D6  | Service effect                    | `procedures.tooth_effect` (`none`, `removes`, `implant`; `per_tooth` rows only). Read from the catalog when the service is recorded or a plan is performed; no snapshot on the service. The presence row names the service (`service_id`), which is all a restore needs. No row is written when the tooth already has that presence.                                                                                                                |
| D7  | Default template                  | `EXT` gets `removes`. New row `IMP` "Implant placement", Surgical, per tooth, price 0 (the owner sets it; agreed), not frequent, effect `implant`. The migration sets `removes` on existing clinics' live `EXT` rows; it adds no row to an existing catalog.                                                                                                                                                                                        |
| D8  | Both dentitions                   | Presence is per FDI code, primary codes included (an extracted primary molar is missing on the primary chart). The Overview's "Missing teeth · Implants" counts the teeth of the chart the patient is on.                                                                                                                                                                                                                                           |
| D9  | Retired                           | `tooth_status`, its enum, `setToothPresence`, `PUT /visits/:id/teeth/:position`, `ToothStatusChanged`, the contract schemas, `SUCCESSION_POSITIONS`, the dead `succession.*` strings. The table is dropped (the SPA has not written it since the two-chart toggle). The patient's chart toggle (`patients.dentition_override`) is separate and stays.                                                                                               |
| D10 | Adjustment permission             | `adjustBalance` and its route move to `payment:refund`. `recordOpeningBalance` stays `payment:write`.                                                                                                                                                                                                                                                                                                                                               |
| D11 | Adjustment panel                  | A 440px right panel (the patient form's panel shell), with the fields of the prompt. Reason is a select stored as text in the existing `reason` column (`write_off`, `courtesy`, `opening_balance_correction`, `charge_without_visit`, `other`); the note is the existing `note`, required (≥ 3) for `other`. Direction sets the sign. "Owes less" above the outstanding is allowed: the rest becomes credit, and the "Balance after" line says so. |
| D12 | Adjustments in views              | Payment history becomes a union: payment rows and adjustment rows (labelled by reason, signed amount). Statement, Outstanding and aging already include adjustments; the statement line gets the reason label. The row that mislabels a payment's cover of an adjustment as "Opening balance" is fixed.                                                                                                                                             |
| D13 | Idempotency storage               | On the owning rows, like payments: `ledger_entries.idempotency_key` + `idempotency_hash` (opening balance, adjustment), `patients.idempotency_key` + `idempotency_hash`. Hash = SHA-256 of the validated input. Same key and hash → the first result, re-read (201 again); same key, other hash → 409 `<area>.idempotency_mismatch`. Replays are serialised by an advisory lock on the key.                                                         |
| D14 | Idempotency header                | Required on the three routes (422 without, as payments). The header parser moves to `platform/http`. The SPA mints a key when the form opens and a new one when the payload changes between attempts.                                                                                                                                                                                                                                               |
| D15 | Currency lock                     | `tenancy` cannot read the ledger, so it asks: `updateSettings` publishes `TenantCurrencyChanging { from, to }` in its transaction when the currency changes; `billing`'s in-transaction handler throws `tenant.currency_locked` (422) when any ledger entry exists (ADR-0026's veto). `GET /billing/currency-lock` → `{ locked, currency }` for the Settings tab.                                                                                   |
| D16 | Merge re-point                    | `billing` handles `PatientsMerged` in the merge transaction: account locks on both patients, entries and payments move, the kept account is settled, audit `ledger_entry.repoint` by the merging user. The job, worker, queue registration, `repointMergedEntries` and `PatientsService.survivorOf` are deleted. A failure rolls the merge back.                                                                                                    |
| D17 | Audit context                     | `audit_log` gains `patient_id`, `visit_id` and `area` (all nullable). `AuditService.record` accepts `patientId?` and `visitId?`; `area` is derived from the action's prefix by a pure function in `contracts`, or null for rows the feed hides. Callers pass the ids they already hold. Old rows are backfilled by the migration.                                                                                                                   |
| D18 | Feed content                      | One row per thing a person did: domain-event rows (`resource_type = 'event'`) and the ledger rows that shadow a payment or a visit charge have no area and never show. Opening balances and adjustments do.                                                                                                                                                                                                                                         |
| D19 | Sentences                         | Built in the SPA from the action, the snapshots and names resolved per page: staff from the staff list, patients and visit numbers from two small batch reads. `audit` stays dependency-free. An unknown action reads as its code made readable ("Treatment plan · reprice").                                                                                                                                                                       |
| D20 | Search                            | `P-12` / `V-45` / `RCT-3` resolve to a patient, a visit or a receipt through the existing list routes and filter the feed by it; other text matches staff names (the actor) and patients' names (the subject).                                                                                                                                                                                                                                      |
| D21 | Activity paging                   | Cursor with "Load more", as the two timelines. Filters live in the URL.                                                                                                                                                                                                                                                                                                                                                                             |
| D22 | Branching                         | One branch `feat/mvp-hardening`, built in the four slices below, committed by the owner slice by slice at the end.                                                                                                                                                                                                                                                                                                                                  |

## Data model

Migrations 0033–0037 (the numbers follow the build order; see §Implementation notes).

- **0033 owners**: staff profiles of users holding the `owner` role with type `other` → `dentist`.
- **0034 idempotency**: `idempotency_key` + `idempotency_hash` on `ledger_entries` and on
  `patients`, unique partial indexes on `(tenant_id, idempotency_key)`.
- **0035 audit context**: `patient_id`, `visit_id`, `area` on `audit_log`; indexes
  `(tenant_id, area, occurred_at desc, id desc)` and `(tenant_id, patient_id, occurred_at desc)`;
  backfill from `resource_type`/`resource_id`, the snapshots' `patientId`/`visitId`, and the
  visits, services, plans, diagnoses and plan-group tables. `audit_log` stays insert-only for
  the runtime roles; the backfill runs as the migration role.
- **0036 `tooth_presences`** (tenant RLS): `id`, `seq` (identity), `patient_id`, `tooth_code`
  (the 52-code check), `presence` (enum `tooth_presence_state`: `present | missing | not_erupted |
implant`), `occurred_on date?` (the visit's local date, or the date entered; null = before first
  visit), `reason text?` (≤ 200), `dentist_id` (staff profile), `recorded_in_visit_id?` (FK),
  `service_id?`, `recorded_by`, `deleted_at?`, timestamps. Check: `service_id` set ⇒ visit set.
  Index `(tenant_id, patient_id, tooth_code)`. And `procedures.tooth_effect` (enum `tooth_effect`,
  default `none`; check `none` unless `per_tooth`), set to `removes` on live rows coded `EXT`.
- **0037**: drops `tooth_status` and the old `tooth_presence` enum.

D10 needs no migration: the owner and dentist roles already hold `payment:refund`.

## Contracts

- `toothPresenceStateSchema`; `toothPresenceRecordSchema { id, toothCode, presence, occurredOn,
reason, dentistId, dentistName, visitId, visitNumber, serviceId, serviceCode, serviceName,
recordedBy, recordedAt }`.
- `PatientChart`: `toothStatus` out, `presence: ToothPresenceRecord[]` in (live rows, oldest
  first). `ToothState` gains `presence`; `deriveChart` takes the rows and returns an entry for
  every tooth that is not `present`. `ToothHistory` gains `presence`. `ClinicalSummary` gains
  `missingTeeth`, `implants`.
- `setPresenceInVisitSchema { toothCode, presence }`;
  `setPresenceOnPatientSchema { teeth: { toothCode, presence }[] (1–52, unique), when:
{ kind: 'before_first_visit' } | { kind: 'date', date }, reason?, dentistId? }`.
- Service results (`addService`, `removeService`, `performPlan`, `markServiceUnfinished`) gain
  `presenceChange: { toothCode, presence } | null` for the toast.
- `ServiceItem` / input: `toothEffect`.
- `adjustmentInputSchema`: `reason` becomes the enum, `note` required for `other`. History item:
  `kind: 'payment' | 'refund' | 'adjustment'` with `reason` on adjustments. `currencyLockSchema`.
- `auditQuerySchema` gains `area?`, `actorUserId?`, `platformAdmin?`, `from?`, `patientId?`,
  `visitId?`, `feed?` (true = rows with an area). `AuditEntry` gains `patientId`, `visitId`,
  `area`. `ACTIVITY_AREAS` and `areaOfAction()`.

## API

**clinical**

- `VisitRecordsService.setPresence(visitId, input)` — `visit:write`, live visit lock; no-op when
  unchanged; audit `tooth_presence.set`; event `ToothPresenceChanged`.
  `PUT /visits/:id/teeth/:toothCode/presence`. `removePresence(visitId, presenceId)` — the Undo;
  only a row made in this visit and not by a service (409 `record.not_removable`).
  `DELETE /visits/:id/presence/:presenceId`.
- `PatientRecordsService.setPresence(patientId, input)` — `chart:write`, the dentist rule of
  diagnoses outside a visit, date not after the tenant's today; one row per tooth that changes;
  answers `{ chart }`. `POST /clinical/patients/:id/presence`.
  `removePresence(patientId, ids)` — rows made outside a visit (the batch Undo).
  `DELETE /clinical/patients/:id/presence?ids=`.
- A private `PresenceWriter` used by `addService`, `performPlan` (apply), `removeService`,
  `markServiceUnfinished`, `amend` (removed and moved services) and `void` (restore). All run in
  the transactions and locks those methods already hold.
- Merge re-point moves `tooth_presences` rows to the kept patient.
- Catalog: `toothEffect` through list, batch save and audit; 422 for an effect on a row that is
  not per tooth.
- `GET /visits/numbers?ids=` (`visit:read`) exposes `numbersFor` for the feed.

**billing**

- `adjustBalance` under `payment:refund`, idempotent; `createWithOpeningBalance` idempotent.
- `CurrencyLockSubscriber` and `GET /billing/currency-lock` (`tenant:read`).
- `MergeLedgerSubscriber` rewritten as the in-transaction handler (D16).
- Account history and statement per D12.

**patients** — `create(input, { idempotencyKey? })`; `GET /patients/names?ids=` (`patient:read`,
1–100: id, display number, name) for the feed.

**tenancy** — `TenantCurrencyChanging`, published only when the currency really changes.

**audit** — the new filters; callers across the modules pass `patientId` / `visitId`.

## SPA

- **Chart** (`chart/tooth-glyph`, `glyph-style`, `panel-glyph`, `chart-legend`, `tooth-title`):
  missing = dashed muted outline, diagonal cross, reduced opacity, number kept; not erupted =
  dotted lighter outline (the existing unreachable not-erupted path, now driven by presence);
  implant = normal silhouette at full opacity with a double outline and a post mark under the
  crown, legible in simple mode and in grayscale. Legend gets the three swatches. Accessible names
  gain the state, which is what the tests and Playwright read.
- **Tooth panel**: `PresenceMenu` beside the title; `PresenceBanner` under it; in a visit it
  applies at once with an Undo toast, on the record it opens `PresencePopover` (When, Reason,
  Dentist). Sections unchanged.
- **Edit presence mode** on the record's Dental chart tab (`chart:write`): floating brush toolbar,
  change counter, Done → the same popover once, Cancel and Escape with a discard confirm.
- **Service toasts** append "· tooth marked missing" / "· marked as implant"; their Undo already
  removes the service, which restores the presence.
- **Tooth history** lists presence rows; **Treatment summary** adds the missing/implant line.
- **Catalog**: "Effect on tooth" column after Frequent, a select on per-tooth rows, with a tooltip.
- **Adjust balance**: `adjust-balance-panel.tsx` behind `useAdjustBalance()`; entry points on the
  balance card, the Overview card's ⋯ menu and the Outstanding row's ⋯ menu; without
  `payment:refund` the item reads "Ask a dentist to adjust". Toast "Balance adjusted" · Statement.
- **Idempotency**: `useIdempotencyKey(payload)` used by the patient form and the adjust panel.
- **Currency**: the Settings tab's select is disabled with the helper text when locked; a 422
  from a bypass shows the same sentence.
- **Activity**: route `/activity`, nav item between Catalog and Settings under `audit:read`;
  `features/audit/` with the page, the filter bar, `sentence.ts` (action → i18n key and values),
  `changes.ts` (before/after → labelled pairs per resource type, never JSON) and the row expander.
  The two timelines get "View all activity" (`?patient=` / `?visit=`).
- Strings in `en`, `ar`, `fr`; a new `activity` namespace.

## Tests

- Domain/contract units: `deriveChart` with presence, the presence stack (latest wins, restore
  after delete), `areaOfAction`, the adjustment sign and "balance after", the payload-keyed
  idempotency hook, `sentence` and `changes` per action family.
- Integration: presence in a visit and on the record (permissions, dates, batch, undo); the
  service effects through add, remove, perform, not finished, amend (remove and move) and void;
  merge moves presence; catalog effect rules. Billing: adjustment permission and views, the 90-day
  adjustment in 61–90, idempotent replays and mismatches on the three routes including two
  concurrent requests, the currency veto, the in-transaction merge (sum of two opening balances,
  rollback on failure). Audit: filters, context columns, hidden rows.
- Tenant isolation: `tooth_presences`, the new routes, the new audit filters, the idempotency
  keys (the same key in two tenants is two results).
- SPA: glyph states, presence menu and popover, edit mode, adjust panel (direction, Full chip,
  gating), catalog column, Activity filters and sentences.
- Playwright: extraction → missing → undo → implant placement → implant mark; Edit presence batch
  at intake; adjust balance → statement; Activity filter → expand → link; receipt prints on one A4
  page. The job-path tests are deleted with the job.

## Build order

1. **Money safety (API first):** H9 fixes, currency lock, merge in the transaction, idempotency.
2. **Adjust balance:** permission, views, panel and entry points.
3. **Activity:** audit context and filters, then the screen.
4. **Tooth presence:** storage and retirement, service effects, chart rendering, panel, edit mode,
   catalog column.

Each slice ends green on its affected tests and typecheck; the full suite and Playwright run once
at the end.

## Docs

`clinical.md`, `billing.md`, `tenancy.md`, `audit.md`, `patients.md`, `auth.md` (dormant
`auth_invitations`); ADR-0034 (tooth presence replaces the succession override), ADR-0035
(currency lock by veto), ADR-0036 (ledger re-point in the merge transaction; amends ADR-0017),
ADR-0037 (audit context columns and the activity feed); CLAUDE.md §4 module map (clinical,
billing), §10 fields, §12 idempotent routes.

## Accepted limits

- A currency change racing a clinic's very first ledger entry can commit both; the entry keeps the
  old currency and shows as a second-currency balance, as today.
- A live visit started before a currency change still charges in its own currency (unchanged).
- After a failed attempt whose response was lost, editing the form and retrying is a new
  submission and can create a second record; the duplicate-patient warning is the guard there.

## Implementation notes

What was built differently from the sections above, and what to know:

- **D12, payment history.** Adjustments are a list of their own on the account
  (`PatientAccount.adjustments`), merged with the payments by the Payment history card, rather
  than a union inside `history`: the payment row type is shared with the Transactions list and
  the checkout dialog, and stayed as it was.
- **D15, the event** is named `TenantCurrencyChanged` (past tense, CLAUDE.md §9); it is published
  inside the settings transaction, before commit, like `VisitVoided`.
- **D17, audit context.** Most callers pass nothing: `AuditService.about({ patientId, visitId },
work)` is called once where a service locks the visit or the patient, and `record()` falls back
  to the resource and the snapshots. The ledger writer marks the shadow rows `hidden`.
- **D11, the panel** floats over the screen at the inline end with a scrim (the record's catalog
  drawer does the same), because it opens from three screens with different layouts. Record
  payment is untouched.
- **Presence dialog.** The patient record's When / Reason / Dentist is one small dialog, used for
  one tooth and for the Edit presence batch. The dentist select shows only for a caller who is
  not a dentist.
- **Service results** (`addService`, `removeService`, `performPlan`) carry `presenceChange`, which
  the toast appends ("· tooth marked missing"); Undo removes the service, which restores the
  tooth on the server.
- **`IMP`** sits after the POC's twelve services in the default template, so the seeded order of
  the POC rows is unchanged.
- **Migrations 0036 and 0037 are two files** because drizzle-kit asks about renames when one diff
  both creates and drops a table or an enum; the first creates, the second drops.
- **H9a.** The local dev database had no owner typed `other` (127 owners, all already dentists),
  so migration 0033 ran but changed no row there; its effect was checked by reading the SQL, not
  observed.
- **H9b.** `@page { size: A4 }` was already in `styles.css`. The Playwright flow prints a receipt
  to PDF while asking for Letter and checks one page of 595 × 842 pt.
- **Activity screen.** Changed values that are stored words are shown as stored, underscores
  removed ("cash", "in progress"); only the field names are translated. The page has no component
  spec of its own: its sentence, change and URL rules are unit-tested and the screen is covered
  by the Playwright flow.
- **Search (D20)** narrows to one record: the first staff member whose name contains the text,
  else the first patient the patients list finds, and (for `V-…`) a visit of the session's branch.
- **Tests removed with the job:** the `merge-ledger` subscriber and worker specs, the
  `repointMergedEntries` unit spec and `survivorOf`'s spec.
- **D6, re-work.** A service with an effect always writes its presence row, even on a tooth
  already in that state; the chart does not change and `presenceChange` is null. Without the row,
  removing or voiding the first of two extractions (or implant placements) on a tooth would have
  shown it present while the second still stood (found in review).
- **D3, tooth history.** Presence rows are listed in the order recorded, not sorted by date:
  the order is what decides the tooth's presence, and a row "before first visit" has no date.
- **Not finished** answers without `presenceChange`; its toast does not mention the tooth.
- **Review** (one pass over the branch): the two presence-restore defects above, the Activity
  screen's name lookups (now one per page of rows), its cache (always refetched on opening), the
  Adjust toast's balance (now the server's) and three misplaced comments were fixed.
- **Not done, for a decision:** extractions and implant placements recorded before this feature
  are not turned into presence rows; those teeth chart as present until someone marks them.
