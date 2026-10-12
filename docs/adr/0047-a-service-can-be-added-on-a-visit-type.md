# ADR-0047: A catalog service can be added automatically to visits of one type

- Status: Accepted
- Date: 2026-10-10

## Context

An examination is itself a billable service, and so is an emergency examination and a scaling.
Before feature 10 the dentist added it by hand in every such visit, and a visit completed without
it was billed nothing. The visit now has a type (ADR-0044), so the clinic can say once which
service a type starts with.

## Decision

1. **A service may name one visit type it is added on**: `procedures.added_on_visit_type`,
   nullable, one of `examination`, `emergency`, `hygiene`, `consultation`. Never `treatment`: a
   treatment visit takes its work from the plan (ADR-0048).
2. **Only a service charged for the whole mouth can be added automatically** (a CHECK, and the
   same rule in the contract). A per-tooth or per-jaw service needs a place, and nobody has chosen
   one when the visit starts.
3. **The service is added when the visit starts**, in the start transaction, at its catalog
   price. Several services may name the same type; all are added, in code order. An inactive
   service is skipped. A resumed visit adds nothing.
4. **The service is marked** `visit_services.auto_added = true` and audited as
   `visit_service.create`. The workspace labels it "added automatically". It is removed, repriced
   and discounted like any other service.
5. **An untouched automatic service is not visit content.** The discard rule ignores an
   automatic service nobody has edited, so a visit opened by mistake can still be discarded. Once
   its price or discount is changed it counts.
6. **The default catalog** sets Examination on `examination`, Emergency examination on
   `emergency` and Scaling & polishing on `hygiene`.
7. **The Catalog shows it as a column**, _Added on_, on a whole-mouth service. Changing a
   service's charge unit away from the whole mouth clears it.

## Consequences

- Changing _Added on_ affects visits started afterwards. A live visit keeps what it has.
- An automatic service is not "work" for the step model: an examination whose only service is
  the automatic one does not tick its Perform step (ADR-0044).
- The same change adds `procedures.typical_sessions` (2 to 20, nullable), copied to
  `treatment_plans.estimated_sessions` when the service is planned. It is the "m" of "session n
  of m". Without it the label is "session n". The default catalog sets 3 on root canal treatment.
