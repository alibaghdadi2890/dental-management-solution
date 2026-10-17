# A check for open diagnoses at Complete visit

Date: 2026-10-17. Module: `clinical` (SPA only; no API change).

## Why

A dentist treats a tooth that has a diagnosis (a filling on #16 with caries) and completes the
visit without marking the diagnosis resolved. The chart then keeps showing the tooth as diseased.
Before the visit is recorded, the dentist is warned and can resolve those diagnoses on the spot.

## Decisions

- **D1: what is listed.** A diagnosis is listed when it is **active** and either:
  - it is on a tooth that one of this visit's services touches (a completed service:
    `visit.services` with that `toothCode`); or
  - a plan linked to it (`diagnosisRecordId`) was performed in this visit (a service with that
    `planId`).

  Diagnoses recorded in this visit are included: a caries found and filled today is the same
  slip. Work only started today (a session, "Not finished") adds no service and lists nothing.
  Jaw-level and whole-mouth services list nothing, because diagnoses are per tooth. The rule is
  one pure function, `diagnosesToResolve(visit, chart)`, in `features/clinical/dialogs/`.
- **D2: where it happens.** First on the way to the **Complete step**. Entering it from any step
  (Perform's **Continue to Complete**, or the stepper) opens the check in its own dialog
  (`ResolveBeforeCompleteDialog`). **Back to {step}** stays where the dentist was. The primary
  button resolves the ticked ones, then moves on: **Continue to Complete**, or **Resolve n and
  continue to Complete**. Moving on is always possible, so the stepper stays navigation, not a
  gate (ADR-0044). The diagnoses it listed are not asked about again in this session.
  Then, as a safety net (the All view has no steps, and work may be added after the step check),
  the Visit Summary's **Complete visit** sends unsaved edits, waits for writes in flight, and
  checks D1 again for diagnoses not already shown. With any, the summary's body turns into the
  same check. It stays one modal, never a dialog on top of a dialog.
- **D3: the check.** Title "Resolve these diagnoses?", with a warning that counts the diagnoses:
  "2 diagnoses are still open on the teeth you treated today. You may have forgotten to resolve
  them." Focus goes to the title when the check opens, and back to **Complete visit** after
  **Back to summary**. Each row has
  the tooth label, the diagnosis name, the service done on that tooth today, and a **Resolve**
  checkbox. Every box starts unticked: nothing is resolved without the dentist choosing it.
  Buttons:
  - **Back to summary** returns to the summary, with nothing changed.
  - The primary button reads **Complete visit** while nothing is ticked, and **Resolve n and
    complete** once some are. It resolves the ticked ones one by one
    (`POST /visits/:id/diagnoses/:recordId/resolve`, the tooth panel's own mutation), then
    completes.
- **D4: failure.** If a resolve fails, nothing is completed and the check stays open with the
  error. The diagnoses already resolved stay resolved (each one is its own audited change), and
  the list drops them. If completion fails, the summary's error shows, as today.
- **D5: once per Complete.** After the check, completing never asks again. A new Complete visit
  click re-checks the chart as it is then.
- **D6: who sees it.** Anyone who can complete a visit (`visit:write`) can also resolve, so there
  is no new gate. Strings go in en/fr/ar under `clinical:summary.resolve.*`.

## Tests

- `diagnoses-to-resolve.spec.ts`:
  - the same tooth lists it;
  - a plan linked to the diagnosis and performed today lists it;
  - a resolved diagnosis, another tooth, a session only, or a jaw service lists nothing;
  - each diagnosis is listed once, in FDI order.
- `visit-summary-dialog.spec.tsx`:
  - nothing to list: it completes directly;
  - something to list: the check shows; Back returns to the summary;
  - ticking one resolves it, then completes (the resolve request comes before complete);
  - with nothing ticked it completes and resolves nothing;
  - a failed resolve keeps the check open and does not complete.
