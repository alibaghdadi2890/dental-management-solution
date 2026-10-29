# Charge at start, refund from the record, diagnoses on a jaw or the mouth — design

Date: 2026-10-29. ADR-0064 (amends ADR-0032 and the unfinished services spec of 2026-10-05).

## Ask

1. Work over several visits is charged in the visit that starts it, at the full price, not in
   the visit that finishes it: patients pay during the treatment.
2. Cancelled work keeps its charge. The money goes back by a **Refund** on the patient record: a
   dialog lists the patient's latest payments; one is picked and refunded in full or in part.
3. A diagnosis can be on a jaw or the whole mouth, as services can.

Paying more than is owed already exists (Record payment → Pay in advance) and is out of scope.

Owner modules: `clinical` (1, 3), `billing` SPA only (2). No new dependency edge, no new event,
no new permission. One new route (`reopenPlan`, S6).

## 1. Charge at start (ADR-0064)

### Decisions

- **S1. The line stays.** **Not finished** no longer removes the visit service: the line stays in
  this visit, at its price and line discount, and is charged when the visit completes. The line
  carries the plan (`visit_services.plan_id`): the one it performed, put back, or a new one from
  the line's snapshot. The plan becomes `in_progress` with this visit's session. The line no
  longer changes the tooth (presence reverted, H2), as today.
- **S2. Starting planned work charges too.** A planned item taken on as Not finished
  (`recordSession` on a `planned` plan, ADR-0048) creates its line in this visit at the plan's
  price, tooth and surfaces, then starts the plan. Starting is one rule: a line in this visit,
  `in_progress`, this visit's session.
- **S3. Continue** logs a session at no charge, as today.
- **S4. Complete** (`performPlan` on an `in_progress` plan) marks the plan performed in this
  visit. **It creates a line only when no line carries the plan** (in any visit, voided ones
  included). That covers work left unfinished before this change and a starting line removed by a
  correction. A voided starting visit keeps its line, so Complete charges nothing (as a voided
  visit's work is never rewound, ADR-0032). The tooth effect of the carrying line is applied at
  Complete. `TreatmentPerformed` carries the carrying line's `serviceId`.
- **S5. Cancel** abandons the work; the charge stays. The line keeps its plan link.
- **S6. Undo in a live visit.**
  - Remove of an unfinished row started here: removes the line, this visit's session, and the plan
    when this visit recorded it (else the plan goes back to `planned`). One action.
  - Removing a carrying line from a live visit by any other path does the same.
  - Not today on a continued row: removes this visit's session only (unchanged).
  - Undo of a Complete that added no line: the completed row's menu has **Not finished**, which
    calls `reopenPlan` (`POST /visits/:id/plans/:planId/reopen`, `visit:write`). The plan must be
    performed in this visit with its carrying line in another visit (else 409 `plan.not_open`).
    It goes back to `in_progress`, `performed_*` is cleared, this visit's session stays, and it is
    audited `treatment_plan.unperform`. A Complete that did add a line (old work) is undone by
    that line's own **Not finished** (S1), which keeps the line here as the carrying one.
- **S7. Corrections and void of the starting visit** (ADR-0025, ADR-0062).
  - Removing a carrying line in a correction un-performs the plan only when it was performed in
    that visit (an old one-visit service). A line whose plan is `in_progress` or was performed in
    a later visit is removed and the plan's status stays. The work is then uncharged until
    Complete charges it (S4).
  - A repriced carrying line follows the correction's rules. Void reverses the charge as for any
    visit.
- **S8. The invariant, restated.** A live line with a `plan_id` is that plan's one charge. Its
  plan is `in_progress` (started in the line's visit), `performed` (in the line's visit or a later
  one), or `cancelled` (abandoned after it started). `visit_services_plan_unique` still allows one
  line per plan.

### Reads

- `TreatmentPlan` gains `chargedIn: { visitId, number } | null`: the visit of the live line that
  carries it.
- `planWork` / `listUncharged`: a plan is work still to charge when it is `planned` or
  `in_progress` with no carrying line, or its carrying line's visit is still live. Advances
  (ADR-0051) and the quote follow. Work already charged at its start is out of the estimate and
  out of "Carried forward".
- Chart: a line counts as treatment (paint, "treated today", tooth history "treated") only when
  it has no plan or its plan is `performed`. A line whose plan is `in_progress` shows as the plan's
  Not finished. A line whose plan is `cancelled` shows in the tooth history with a "Cancelled"
  badge and paints nothing.
- Billing is unchanged: it charges a completed visit's lines. A carrying line has a `planId`, so a
  held advance covers it from the first visit (plan share).

### SPA

- Today's services: an unfinished row started in this visit counts in "Charged today" and shows
  its price. A row carried from an earlier visit shows "Charged on visit #N" and adds nothing.
  "Carried forward" counts only work still to charge (old in-progress work).
- Review dialog, post-visit summary, Visits list detail panel, History tab: the starting visit
  lists the line with its price and a "Not finished" badge, and no separate "Session · No charge"
  line. Later sessions read "Session N · No charge" as today. The completing visit lists the work
  as "Completed · charged on visit #N".
- The Cancel confirmation says "Charged on visit #N. To give money back, use Refund on the
  patient's balance." when the work was charged.

## 2. Refund from the patient record

- **R1.** The balance card on the patient record (Overview and Balance & payments) gains
  **Refund** for `payment:refund`, shown when the patient has a payment with something left to
  refund.
- **R2.** The dialog's first step lists the patient's payments, newest first (at most 10): receipt
  number, date, method, amount, and refunded so far. Voided and fully refunded payments are listed
  disabled. A household payment the patient paid as payer is listed too.
- **R3.** Picking one opens the existing refund form (`RefundDialog`): the amount (what is left by
  default, editable for a partial refund), method and reason. **Back** returns to the list.
- **R4.** Data: `GET /billing/patients/:id/account` history (`payment:read`). The refund itself is
  `POST /billing/payments/:id/refund`, unchanged. `RefundDialog` takes a narrow payment shape
  (id, receipt number, amount, refunded, method, currency) so both callers can use it.

## 3. Diagnoses on a jaw or the whole mouth

### Decisions

- **D1. Catalog.** `diagnoses.level` takes the services' unit values (`per_tooth`, `per_jaw`,
  `per_mouth`; the existing `charge_unit` enum), default `per_tooth`. A colour is required only
  per tooth; a row moved to a jaw or the mouth keeps the colour it had (the services' rule,
  ADR-0054). The Catalog screen's diagnosis form gains the Level select, and Colour is hidden off
  the tooth. Migration: every existing row is `per_tooth`.
