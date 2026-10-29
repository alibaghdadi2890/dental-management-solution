# ADR-0065: Ticked work starts on Perform; finished or continues is asked at Complete

- Status: Accepted
- Date: 2026-10-29
- Amends: ADR-0048 (#7 and the Perform rows), ADR-0064 (Not finished as the exception)

## Context

A treatment visit's ticked work waited on Perform in "Planned for today" until the dentist
pressed Complete or Not finished on each row, so it was picked twice. And most work takes more
than one visit, so "done unless marked not finished" asked for the exception on most rows. Since
ADR-0064 work is charged when it starts: finishing changes no money, only the plan's status and
the tooth. Design: `docs/superpowers/specs/2026-10-29-start-ticked-work-and-finish-check-design.md`.

## Decision

1. **Entering Perform starts the ticked work.** Each time the steps view enters Perform, every item
   of the visit's list it has not worked on gets this visit's session (`recordSession`): planned
   work with the line that charges it, work in progress at no charge. It is listed in Today's
   services. "Planned for today" is removed; its photo button moves onto those rows. The All
   view starts nothing. Planned work the visit already has a line for, without a plan (a
   hygiene visit's automatic scaling and the planned one), is not started: it would be charged
   twice.
2. **Taking work back takes it off the list.** Removing the line, Not today, or unticking a
   started item on Today's work undoes the start and unticks it, so the next Perform does not
   start it again.
3. **The check before Complete** (the dialog that asked about open diagnoses) first asks, of each
   in-progress plan the visit worked on and each service added by hand, **Finished** or
   **Continues**. A plan starts on Finished only on its last estimated session; a service added
   by hand starts on Finished. Its diagnoses list follows the switches, and a diagnosis a Finished
   plan treats is ticked to resolve. The answers apply through the existing routes
   (`performPlan`, `markUnfinished`, `resolveDiagnosis`).

4. **Complete visit on the Complete step completes.** The step shows what the Visit Summary
   did, so the summary is skipped: unsaved edits are sent, writes in flight awaited, and the
   visit completes and lands on the record's payment dialog. If the check has something this page
   has not asked, it opens first and its button completes. The All view's Review & complete keeps
   the summary.

## Consequences

- SPA only; the API is unchanged. `recordSession` is idempotent, so starting twice is harmless.
- Work nobody answered for stays in progress: nothing is closed by mistake, and the charge is
  already right.
- A visit with any service added by hand now shows the check; one click keeps the suggestions.
- ADR-0048 #7 ("picking records nothing") still holds for ticking: the start waits for Perform.
