# Unfinished services — design

Date: 2026-10-05 · Status: Implemented (2026-10-05); see §Implementation notes

## Goal

Work over several visits (ADR-0032) is shown and managed as a **service**, not as a plan. The
dentist adds a service as usual, marks it not finished when the visit runs out, is asked about it
when the next visit opens, and completes it in whichever visit finishes the work.

Mockups: https://claude.ai/artifact/JLT1GLFoXYmABKRUSy4mTn

Owner module: `clinical` (API, contracts, SPA). The model of ADR-0032 stays: an unfinished service
is a plan `in_progress` with one session per visit that worked on it, charged by the visit service
created when it is completed. `billing` is unchanged. No new dependency edge.

**Out of scope:** partial charges; a note per visit on unfinished work (the API stores one, the SPA
still does not ask); an "unfinished" chip on the patient header, the Start visit popover and the
Today board; scheduling the next visit.

## Decisions

| #   | Topic          | Decision                                                                                                                                                                                                                                                                                                             |
| --- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | Adding         | A service is added as today. Nothing is decided up front: the drawer's **Start, finish later** and the plan rows' **Start** are removed. A planned procedure is started by **Perform now**, then marked not finished.                                                                                                |
| U2  | Not finished   | A service row's three-dot menu has **Not finished**. It turns the visit service into unfinished work in one transaction: the service is removed, its plan (created if the service had none) becomes `in_progress` at the service's price, with this visit's session.                                                 |
| U3  | Charge         | Only the visit that completes the service charges it, at the full price (ADR-0032, unchanged). An unfinished row shows its price; it is not in the visit's subtotal.                                                                                                                                                 |
| U4  | Complete       | An unfinished row worked on in this visit has a visible **Complete** button: today's perform on an `in_progress` plan. Its menu has **Not today** when the work was continued in this visit (removes this visit's session), or **Remove** when it was first added in this visit (undoes U2 and removes the service). |
| U5  | Popup          | When a live visit is opened by a user with `visit:write`, and the patient has unfinished work this visit has not worked on, and the visit has not answered yet: a dialog lists it, one checkbox each (ticked), with **Continue** and **Not today**. Asked once per visit.                                            |
| U6  | Continue       | Continuing logs this visit's session; the row joins today's services, still not finished. A visit that ends that way records the work at no charge and the service carries on.                                                                                                                                       |
| U7  | Not today      | Nothing is recorded. The work stays in a highlighted **To continue** block at the top of the Today's services card; its menu has **Continue** and **Cancel** (abandon at no charge, as today).                                                                                                                       |
| U8  | Where it shows | Unfinished work leaves the Treatment plan card and the tooth panel's plan section. It shows in Today's services, in the tooth or level panel beside today's treatment, and read-only on the patient record's Chart tab (with **Cancel**).                                                                            |
| U9  | Middle visits  | Every visit with a session lists the service as "started / continued, not finished · no charge": review dialog, post-visit summary, Visits list detail panel, record History tab, tooth history.                                                                                                                     |
| U10 | Estimate       | The Treatment plan card and its estimate cover `planned` work only. Today's services shows "Carried forward" (the sum of unfinished prices). The quote printable still includes unfinished work: it is yet to be billed.                                                                                             |
| U11 | Labels         | Short buttons: **Complete**, **Continue**, **Not today**, **Not finished**, **Cancel**. The badge reads "Not finished".                                                                                                                                                                                              |

## Data model

Migration 0031: `visits.unfinished_answered_at timestamptz null`. Set by U5's answer; never
cleared. No other schema change.

## Contracts

- `Visit`: `unfinishedAnsweredAt: string | null`.
- `answerUnfinishedInputSchema { continue: planId[] }` (may be empty: "Not today").
- `planTreatmentInVisitInputSchema` loses `start`.

## API

`VisitRecordsService`, `visit:write`, existing visit and patient locks:

- `markServiceUnfinished(visitId, serviceId)` — U2. The service must belong to this live visit
  (404 otherwise). The plan takes the service's base price; a line discount is not carried and is
  given again on the completing visit. Audit `visit_service.unfinished`;
  emits `TreatmentStarted` (and `TreatmentPlanned` when it created the plan).
  `POST /visits/:id/services/:serviceId/unfinished`.
