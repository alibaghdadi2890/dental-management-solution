# ADR-0032: Work over several visits is a plan in progress, charged when it is done

- Status: Accepted
- Date: 2026-10-04

## Context

A service was a line of one visit, and a plan went from `planned` to `performed` in one step. A
root canal or a crown takes two or three visits: until now the dentist either recorded the whole
service on the first visit (charged and shown as treated before it was) or on the last (the earlier
visits showed nothing). The clinic decided the charge belongs to the visit that finishes the work
(`docs/superpowers/specs/2026-10-04-service-levels-patient-planning-multi-visit-design.md`).

Two other shapes were considered and rejected:

- **A status on the visit service** (`in_progress` lines chained across visits). A completed
  visit's money is frozen (ADR-0024) and its services are amended as a set (ADR-0025); an
  unfinished line inside it would need exceptions in both.
- **A separate "course of treatment" entity** beside plans. It duplicates the plan: same catalog
  snapshot, same target, same price, same link to a diagnosis.

## Decision

**The plan carries the work; visits log sessions; one visit service charges it at the end.**

- `plan_status` gains `in_progress`: `planned → in_progress → performed`, with `cancelled` from
  either open state (`domain/plan-lifecycle.ts`). Any service can be multi-visit; the catalog has
  no flag.
- **Start** (in a visit) moves a planned plan to `in_progress` and stamps `started_in_visit_id` /
  `started_at`. `planTreatment` with `start` plans and starts in one call.
- A **session** (`treatment_plan_sessions`) is one visit's work on a plan in progress: at most one
  per plan and visit, an optional note, no money. Start logs the first; **Continue today** logs a
  later visit's. A session is visit content, so that visit cannot be discarded; a visit with only
  sessions completes with a total of 0 and posts no charge.
- **Mark done** is perform on a plan in progress: it creates the visit service at the plan's price
  snapshot in that visit and marks the plan performed. That service is the only charge.
- **Undo**: removing a visit's session leaves the plan in progress while any session remains, else
  returns it to `planned`. Removing the service that marked it done — live, or by an amendment —
  does the same (`statusWithSessions`).
- **Cancel** abandons work in progress at no charge, in a visit or from the patient record. Work
  partly done is billed, if at all, by adding an ordinary service.
- A voided visit's sessions stay and read as voided (`voidedVisitIds`, D6); the plan is not rewound.
- The chart shows a tooth with work in progress as `in_progress`, above earlier treatment and below
  what was treated today. The treatment summary counts planned and in-progress plans together.

## Consequences

- `billing` is unchanged: it still charges a completed visit's services (ADR-0024). Nothing is owed
  for work in progress, so a patient who stops attending owes nothing for it.
- The plan estimate and the quote include work in progress: it is still to be billed.
- `visit_services_plan_unique` still guarantees one charge per plan.
- The migration adds the enum value and uses it nowhere, so it runs in the same transaction as the
  rest; checks compare the status as text (the 0019 pattern).
- A session's note is stored and returned, but the SPA does not ask for one yet; the visit's
  clinical notes hold the detail.
