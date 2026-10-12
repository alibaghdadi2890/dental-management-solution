# ADR-0045: Priority is the phase of the treatment plan; named plan groups are retired

- Status: Accepted
- Date: 2026-10-10

## Context

A patient's planned treatments could be put into named plan groups (`plan_groups`,
`treatment_plans.group_id`): "Phase 1", "Whitening option". The groups were free text, optional,
and used by few screens. The quote ignored them, the totals ignored them, and nothing said which
group came first.

Feature 10 needs the plan to answer two questions on every screen that shows it: what must be
done first, and has the patient agreed to it. A second way to group the plan, beside the first,
would have left every list to choose between them.

## Decision

1. **Every planned treatment has a priority**: `urgent`, `high` or `elective`
   (`treatment_plans.priority`, enum `plan_priority`, required). The plan inputs require it. The
   SPA offers `high` first.
2. **The priority is the phase.** The plan is always shown, totalled and quoted by priority, in
   that order. `planPhases` in `contracts` builds the three phases — for each, the open items
   (work in progress first), the done items and the total of what is open — and every list of the
   plan is built from it: the Treatment plan tab, the Overview card, the Plan step, the workspace
   board and the quote.
3. **Named plan groups are removed**: the table, the column, the service methods, the routes,
   the audit actions, the dialog and the board's grouping. Migration `0040` drops them with their
   data. The application has no deployed data.
4. **The priority changes while the plan is open** (409 `plan.not_open` otherwise). On the
   patient record it needs `chart:write`. In a visit, `visit:write` sets the priority of a plan
   made in that visit, because that is charting in the visit; an older plan is prioritised on the
   record (409 `plan.not_of_visit` from the visit).
5. **A plan is proposed until the patient accepts it**: `accepted_at` and `accepted_by`, both or
   neither. Acceptance is set and withdrawn from the Treatment plan tab (`chart:write`). It can be
   withdrawn only while the plan is still `planned`.
6. **Work accepts the plan.** Starting or performing a plan that was never formally accepted
   records the acceptance, by whoever does the work, at that moment. Work that was done was
   agreed to; the record should not say otherwise. It is in the audit row of the start or the
   perform. Undoing that work back to `planned` takes that acceptance back with it; one the
   patient gave before the work stands. `TreatmentAccepted` is published only for an acceptance
   set or withdrawn by hand.
7. **A plan keeps its link to the diagnosis it treats**, shown as _For_. `planTreatment` takes
   an optional `diagnosisRecordId`, which must be an active diagnosis of the patient on the same
   tooth. Without it the tooth's most recent active diagnosis is linked, as before.
8. **A done row stays in its phase**, dimmed and last. The phase's total counts only what is
   still open.

## Consequences

- A quote is the plan by phase with a total per phase, and can be printed for one phase alone
  (`/print/quote/:patientId?priority=`).
- The Overview's _Needs attention_ lists an urgent plan as a next step only once it is accepted.
- Events: `TreatmentPrioritised { planId, patientId, priority }` and
  `TreatmentAccepted { planId, patientId, accepted }`.
- A clinic that wants options side by side ("crown or onlay") has no structure for it. That was
  the one thing groups could express. It is out of scope until someone asks for it.
- Existing development rows got `priority = 'elective'` in migration `0043`.
