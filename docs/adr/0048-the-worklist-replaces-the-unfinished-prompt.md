# ADR-0048: A treatment visit keeps a list of planned work for today; the unfinished prompt is retired

- Status: Accepted (amends ADR-0032)
- Date: 2026-10-10

## Context

Work over several visits is a plan in progress, with one session per visit and one charge when it
is done (ADR-0032). Every visit used to ask once, as it opened, whether to continue the patient's
unfinished work, and stored that it had asked (`visits.unfinished_answered_at`). The prompt
interrupted visits that had nothing to do with that work: an examination, an emergency.

With visit types (ADR-0044) the question has a natural place. A patient who comes to have planned
work done is in a treatment visit, and what they came for is known when the visit starts.

## Decision

1. **The list is picked in the visit, on Today's work, not in the Start visit popover.** The
   first design put the plan's rows in the popover ("From the plan, for today"). In use the rows
   went unnoticed there, and a visit started with an empty list had no way to fill it. Today's
   work now shows the whole open plan by priority, each treatment with a checkbox.
2. **A treatment visit starts with the work in progress and the urgent plans on its list**
   (`defaultWorklist` in `contracts`), unless its opener names the plans: a Needs attention row
   starts a visit for its own plan (`planIds`, treatment only, 422 `visit.plans_not_allowed`;
   each an open plan of the patient, 422 `visit.plan_invalid`).
3. **The list is stored as the visit's worklist**: table `visit_plan_items` (`visit_id`,
   `plan_id`, `position` — the order they were put on it —, `added_by`), primary key (visit,
   plan), composite foreign keys, hard delete.
4. **Ticking and unticking are the only two changes**: `PUT` and `DELETE
/visits/:id/worklist/:planId` (`visit:write`, a live treatment or hygiene visit, an open plan
   of the patient). There is no separate "Not today": a treatment that is not for today is not
   ticked. Both are audited, hidden from the Activity feed.
5. **A hygiene visit takes the patient's open whole-mouth plans by itself.** It has no list to
   pick from, and a planned scaling is what it is for.
6. **The worklist is not visit content.** It says why the visit was opened. A visit with only a
   worklist can be discarded.
7. **Picking a plan records nothing on the plan.** A session is logged when the dentist says the
   work was not finished, as before. The design prototype logs it at start; that would leave a
   session on every plan the dentist then set aside.
8. **Not finished on a planned item starts the work.** `recordSession` on a plan that is still
   `planned` moves it to `in_progress` with this visit's session, and accepts it (ADR-0045). The
   undo removes the session, and a plan with no session left goes back to `planned`.
9. **The once-per-visit prompt is removed**: `answerUnfinished`, its route,
   `visits.unfinished_answered_at`, the card and the dialog. An examination, emergency, hygiene
   or consultation visit never pulls work in progress by itself. The dentist can still continue
   it from the tooth panel or from Today's services.

## Consequences

- Today's work is the plan with its ticks; Perform lists the ticked items as rows with
  Complete, Not finished and Undo. Where an item stands is derived from the plan: performed in
  this visit, a session in this visit, or open. An item the visit worked on stays ticked.
- "Session n of m" is the plan's sessions before this visit plus one, over
  `treatment_plans.estimated_sessions` (ADR-0047).
- Unplanned work added during the visit goes to Today's services; it is not on the list.
- Migration `0044` drops `skipped_at`, which the first design used for "Not today".
- An item has no patient of its own. It follows its visit and its plan through a patient merge.
