import type { DomainEvent } from '../../../platform/events/domain-event';

/**
 * Visit lifecycle events (spec §Events, CLAUDE.md §9: ids and minimal facts). They are dispatched
 * after commit, and the generic audit subscriber records each one. Notes and discount changes are
 * audited directly and emit no event.
 */

export const VISIT_STARTED = 'VisitStarted';
export type VisitStarted = DomainEvent<
  typeof VISIT_STARTED,
  { visitId: string; patientId: string; dentistId: string; roomId: string | null }
>;

export const VISIT_PAUSED = 'VisitPaused';
export type VisitPaused = DomainEvent<typeof VISIT_PAUSED, { visitId: string; patientId: string }>;

export const VISIT_RESUMED = 'VisitResumed';
export type VisitResumed = DomainEvent<
  typeof VISIT_RESUMED,
  { visitId: string; patientId: string }
>;

/** The visit was empty (spec W4); its room is free again. */
export const VISIT_DISCARDED = 'VisitDiscarded';
export type VisitDiscarded = DomainEvent<
  typeof VISIT_DISCARDED,
  { visitId: string; patientId: string; roomId: string | null }
>;

/**
 * Published by `complete` inside its transaction: `billing`'s in-transaction handler posts the
 * visit charge before commit (W2, ADR-0024); everyone else hears it after commit.
 */
export const VISIT_COMPLETED = 'VisitCompleted';
export type VisitCompleted = DomainEvent<
  typeof VISIT_COMPLETED,
  { visitId: string; patientId: string; currency: string; total: string; localDate: string }
>;

/**
 * A completed visit was amended (4b, D1–D4, ADR-0025), published inside the amend transaction:
 * `billing` posts `delta` (after − before total, negative for a credit) as a visit charge
 * adjustment before commit. `reason` is the dentist's, carried onto the ledger entry; a discount
 * set at checkout is published the same way and may have none.
 */
export const VISIT_AMENDED = 'VisitAmended';
export type VisitAmended = DomainEvent<
  typeof VISIT_AMENDED,
  {
    visitId: string;
    patientId: string;
    amendmentId: string;
    currency: string;
    delta: string;
    reason: string | null;
  }
>;

/**
 * A completed or amended visit was voided (4b, D4), published inside the void transaction:
 * `billing` reverses what the visit charged — or vetoes the void when payments sit on it
 * (ADR-0026), which rolls the whole void back.
 */
export const VISIT_VOIDED = 'VisitVoided';
export type VisitVoided = DomainEvent<
  typeof VISIT_VOIDED,
  { visitId: string; patientId: string; currency: string; reason: string }
>;
