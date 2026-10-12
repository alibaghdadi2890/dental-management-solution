# ADR-0044: A visit has a type; its steps are derived, only the current step is stored

- Status: Accepted
- Date: 2026-10-10

## Context

Until feature 10 every visit opened on the same workspace: the chart, today's services, the
treatment plan, files and notes, all at once. A dentist seeing a new patient and a dentist
finishing a root canal got the same screen, and each had to look past most of it.

Feature 10 makes a visit open on what it is for. The visit is given a reason when it starts, and
the reason decides which screens it shows and in which order. Three things had to be decided:
what is stored, where the rules live, and what "done" means for a step.

We considered storing the flow itself: a row per step with a "done" flag set when the step was
left. The design prototype works this way. It makes the flag a second copy of facts the visit
already holds. An Undo then leaves a tick with nothing behind it, and two devices on the same
visit disagree about which steps are done.

## Decision

1. **A visit has a type**, chosen at start and never changed: `examination`, `emergency`,
   `treatment`, `hygiene` or `consultation` (Postgres enum `visit_type`). The type is shown
   wherever the visit is named.
2. **Each type has a fixed sequence of steps**, from eight step keys: `intake`, `complaint`,
   `examine`, `findings`, `plan`, `today`, `perform`, `complete`. A step's label belongs to the
   pair (type, step): `plan` reads "Proposal" in a consultation; `perform` reads "Treat now" in an
   emergency.
3. **The step model is pure and shared.** `packages/contracts/src/visit-flow.ts` holds
   `stepsOf`, `firstStep`, `hasStep`, `isOptionalStep`, `stepLabelKey`, `doneSteps` and
   `suggestVisitType`. The API validates and stores with them; the SPA draws the stepper from
   them. Neither has a second copy of the rules.
4. **Only the current step and the view are stored**: `visits.current_step` (a step key) and
   `visits.view_mode` (`steps` or `all`). Both are last write wins, like the notes. A paused
   visit, another screen and another device open on the same step and view.
5. **Done is derived, never stored.** A step is done when the visit holds what that step
   records (`doneSteps` over `VisitFlowFacts`): a confirmed history or a reason for Intake, a
   diagnosis of this visit for Findings, a plan made in it for Plan, and so on. Removing the
   record removes the tick. `complete` is never ticked on a live visit.
6. **An examination or a consultation has an optional Perform step**, for the dentist who
   examines and treats in one sitting. It is always shown and the stepper marks it "optional"
   until the visit holds work. The first design showed it (as "Treatment") only once the visit
   held work; in use that left no visible place to add a service during an examination, so the
   step is permanent. A type's steps therefore never change during a visit, and the stored step
   needs no resolving.
7. **The steps are navigation, never a gate.** Every step opens at any time, _Complete_ is always
   reachable, and the All view is the workspace as it was before the flows.
8. **The suggested type** is `treatment` while the patient has an open plan, else what a new
   patient was registered for (`patients.first_visit_type`) when they have no counted visit, else
   `examination`.

## Consequences

- The files linked to a visit count towards Examine's tick, but `clinical` cannot import
  `files`. `doneSteps` takes the file count as a fact and the SPA supplies it. The API never
  needs the ticks: the Today board shows the current step only.
- `visit.step` and `visit.view` are audited but hidden from the Activity feed. A row per step
  change would bury everything else.
- Adding a sixth type or a ninth step is a change to one file in `contracts`, a migration for the
  enum or the CHECK, and the labels.
- A visit imported later (feature 6) gets type `treatment` and `current_step = 'complete'`.
- Existing development rows got `type = 'treatment'` in migration `0043`.
