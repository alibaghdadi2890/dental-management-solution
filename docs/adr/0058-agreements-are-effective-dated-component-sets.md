# ADR-0058: A dentist's compensation agreement is an effective-dated set of components

- Status: Accepted
- Date: 2026-10-25

## Context

Clinics pay dentists in many ways: a share of what is collected or billed, a fixed amount per
visit or per day, a salary, a salary plus commission, chair rent, or a mix. Terms change over
time, and a statement must always say which terms applied to a given visit (feature 13b).

## Decision

1. An agreement belongs to one dentist (staff profile, ADR-0020). It is in force from
   `effective_from` to an optional `effective_to`, both included. It holds a set of
   **components**:
   - `monthlyFixed` (signed; negative is rent);
   - `share` (percent, basis billed or collected, rates by service or category, optional
     threshold);
   - `perVisit` (amount, amounts by visit type, charged only);
   - `perDay`.

   At least one component, at most one of each kind, validated with Zod and stored as `jsonb`.
   A **preset** only pre-fills the form and labels the agreement.

2. A dentist's live agreements never overlap. This is enforced by an exclusion constraint on
   `(tenant_id, staff_profile_id, daterange(effective_from, effective_to, '[]'))` that ignores
   superseded rows. It needs `btree_gist`, created by migration 0053.
3. **Append-only.** An agreement is never edited. **Change terms** from a date ends the current
   agreement the day before and creates the next one, in one transaction. On the current
   agreement's own first day it **supersedes** it instead: the row stays in the history, struck
   through, with the reason, and the new agreement takes its dates. The new agreement keeps the
   old one's end, if it had one. The runtime role may update only the end and supersede columns.
4. Ending only ever shortens an agreement, never before its start. The day after the end must be
   in an open month, because ending changes the days after it. Superseding is allowed only while
   none of the old agreement's months is closed (ADR-0059).
5. Deactivating a dentist (`users.deactivate`) publishes `StaffDeactivated`. `compensation`
   handles it in the same transaction: it ends the agreement in force on that day and supersedes
   the ones that start later. This reaction checks no permission and never refuses. Reactivation
   restores nothing.

## Consequences

- Every line of a statement uses the agreement in force on its visit's date, whatever the date
  of the money. A change of basis never pays the same visit twice.
- History is complete: the agreements a closed month used are never changed.
