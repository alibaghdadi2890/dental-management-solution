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

/** Published by `complete` (E2); `billing` posts the visit charge from it (W2). */
export const VISIT_COMPLETED = 'VisitCompleted';
export type VisitCompleted = DomainEvent<
  typeof VISIT_COMPLETED,
  { visitId: string; patientId: string; currency: string; total: string; localDate: string }
>;
