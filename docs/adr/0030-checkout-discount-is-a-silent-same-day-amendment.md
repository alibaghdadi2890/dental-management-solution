# ADR-0030: A checkout discount is a silent, same-day amendment under its own permission

- Status: Accepted
- Date: 2026-10-04

## Context

Until now one person had to finish a visit's money: the discount could be set only while the visit
was live (`visit:write`) or by amending it afterwards (`visit:amend`, a reason, status `amended`).
The front desk holds neither, so a clinic where the dentist treats and the front desk collects had
no way for the desk to give a discount
(`docs/superpowers/specs/2026-10-04-checkout-handoff-design.md`).

Two other shapes were considered and rejected:

- **A checkout state before completion** (the charge posts when the front desk finalizes). A visit
  nobody checks out is never charged, and "completed" stops meaning what the chart, the counts and
  amend/void rely on (ADR-0024).
- **A ledger write-off by the front desk** (`adjustBalance`). The discount would not be on the
  visit or its invoice, and billed totals would be wrong.

## Decision

**Completion is unchanged; the discount may be set again at checkout.**

- A new permission, `visit:discount` (owner, dentist, front desk), allows
  `VisitsService.setCheckoutDiscount`: the visit discount of a completed or amended visit, and
  nothing else.
- It reuses the amendment mechanics (ADR-0025): the same locks and staleness check, the money
  recomputed and frozen, one append-only `visit_amendments` row, and `VisitAmended` in the
  transaction so `billing` posts the difference as a `visit_charge_adjustment`.
- It is **silent**: the visit keeps its status, the reason is optional, and the row is
  `kind = 'checkout_discount'`, which the amendment count ignores. The audit entry
  (`visit.discount`, before/after) still records who changed it.
- It is allowed **only on the visit's tenant-local day** (409 `visit.checkout_closed` later). After
  that day a discount change is an amendment, with a reason, by someone who may amend.
- The handoff itself is not stored: the queue is the branch's visits of today that still owe,
  read from `billing`'s existing unpaid view.

## Consequences

- A discount is routine at the desk, so it leaves no "Amended" mark; a real correction still does.
  The day limit keeps the silent path from rewriting older visits.
- `visit_amendments.reason` is nullable for checkout rows only (a check keeps it required for
  amendments), and `VisitAmended.reason` and the adjustment's ledger reason may be null.
- A discount on a visit that is already paid is not refused: the difference becomes credit through
  the existing settle (ADR-0029). The SPA offers the edit only while the visit owes.
- Who may discount is a grant, not a role check: a tenant that wants only dentists to discount
  removes `visit:discount` from its front desk role.
- A visit left unpaid drops out of the checkout queue when the day ends; it stays in Visits →
  Unpaid and in Payments → Outstanding.
