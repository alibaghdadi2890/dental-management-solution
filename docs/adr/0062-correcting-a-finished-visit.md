# ADR-0062: Correcting a finished visit

- Status: Accepted
- Date: 2026-10-28
- Amends: ADR-0025 (what an amendment may change, ledger lines), ADR-0059 (rates by service)

## Context

A dentist finishes a visit with a mistake in it: the timer was started late or left running, a
service went on the wrong tooth, or the wrong service was picked. Amend (ADR-0025) could move a
service to another tooth, remove it, or change the visit discount. It could not add a service,
change a price or change the visit's times. So "replace the $50 service with the $70 one" was
impossible, and the timer's mistakes stayed in the visits list, the patient's history and the
stored duration.

The clinic wants the correction to be the source of truth. The patient's balance follows it, and
a replaced service is charged at the new service's catalog price, unless a price is typed.

## Decision

1. **One action: Amend, called "Correct visit".** `POST /visits/:id/amend` keeps its permission,
   `visit:amend` (owner, admin and dentist), and its rules (locks, `expectedUpdatedAt`, a required
   reason, the visit scope). Users now see it as **Correct visit**, and the status `amended`
   as **Corrected**. Code names and stored grants stay, so no migration is needed.
2. **What a correction may change.**
   - **Existing services:** tooth and surfaces as before. A `price` sets the base to the price and
     the line discount to 0. A service can be removed.
   - **New services:** `{ procedureId, toothCode?, jaw?, surfaces?, price? }`.
     - It must be an active catalog service in the visit's currency.
     - It costs the catalog price unless a `price` is given.
     - It is placed under the recording rules: a tooth for a per-tooth service, a jaw for a
       per-jaw one.
     - It has no plan link, and its tooth effect applies. A replacement is a removal plus an
       addition.
   - **The visit discount,** as before.
   - **`times: { startedAt, completedAt }`:**
     - The start stays on the visit's `local_date` (422 `visit.times_off_day`). Money,
       compensation days and records therefore keep their day.
     - The end is after the start, at most 24 hours later, and not in the future (422
       `visit.times_invalid`).
     - Pauses are dropped, and the duration becomes end − start.
     - Times equal to the stored ones count as unchanged.
3. **Permissions.** A typed price or a changed discount also needs `visit:discount`, as anywhere
   else a price is set (ADR-0055).
4. **Status and history.**
   - **Services, prices or discount changed:** the visit becomes `amended`, and a
     `visit_amendments` row records it, with the times in its snapshots when they changed too. It
     is audited `visit.amend`, and `VisitAmended` is published in the transaction.
   - **Times alone:** the status stays, no amendment row is written and no event is published. It
     is audited `visit.times`, with the reason and both sets of times.
   - **Nothing changed:** 422 `visit.amend_no_change`.
5. **Imported visits** (ADR-0053) were never charged here, so only their times may be corrected.
   Any other change returns 409 `visit.imported`. The visits list item carries `imported`.
6. **The ledger follows.**
   - The difference is still a `visit_charge_adjustment` dated the day of the correction
     (ADR-0025), and a zero difference posts nothing.
   - The adjustment now carries **lines: the visit's services as they stand after the correction**,
     in the same shape as a charge's lines.
   - The plan share (ADR-0051) is stored again even when the difference is zero.
7. **Compensation rates the corrected services** (amends ADR-0059's "an amendment adds no lines").
   - A visit's state after each of its entries is the net charged so far and its latest lines.
   - An entry is rated at the state before it; a charge is rated at its own state.
   - Exception: a correction whose lines, and therefore rate, differ from the state before it
     earns the difference it makes. That is E(after) − E(before), where E is the net so far at
     that state's rate. Its line shows the effective rate (earned / base).
   - A reversal is rated at the latest state, so a correction followed by a void nets to zero.
   - Collections are rated at the visit's latest state.
   - For a visit never corrected, every figure is the same as before.
8. **In the SPA,** the visit detail panel's **Correct visit** opens one form:
   - the start and end on the visit's day;
   - the services, each with tooth, surfaces, price (editable with `visit:discount`) and remove;
   - **Add service** from the catalog;
   - the visit discount.

   Save asks for the reason and shows the total before → after, or says that only the times
   change. An imported visit's form has the times only.

## Consequences

- The correction is the source of truth for the balance: the original charge stays on its date
  and the difference is posted on the day of the correction, so closed months and statements
  already given to dentists never change.
- A correction that leaves the total unchanged posts nothing. A swap between two services at the
  same price but with different rates therefore doesn't change the dentist's pay. We accept this.
- `completed_at` can move. Compensation finds late entries of a closed month by
  `completed_at >= close`, and also by the ledger rows created since. A zero-charge visit that
  stayed open across a month's close, then had its end moved back before the close, is no longer
  picked up as late. We accept this.
- A visit still cannot move to another day: that would move its money and compensation dates.
- Adding a service that performs a treatment plan, or a session of multi-visit work, is not part
  of a correction.