- **D2. Records.** `patient_diagnoses` gains `level` (a snapshot) and `jaw`. `tooth_code`
  becomes nullable. Checks: tooth iff `per_tooth`, jaw iff `per_jaw`, surfaces only on a tooth.
  Wrong target → 422 `visit.tooth_required` / `visit.jaw_required` / `visit.jaw_not_allowed`
  (the existing `assertTarget` codes). `recordDiagnosis` inputs (visit and patient record) gain
  `jaw?`, and `toothCode` becomes optional. `DiagnosisRecord` gains `level` and `jaw`.
- **D3. Linking.** A plan links the target's most recent active diagnosis of its own level: a tooth
  as today, the same jaw for `per_jaw`, the mouth for `per_mouth`. An explicit
  `diagnosisRecordId` must match level and target (422 otherwise, as today for teeth).
- **D4. Seen on** (ADR-0049) is unchanged. A file cited for a jaw or mouth diagnosis need not be
  linked to a tooth.
- **D5. Recording in the SPA.** The chart's jaw bars and Whole mouth pill already select a level;
  the level panel (`area-panel.tsx`) gains a **Diagnoses** section like the tooth panel's: the
  open diagnoses of that level, with Resolve and Remove, and **Add diagnosis**, which opens the
  catalog drawer filtered to that level's diagnoses (a per-jaw one commits on the selected jaw). The
  same panel serves the patient record's Chart tab.
- **D6. Shown everywhere a diagnosis is.** The Findings and Plan steps' diagnosis cards (a jaw
  or mouth diagnosis gets a card; its proposals are services of the same level), Overview "needs
  attention", the open-diagnoses check at Complete, the History tab, review dialog and Activity
  name the place "Upper jaw", "Lower jaw" or "Whole mouth" where a tooth would be
  (`useLevelLabel`).
- **D7.** Imports have no diagnoses; nothing to change there.

