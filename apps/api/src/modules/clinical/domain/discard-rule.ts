/**
 * What a visit has put on the record, counted by the service from the rows that point at it:
 * non-deleted services; non-deleted diagnoses and plans recorded in it; diagnoses resolved and
 * plans performed or cancelled in it; sessions of plans in progress (ADR-0032) that aren't
 * removed; tooth presence set in it, by hand or by a service (feature 7); and its notes.
 */
export interface DiscardFacts {
  services: number;
  diagnosesRecorded: number;
  diagnosesResolved: number;
  plansRecorded: number;
  plansPerformed: number;
  plansCancelled: number;
  planSessions: number;
  toothChanges: number;
  notes: string;
}

/**
 * A visit can be discarded only while it is empty (spec §Discard, W4), so a discard never erases
 * clinical history. The visit-level discount isn't a fact: on its own it doesn't block a discard.
 * Whitespace-only notes count as empty.
 */
export function isDiscardable(facts: DiscardFacts): boolean {
  return (
    facts.services === 0 &&
    facts.diagnosesRecorded === 0 &&
    facts.diagnosesResolved === 0 &&
    facts.plansRecorded === 0 &&
    facts.plansPerformed === 0 &&
    facts.plansCancelled === 0 &&
    facts.planSessions === 0 &&
    facts.toothChanges === 0 &&
    facts.notes.trim() === ''
  );
}