- `answerUnfinished(visitId, { continue })` — U5. Records a session for each listed plan (each
  must be `in_progress` for this patient, 409 `plan.not_in_progress`), stamps
  `unfinished_answered_at`. Idempotent: a second call records any new sessions and keeps the
  first stamp. Audit `visit.unfinished_answered`. `POST /visits/:id/unfinished-answer`.
- `recordSession`, `removeSession`, `performPlan`, `cancelPlan`: unchanged (Continue, Not today,
  Complete, Cancel).
- Removed: `startPlan` and `POST /visits/:id/plans/:planId/start`; the private `start` step stays
  for U2.
- The row's **Remove** (U4) is `removeSession`, then `removePlan` when the plan was recorded in
  this visit; a plan from before returns to `planned` (M4) and shows in the Treatment plan card.

The stamp is not visit content: a visit with only an answer can still be discarded.

## SPA

- `TodaysServices`: always rendered in a live visit that has services or unfinished work. Order:
  **To continue** block (unfinished, no session in this visit), then the visit's rows — services
  and unfinished work with a session here, in the order added. Footer: "Charged today" and
  "Carried forward".
- New `ServiceRowMenu` (three dots): replaces the bare **Remove** link; holds Not finished and
  Remove, or the U4 / U7 items for an unfinished row.
- New `UnfinishedDialog` (U5), opened by the workspace from `visit.unfinishedAnsweredAt` and the
  chart's plans.
- `InProgressPlan` is replaced by the unfinished row; the plan board, the tooth panel and the
  level panel stop listing `in_progress` plans under plans (U8).
- Drawer and plan rows lose the Start actions (U1).
- Review dialog and summaries: groups "Finished today" and "Not finished · continues next visit"
  (U9); the Visits list detail panel and the History tab read a visit's sessions from the chart's
  plans.
- Strings in `en`, `ar`, `fr`; the removed keys are deleted.

## Tests

- Integration (extends the multi-visit spec): add a service, mark it not finished (service gone,
  plan in progress at the edited price, one session); answer the next visit with continue and
  with not today; a middle visit completes with total 0 and a session; complete in visit 3 with
  one charge there; Remove of work first added in the same visit; the answer's idempotency.
- Tenant isolation: the two new routes.
- SPA: the row menu's items per state; the dialog's show conditions (permission, answered,
  nothing unfinished); the card's ordering and totals.
- Playwright (replaces the start/continue flow): root canal added in visit 1 and marked not
  finished, popup in visit 2 answered Continue, completed in visit 3; the charge appears only on
  visit 3 and the history shows all three visits.

## Implementation notes

- Migration 0031 (`unfinished_answer`).
- Today's services lists the visit's services first, then the unfinished services it worked on;
  a plan's session carries no time the SPA could order the two by.
- The three-dot menu also replaces **Remove** on the tooth and level panels' service cards, so
  **Not finished** is offered wherever a service of the visit is shown. The unfinished row and
  its menu are one component (`workspace/unfinished-row.tsx`) used by Today's services, the tooth
  and level panels and the patient record's Chart tab.
- `answerUnfinished` answers `{ visit }` like the other visit routes.
- A plan whose price differs from the service marked not finished is audited as
  `treatment_plan.reprice`.
- A visit's unfinished work is a highlighted line "Session N · No charge" under its
  services in the Visits list detail panel, the record's History tab and the checkout dialog
  (`visit-unfinished-lines.tsx`, from the chart's plans). The tooth history shows the plan with a
  "Not finished" badge; the chart legend and tooth title say "Not finished" too.
- The review dialog's "Recorded for later" lists diagnoses and planned procedures only; unfinished
  work has its own group above it.
- From the review: removing the service that completed work only this visit worked on removes
  that work too (its session, and the plan when this visit recorded it), so a removed service
  never returns as an unfinished one; **Not finished** first saves a price edit still on its way,
  and is refused if that save fails; a refused popup answer refetches the chart.
- Known limit: **Not finished** and **Complete** have no in-flight guard; a double click answers
  404 or 409 with a failure toast, and charges nothing twice.

## Docs

`docs/modules/clinical.md` (routes, the removed start); a note at the foot of the 2026-10-04
levels spec pointing here. ADR-0032 stands: the storage and charging rules do not change.