## Migration 0055

- `diagnoses.level charge_unit not null default 'per_tooth'`; `diagnoses.color` nullable; check
  `level <> 'per_tooth' or color is not null`.
- `patient_diagnoses.level charge_unit not null default 'per_tooth'`, `jaw jaw null`;
  `tooth_code` drops `not null`. Checks: tooth matches level, jaw matches level, surfaces empty off
  a tooth.
- No data rewrite. Lines removed by Not finished before this change stay removed, so old
  unfinished work keeps charging at Complete (S4).

## Tests

- Domain: the Complete rule (charge or not) and the restated undo, in `plan-lifecycle`; the
  diagnosis target rule.
- Integration (clinical, real Postgres):
  - Not finished keeps the line, and visit 1 completes with the charge.
  - Continue in visit 2 completes at 0; Complete in visit 3 charges nothing.
  - Old in-progress work (no line) is charged at Complete.
  - A planned item started from the worklist charges.
  - Remove of a row started here takes the line, session and plan.
  - Correction removing a carrying line leaves the plan `in_progress`, and Complete charges it
    later.
  - Voided starting visit: Complete charges nothing.
  - `planWork` excludes work charged at its start.
- Billing integration: a held advance covers the starting visit's line.
- Integration: jaw and mouth diagnoses, their target errors, plan linking by level, and the
  catalog level.
- Tenant isolation: `reopenPlan`, and the diagnosis routes with a jaw target.
- SPA: the refund picker (list, disabled rows, back, partial amount); the level panel's diagnoses;
  Today's services totals for charged and carried rows.
- Playwright: the unfinished-services flow now expects the charge on visit 1 and none on visit 3.
  The acceptance flow adds a whole-mouth diagnosis.

## Docs

ADR-0064 "Work over several visits is charged in the visit that starts it" (amends 0032).
`docs/modules/clinical.md` (Not finished, Complete, diagnosis levels), `docs/modules/billing.md`
(refund from the record), CLAUDE.md §4 `clinical` row (diagnosis level, charge at start), and a
note at the foot of the 2026-10-05 unfinished services spec pointing here.

## Implementation notes

- **D1 simplified:** every diagnosis keeps a required colour (assigned automatically, as today); a
  jaw or mouth one is not painted, so its colour is unused. This avoided making `color` nullable
  wherever the chart reads it. The default catalog's Bruxism is whole mouth.
- The Complete rule lives in `PlanChartingService` (`lockCarrying ?? chargeHere`), not in
  `domain/`; the integration specs cover it.
- `FileCitation` diagnoses carry `jaw` and a nullable `toothCode`.
- The open-diagnoses check at Complete lists a jaw or mouth diagnosis only through a plan for it
  performed in the visit: every visit has a whole-mouth service (the examination). A line that
  charges unfinished work does not count as done there.
- SPA: the line that charges unfinished work is shown once, as the unfinished row (with the
  line's price) in Today's services and the tooth and level panels. Work completed here and
  charged earlier is a "Completed · Charged on visit V-…" row whose menu has **Not finished**
  (`reopenPlan`). Under a finished visit's services, the starting visit's line reads "Session 1 ·
  Charged in this visit". The tooth panel's "Previously" leaves out lines of work still in
  progress and badges those of cancelled work "Cancelled".
- A held advance whose plan has nothing left to charge once the work is charged at its start is
  released to credit by settle, as ADR-0051 says for a closed plan.
- From the review:
  - A correction may not remove a line that charges work a later visit completed (422
    `visit.amend_plan_linked`); otherwise that work would be done and charged nowhere, and the
    tooth effect the later visit applied would be undone. Reopen it in that visit first.
  - The Undo of starting planned work (Planned for today's row, the Continue toast) removes the
    line it added.
  - The Undo of a Complete with no line here reopens the plan.
  - The Complete toast's Undo depends on whether a line already charged the work.
  - Today's services counts the rows it lists to decide whether it is empty.
- Found in testing: the open-diagnoses check at Complete counted only the visit's own lines, so
  work completed in a visit and charged by an earlier one raised no check. It now counts that work
  too (`diagnosesToResolve`: the visit's finished lines plus the plans performed in it whose line
  is elsewhere; `DiagnosisToResolve.done`).
