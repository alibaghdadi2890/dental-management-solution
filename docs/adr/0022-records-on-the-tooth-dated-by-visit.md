# ADR-0022: Clinical records live on the tooth, dated by visit

- Status: Accepted
- Date: 2026-09-30

## Context

Feature 4a (`docs/superpowers/specs/2026-09-29-visit-workspace-design.md`) charts diagnoses,
treatment plans and services inside a live visit. The POC's workflow is _Diagnosis → Treatment
plan → Completed treatment_ on one tooth, and it spans visits: a caries found in visit 1 is
planned for a filling in visit 1 and filled in visit 2; a plan from last month is cancelled
today. If records belonged to the visit, visit 2 could not perform visit 1's plan without
copying it, and the chart would have to gather every visit to know a tooth's state.

Other questions from the same design:

- whether a child's tooth at a position is the primary one or its successor, and who changes it
  (V2 proposed a switch for the whole chart header);
- what to call the tables, since `diagnoses` is already the diagnosis catalog;
- who "recorded" a record when an assistant or a platform admin charts for the dentist;
- which records need a tooth;
- what "remove" means for a record that another visit may have seen.

## Decision

**Records belong to the patient's tooth and are dated by visits (V5).**

- A diagnosis (`patient_diagnoses`) and a plan (`treatment_plans`) carry `patient_id`,
  `tooth_code` and the visit that recorded them (`recorded_in_visit_id`, `recorded_at`). Later
  visits act on them and stamp themselves: `resolved_in_visit_id`, `performed_in_visit_id`,
  `cancelled_in_visit_id`, each with its time.
- A service (`visit_services`) is what was done in one visit, so it belongs to that visit. A
  service created by performing a plan points back at it (`plan_id`); a plan is performed by at
  most one service that isn't removed (`visit_services_plan_unique`).
- The chart is derived from the patient's records (`@dcm/contracts`' `deriveChart`, shared with
  the SPA): the diagnoses and plans, the services of completed visits (history) and the live
  visit's services (treated today). A patient's records are bounded, so nothing is paginated.
- Catalog items are copied as snapshots (code, name, category, charge unit, price), so later
  catalog edits never change a record. A catalog row a record refers to can only be
  deactivated (409 `catalog.in_use` on delete, V11).

**Table names (W9).** Diagnosis records are `patient_diagnoses`; `treatment_plans` holds one row
per planned procedure and replaces the `planned_procedures` placeholder.

**Actor columns are the auth user id (W10).** `recorded_by` and `changed_by` hold
`RequestContext.requireUserId()`: whoever made the change, an assistant or a platform admin
(who has no staff profile) included. The record's `dentist_id` is not an actor: it is the
clinically responsible dentist, the visit's, as a staff profile id (ADR-0020), and it is the
name the UI shows.

**Where a record sits (W11).** A diagnosis always needs a tooth. A plan or a service follows the
catalog's charge unit: `per_tooth` needs a tooth (422 `visit.tooth_required`), `per_jaw` has
none (422 `visit.tooth_not_allowed`); a jaw-level item has no upper/lower field. All three take
the pending surface selection, which must be surfaces the tooth has.

**Primary or permanent per position (W5, W15).** The POC's succession row replaces V2's header
switch: `tooth_status` has at most one row per patient and succession position (a permanent code
at position 1–5), with `present` = `primary | permanent`. No row means the dentition stage
decides. A change needs a live visit and records `changed_in_visit_id`; it is an upsert, not
history.

**Removing and undoing (W13).**

- Removing a service, diagnosis or plan recorded in the live visit is a soft delete
  (`deleted_at`), audited. A removed record appears in no read and blocks nothing.
- Older records are never removed (409 `record.not_removable`): an older diagnosis is resolved,
  an older plan cancelled.
- Removing a diagnosis unlinks the plans made for it. A plan is removed only while `planned`.
- The Undo toasts call the server: removing a service a plan created puts the plan back to
  `planned` and clears `performed_*` (the undo of perform).

**Refinements made while building (D1).**

- **`plan.not_cancellable`**: cancel is for plans from earlier visits only; a plan made in this
  visit is removed instead (409). Together with `record.not_removable` this keeps each action to
  one meaning: remove = "never happened", cancel = "decided against".
- **Idempotent actions**: resolving a resolved diagnosis, reopening an active one, or setting a
  tooth to the value it already has returns the record unchanged, with no write, no audit and no
  event. So does a price edit that changes nothing. Retried requests and double clicks are safe.
- **Currency at perform**: a plan keeps the currency of its price snapshot. Performing it checks
  that currency against the visit's (422 `visit.currency_mismatch`, W12), because the tenant
  currency may have changed between the two visits.
- **No events for removals yet**: removing a service, diagnosis or plan, and undoing a perform,
  are audited but publish no event; nothing consumes them today. An event (for example
  `DiagnosisRemoved`, `TreatmentUnperformed`) must be added before any consumer relies on
  retractions, or that consumer will keep records that no longer exist.

## Consequences

- A plan made in one visit is performed or cancelled in another without copying, and each record
  says which visit did what. The tooth history lists a tooth's diagnoses, plans and completed
  services across visits.
- The chart, tooth history, last visit and summary are read from a few indexed queries per
  patient (`(tenant_id, patient_id, tooth_code)` on the record tables).
- A merge must re-point the record tables together with the visits (V10; the in-transaction
  handler of feature 4a step 5).
- "Who did it" and "whose record" are separate columns, so the UI can show the dentist while the
  audit shows the assistant or admin who typed it.
- Removal leaves rows behind (soft delete). Every read and rule must filter `deleted_at`.
