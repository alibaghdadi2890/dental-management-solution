# ADR-0031: Diagnoses and plans may be recorded without a visit

- Status: Accepted (amends ADR-0022)
- Date: 2026-10-04

## Context

ADR-0022 put every clinical record inside a live visit: a diagnosis or a plan carried the visit
that recorded it, and charting anywhere else was impossible. Dentists also plan away from the
chair: after reviewing an X-ray, when preparing a quote, or when a patient calls back about a
treatment. Starting a visit for that holds a room, runs a timer and leaves an empty encounter in
the history (`docs/superpowers/specs/2026-10-04-service-levels-patient-planning-multi-visit-design.md`).

Two other shapes were considered and rejected:

- **A "planning visit"** (a visit kind with no room and no charge). It would still appear in the
  visits list, the counts and Last visit, and every rule about visits would need a second branch.
- **Everything without a visit** (resolve, perform, services). Those describe what happened in the
  chair, and a service is what `billing` charges for at completion (ADR-0024).

## Decision

**A diagnosis or a plan may be recorded on the patient record; what happened in the chair still
needs a visit.**

- `patient_diagnoses.recorded_in_visit_id` and `treatment_plans.recorded_in_visit_id` are
  nullable. A record is dated by `recorded_at`; the visit is optional context. A diagnosis recorded
  without one reads its date as `recorded_at` in the tenant's time zone.
- `PatientRecordsService` (`chart:write`) records a diagnosis, plans a treatment, cancels an open
  plan and manages named plans (`plan_groups`: a title over some of a patient's plans, no status
  and no money). It locks the patient `FOR SHARE` like every dependent write (a merge waits), and
  refuses an archived or merged patient.
- **Removing** follows where the record was made: a record made without a visit is removed from
  the patient record; one made in a visit is removed only in that visit. Everything else is
  resolved or cancelled (W13 unchanged). A cancel outside a visit stamps `cancelled_at` only.
- Resolving and reopening a diagnosis, performing a plan, services and tooth presence stay in
  `VisitRecordsService`.
- The record's dentist is named by the caller, or is the caller when they are a dentist; otherwise
  the write is refused (422 `record.dentist_required`).
- `chart:write` is a new permission (owner, dentist). In-visit charting stays on `visit:write`, so
  an assistant charts under the dentist in a visit but does not plan alone.
- `DiagnosisRecorded`, `TreatmentPlanned` and `TreatmentCancelled` carry `visitId: null` for these
  writes.

## Consequences

- The chart, the plan board and the tooth history read the same tables as before; only the date's
  source and the nullable visit changed. The SPA's Chart tab reuses the workspace's components
  through a patient-bound `ChartingActions`.
- A record's `recorded_in_visit_id` no longer proves a visit exists for it: code that joins on it
  uses a left join (`PatientDiagnosesRepository`).
- The discard rule is unaffected: a visit is empty or not by the rows that point at it.
- A named plan is display grouping only. The printable quote stays per patient.
- A tenant that wants assistants to plan grants `chart:write` to its assistant role.
