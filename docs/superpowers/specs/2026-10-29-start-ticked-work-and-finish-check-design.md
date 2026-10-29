# Ticked work starts on Perform; the dentist says what was finished before Complete

Date: 2026-10-29. SPA only, no API change. ADR-0065 (amends ADR-0048 #7 and ADR-0064's default).

## Why

- A treatment visit's ticked work waited in "Planned for today" until the dentist pressed
  Complete or Not finished on each row: picked twice.
- Most work takes more than one visit, so "done unless marked not finished" is the wrong default.
  Since ADR-0064 work is charged when it starts, so finishing changes no money: only the plan's
  status and the tooth.

## Decisions

1. **Entering Perform starts the ticked work.** Each time the steps view enters Perform (the Today's
   work row's Perform, the footer, the stepper, or a hygiene visit opening on it), every ticked
   item this visit has not worked on is started with `recordSession`: planned work gets its line
   at the plan's price, work in progress this visit's session. Each item is tried once per stay on
   Perform; a failure is a toast. The All view starts nothing. Planned work the visit already
   has a line for, without a plan, at the same place (a hygiene visit's automatic scaling and
   the planned one) is not started, so it is never charged twice.
2. **The work shows in Today's services** as its in-progress row. "Planned for today" is removed;
   its Before/After photo button moves onto the row of a ticked item in Today's services.
3. **Taking work back unticks it.** Remove or Not today on a ticked item, once done, takes it off
   the list (`DELETE /worklist/:planId`), so the next Perform does not start it again. Unticking a
   started item on Today's work undoes its start (removes the line that charges it here, else the
   session). Completed items stay ticked, as before.
4. **The check before Complete** (entering the Complete step, and the Visit Summary's Complete
   visit for what the first check did not show) is one dialog, "Before you complete", with:
   - **Work done today**: each in-progress plan this visit worked on, and each service added by
     hand without a plan, with a **Finished | Continues** switch. Defaults: a plan with an
     estimate is Finished on its last estimated session, else Continues; without an estimate,
     Continues; a service without a plan, Finished. Work completed explicitly (performed plans,
     completed-here rows) and services the visit type added are not asked about.
   - **Diagnoses still open**: `diagnosesToResolve` on the visit as the choices would leave it.
     A diagnosis a Finished plan treats (`diagnosisRecordId`) is ticked by default; the rest
     unticked. The list follows the switches.
   - The primary button applies the choices in order — `performPlan` for Finished plans,
     `markUnfinished` for Continues services, then `resolveDiagnosis` — then moves on. A failure
     stops there with the error; what was applied leaves the lists. Back changes nothing.
   - The dialog shows only when one of the two lists has something.
5. Everything shown is acknowledged for the rest of the page's life: the summary's check asks only
   about the rest.
6. **Complete visit on the Complete step completes at once** (`useFinishVisit`): no Visit
   Summary, since the step shows the same. It flushes edits, waits for writes, runs the check if
   something is still unasked (its button reads Complete visit), completes, and lands on the
   record's payment dialog. Review & complete in the All view keeps the summary.

## Files

- `dialogs/complete-check.ts` (+ spec): `workToFinish`, `projectChoices`, `suggestedResolves`.
- `dialogs/complete-check-view.tsx` replaces `resolve-check.tsx`; `dialogs/use-apply-check.ts`.
- `dialogs/before-complete-dialog.tsx` replaces `resolve-before-complete-dialog.tsx`;
  `visit-summary-dialog.tsx` uses the same view.
- `flow/use-start-worklist.ts`; `flow/use-finish-visit.ts`; `flow/photo-button.tsx`; `planned-today.tsx` removed.
- `workspace/visit-workspace-page.tsx`, `workspace/todays-services.tsx`,
  `workspace/charting-actions.ts`, `flow/steps/today-step.tsx`, locales.
- Tests: the pure module's spec; summary dialog, flow and today's services specs; e2e flows.
