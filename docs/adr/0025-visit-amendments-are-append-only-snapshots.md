# ADR-0025: Visit amendments are append-only snapshots

- Status: Accepted
- Date: 2026-10-01

## Context

Feature 4b (`docs/superpowers/specs/2026-10-01-visits-list-amend-void-design.md`) lets a dentist
or owner correct a completed visit: re-tooth a service, remove one, change the visit discount, or
void the whole visit, each with a reason. A completed visit has been charged (ADR-0024), its money
is frozen, and the audit log, the ledger and the clinic's reports all depend on that. The design
had to decide how a correction is stored without rewriting what happened, and how the ledger
follows.

## Decision

**The visit holds the current state; `visit_amendments` holds its history.**

- An amendment updates the visit in place: services are soft-deleted or re-toothed, the discount
  and the frozen money change, and the status becomes `amended`.
- In the same transaction it appends one `visit_amendments` row with the visit before and after
  (`AmendmentSnapshot`: services, discount, subtotal, discount amount, total), the reason, the
  actor and the delta (after − before total).
- The table is append-only: the runtime role has no UPDATE or DELETE (migration 0020), like the
  ledger and the audit log. Rows are numbered per visit (`sequence`).
- A void changes no services or money. It sets `status = voided` with its own reason, actor and
  time on the visit row. A voided visit is final.

**The ledger follows with entries of its own, never edits.** `VisitAmended` carries the delta;
`billing` posts it as a `visit_charge_adjustment` naming the amendment (`amendment_id`), dated
the day of the correction, with no lines. `VisitVoided` makes `billing` post a
`visit_charge_reversal` of whatever the visit's entries add up to. Both run in the amend or void
transaction (the ADR-0024 mechanism), so the visit and its ledger never disagree. A zero delta
posts nothing.

**Records stay as recorded.** Removing a service that performed a plan puts the plan back to
`planned` (audited `treatment_plan.unperform` with the reason). Otherwise diagnoses, plans and
tooth presence recorded in an amended or voided visit stay; reads mark those from voided visits
(`voidedVisitIds`) rather than hide them.

## Consequences

- The visit row and its services always answer "what is the visit now"; the list, the record and
  the ledger read them directly. "What was it before" is the amendment rows and the audit trail
  (`visit.amend` carries the same before/after).
- Per-line prices and adding services are not amendable (D1). Supporting them later means a
  richer snapshot, not a different model.
- A charge's lines (`ledger_entry_lines`) describe the visit as completed; after an amendment
  they no longer match the visit's services. The visit and its amendments are the source for
  what was finally charged.
- The chart keeps treated marks from a voided visit's services (D6); a later feature could
  recompute it.
