# ADR-0064: Work over several visits is charged in the visit that starts it

- Status: Accepted
- Date: 2026-10-29
- Amends: ADR-0032 ("charged when it is done"), and the unfinished services spec of 2026-10-05
  (U2, U3)

## Context

ADR-0032 charged work that takes several visits (a root canal over three sessions) in the visit
that finishes it. Patients pay during the treatment, from the first visit, so the clinic wants
the full price charged when the work starts. Cancelled work keeps that charge; the money goes back
by a refund. Design:
`docs/superpowers/specs/2026-10-29-charge-at-start-refunds-diagnosis-levels-design.md`.

The same change lets a diagnosis be recorded on a jaw or the whole mouth, as a service is.

## Decision

1. **The line stays.** **Not finished** keeps the visit service. The line is charged when its
   visit completes, at its price and line discount, and it carries the plan (`plan_id`), which is
   `in_progress` with this visit's session. Starting planned work (a session on a `planned` plan)
   adds that line at the plan's price. Until the work is done the line does not change the tooth.
2. **Continue** logs a session at no charge, as before.
3. **Complete** marks the plan performed in its visit and adds a line only when no live line
   carries the plan in any visit, a voided one included. That covers work started before this
   change and a starting line removed by a correction. A voided start is not charged again. The
   carrying line's tooth effect applies at Complete.
4. **Undo.**
   - Removing the carrying line in its live visit takes the session with it, and the plan when
     that visit made it.
   - Removing a session in the visit that charges the work is refused (409 `record.not_removable`).
   - A Complete that added no line is undone by `POST /visits/:id/plans/:planId/reopen`.
5. **A correction** that removes a carrying line un-performs the plan only when it was performed
   in that visit. When the work is still in progress, the plan keeps its status and Complete
   charges the work later. When a later visit completed it, the correction is refused (422
   `visit.amend_plan_linked`): reopen the work there first.
6. **The invariant, restated.** A live line with a `plan_id` is that plan's one charge. Its plan is
   `in_progress` (started in the line's visit), `performed` (in the line's visit or a later one) or
   `cancelled`.
7. **Cancel** keeps the charge. The patient record has **Refund a payment**: one of the patient's
   latest payments, in full or in part, through the existing refund.
8. **Diagnosis levels.** `diagnoses.level` (`per_tooth`, `per_jaw`, `per_mouth`) decides the
   target, as `charge_unit` does for services. `patient_diagnoses` keeps a `level` snapshot and a
   `jaw`, and `tooth_code` may be null. A plan links the latest open diagnosis at its own place.

## Consequences

- `billing` is unchanged: it charges a completed visit's lines. The carrying line has a `planId`,
  so held advances (ADR-0051) cover it from the first visit, and the plan work still to charge
  (`planWork`) leaves it out.
- `compensation` follows the ledger: the dentist's share moves to the visit that starts the work.
- The chart counts a line as treatment only when it has no plan or its plan is performed.
  `TreatmentPlan.chargedIn` names the charging visit for the screens.
- Every diagnosis keeps a colour, though only a tooth's is drawn. The default catalog's Bruxism
  is whole mouth.
- Migration 0055 adds the levels; no data is rewritten.
