import type { PlanPriority, ToothPresenceState } from '@dcm/contracts';
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

/**
 * A diagnosis names the image it was seen on (feature 10, ADR-0049). Published inside the
 * writing transaction: `files` checks that the file is this patient's and refuses it otherwise,
 * which rolls the write back.
 */
export const DIAGNOSIS_EVIDENCE_CITED = 'DiagnosisEvidenceCited';
export type DiagnosisEvidenceCited = DomainEvent<
  typeof DIAGNOSIS_EVIDENCE_CITED,
  { recordId: string; patientId: string; fileId: string }
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

/** The plan moved to another phase of the treatment plan (ADR-0045). */
export const TREATMENT_PRIORITISED = 'TreatmentPrioritised';
export type TreatmentPrioritised = DomainEvent<
  typeof TREATMENT_PRIORITISED,
  { planId: string; visitId: string | null; patientId: string; priority: PlanPriority }
>;

/** The patient accepted the proposed treatment, or the acceptance was withdrawn. */
export const TREATMENT_ACCEPTED = 'TreatmentAccepted';
export type TreatmentAccepted = DomainEvent<
  typeof TREATMENT_ACCEPTED,
  { planId: string; patientId: string; accepted: boolean }
>;

export const TREATMENT_CANCELLED = 'TreatmentCancelled';
export type TreatmentCancelled = DomainEvent<
  typeof TREATMENT_CANCELLED,
  { planId: string; visitId: string | null; patientId: string; toothCode: string | null }
>;

/**
 * What is at a tooth position changed (feature 7, H1): set by hand or by a service, or taken
 * back. `presence` is what the tooth has now; `visitId` is null for a change on the patient
 * record.
 */
export const TOOTH_PRESENCE_CHANGED = 'ToothPresenceChanged';
export type ToothPresenceChanged = DomainEvent<
  typeof TOOTH_PRESENCE_CHANGED,
  { patientId: string; visitId: string | null; toothCode: string; presence: ToothPresenceState }
>;
