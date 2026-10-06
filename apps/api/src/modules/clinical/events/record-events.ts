import type { ToothPresenceValue } from '@dcm/contracts';
import type { DomainEvent } from '../../../platform/events/domain-event';

/**
 * Charting events (spec §Events, CLAUDE.md §9: ids and minimal facts). They are dispatched after
 * commit, and the generic audit subscriber records each one. `visitId` is the live visit the
 * change was made in, or null for a diagnosis or plan recorded, or a plan cancelled, on the
 * patient record (ADR-0031). Service adds, edits and removes, record removals and the undo of a perform
 * are audited directly and emit no event.
 */

export const DIAGNOSIS_RECORDED = 'DiagnosisRecorded';
export type DiagnosisRecorded = DomainEvent<
  typeof DIAGNOSIS_RECORDED,
  {
    recordId: string;
    visitId: string | null;
    patientId: string;
    toothCode: string;
    diagnosisId: string;
  }
>;

export const DIAGNOSIS_RESOLVED = 'DiagnosisResolved';
export type DiagnosisResolved = DomainEvent<
  typeof DIAGNOSIS_RESOLVED,
  { recordId: string; visitId: string; patientId: string; toothCode: string }
>;

export const DIAGNOSIS_REOPENED = 'DiagnosisReopened';
export type DiagnosisReopened = DomainEvent<
  typeof DIAGNOSIS_REOPENED,
  { recordId: string; visitId: string; patientId: string; toothCode: string }
>;

export const TREATMENT_PLANNED = 'TreatmentPlanned';
export type TreatmentPlanned = DomainEvent<
  typeof TREATMENT_PLANNED,
  {
    planId: string;
    visitId: string | null;
    patientId: string;
    toothCode: string | null;
    procedureId: string;
  }
>;

/** Work on the plan began in this visit: its first session (ADR-0032). */
export const TREATMENT_STARTED = 'TreatmentStarted';
export type TreatmentStarted = DomainEvent<
  typeof TREATMENT_STARTED,
  { planId: string; visitId: string; patientId: string; toothCode: string | null }
>;

/** The plan became the visit service `serviceId`. */
export const TREATMENT_PERFORMED = 'TreatmentPerformed';
export type TreatmentPerformed = DomainEvent<
  typeof TREATMENT_PERFORMED,
  {
    planId: string;
    visitId: string;
    patientId: string;
    serviceId: string;
    toothCode: string | null;
  }
>;

export const TREATMENT_CANCELLED = 'TreatmentCancelled';
export type TreatmentCancelled = DomainEvent<
  typeof TREATMENT_CANCELLED,
  { planId: string; visitId: string | null; patientId: string; toothCode: string | null }
>;

/** Which tooth is present at a succession position changed (W5, W15). */
export const TOOTH_STATUS_CHANGED = 'ToothStatusChanged';
export type ToothStatusChanged = DomainEvent<
  typeof TOOTH_STATUS_CHANGED,
  { visitId: string; patientId: string; position: string; present: ToothPresenceValue }
>;
