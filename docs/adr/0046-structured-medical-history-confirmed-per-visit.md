# ADR-0046: Medical history is structured, owned by `patients`, and confirmed per visit

- Status: Accepted
- Date: 2026-10-10

## Context

A patient had one free-text field, `medical_alerts`. The header showed it as chips by splitting
the text. Nothing could tell "no allergies" from "nobody asked", two spellings of penicillin were
two alerts, and the dentist had no way to say they had gone through it with the patient.

Feature 10 makes the history something the front desk enters at registration and the dentist
checks at the chair.

## Decision

1. **`patients` owns the medical history.** It is demographic-adjacent data about the person,
   edited through the patient form, and `clinical` already depends on `patients`.
2. **Allergies and conditions are picked from two tenant lists.** `medical_history_options`
   holds both (`kind` is `allergy` or `condition`, with `name` and `active`; unique by lower-case
   name per tenant and kind among live rows). A patient's items are rows of
   `patient_medical_items` (patient, option). Medication is one text line on the patient.
3. **"None known" and "None" are answers, not list rows**: `patients.no_known_allergies` and
   `no_conditions`. Not asked is no items and the flag false. The service refuses a flag together
   with items of its kind.
4. **The lists are edited in the Catalog**, on a tab of their own, saved in one batch with
   `catalog:write` and read with `patient:read`. They are seeded when a tenant is provisioned and
   on demand while both are empty. An option a patient has cannot be deleted, only deactivated
   (409 `medical_option.in_use`); an inactive option stays on the patients who have it and leaves
   the pickers. Renaming an option renames it everywhere.
   **A name typed into a patient's history is added to its list on the way**
   (`POST /medical-history/options`, `patient:write`): the fields are a box of pills that
   suggests the clinic's names as one types, and recording an allergy must not wait for whoever
   may edit the Catalog. The name is matched without case, so it is added once; typing the name
   of an inactive option offers it again. The first design showed every option as a chip to
   click, which offered nothing to type into and nothing at all to a clinic with empty lists.
5. **The history is part of the patient's create and update inputs** (`patient:write`). An edit
   replaces the whole history and is audited in `patient.update` with the names before and after.
6. **A dentist confirms the history in a visit.** The confirmation is stored on the visit:
   `visits.history_confirmed_at` and `history_confirmed_by`. `confirmHistory` and its undo need
   `chart:write` and a live visit, are audited (`visit.history_confirm`,
   `visit.history_unconfirm`) and emit `MedicalHistoryConfirmed`. `clinical` owns it, because it
   is a fact about the visit.
7. **A later edit does not unconfirm.** The confirmation says the dentist went through the
   history with the patient at that visit. It is not a signature over the current values. Each
   edit is in the audit log beside it.
8. **"Registered by front desk · not confirmed"** shows while the patient has a history that no
   visit ever confirmed. The record reads the latest confirmation over the patient's visits
   (`ChartService.historyConfirmation`).
9. **A merge keeps the union** of both records' items. A "none" flag survives only if the merged
   list of its kind is empty. Medication is a merge field like the notes. Losing an allergy in a
   merge is the worse mistake.
10. **`medical_alerts` is dropped** in migration `0042`, with no backfill.

## Consequences

- The feature prompt asked for old alert text to move into Medication. It is not moved: the
  application has no deployed data, and the text would need a person to sort it into the lists
  anyway.
- An option in use answers `medical_option.in_use`, not `catalog.in_use`: `patients` cannot
  import `clinical`'s error.
- Confirmation is per visit, so a patient seen by two dentists is confirmed twice. That is the
  intent.
- The patients list carries the item names for the alert chips, so the list needs no second
  read.
