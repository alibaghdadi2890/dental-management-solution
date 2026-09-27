import type { DomainEvent } from '../../../platform/events/domain-event';

/**
 * Events `patients` emits (CLAUDE.md §9: ids and minimal facts, dispatched after commit). The
 * generic audit subscriber records each one; `billing` consumes `PatientsMerged` (design Q9).
 */

export const PATIENT_CREATED = 'PatientCreated';
export type PatientCreated = DomainEvent<typeof PATIENT_CREATED, { patientId: string }>;

export const PATIENT_UPDATED = 'PatientUpdated';
/** `fields`: the names of the `PatientPatch` fields whose stored value changed. */
export type PatientUpdated = DomainEvent<
  typeof PATIENT_UPDATED,
  { patientId: string; fields: string[] }
>;

export const PATIENT_ARCHIVED = 'PatientArchived';
export type PatientArchived = DomainEvent<typeof PATIENT_ARCHIVED, { patientId: string }>;

export const PATIENT_RESTORED = 'PatientRestored';
export type PatientRestored = DomainEvent<typeof PATIENT_RESTORED, { patientId: string }>;

export const PATIENTS_MERGED = 'PatientsMerged';
/** `droppedId` is now archived with `mergedIntoId = keptId`; references should follow it. */
export type PatientsMerged = DomainEvent<
  typeof PATIENTS_MERGED,
  { keptId: string; droppedId: string }
>;
