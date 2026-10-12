import { z } from 'zod';

/**
 * Visit flows (feature 10, ADR-0044): why the patient is here decides which steps the visit
 * shows. Pure and shared: the API validates and stores the type and the current step with these,
 * and the SPA draws the stepper from them. The steps are navigation, never a gate.
 */

export const VISIT_TYPES = [
  'examination',
  'emergency',
  'treatment',
  'hygiene',
  'consultation',
] as const;
export const visitTypeSchema = z.enum(VISIT_TYPES);
export type VisitType = z.infer<typeof visitTypeSchema>;

/**
 * The types a patient can be registered for and a catalog service can be added on: every type
 * but `treatment`, which is chosen because there is planned work, not by itself.
 */
export const ENTRY_VISIT_TYPES = ['examination', 'emergency', 'hygiene', 'consultation'] as const;
export const entryVisitTypeSchema = z.enum(ENTRY_VISIT_TYPES);
export type EntryVisitType = z.infer<typeof entryVisitTypeSchema>;

export const VISIT_STEPS = [
  'intake',
  'complaint',
  'examine',
  'findings',
  'plan',
  'today',
  'perform',
  'complete',
] as const;
export const visitStepSchema = z.enum(VISIT_STEPS);
export type VisitStep = z.infer<typeof visitStepSchema>;

/** The Steps | All toggle of the visit header, remembered with the visit. */
export const VISIT_VIEW_MODES = ['steps', 'all'] as const;
export const visitViewModeSchema = z.enum(VISIT_VIEW_MODES);
export type VisitViewMode = z.infer<typeof visitViewModeSchema>;

/** How long an emergency's pain has lasted. */
export const PAIN_SINCE = ['today', 'days_1_3', 'about_a_week', 'longer'] as const;
export const painSinceSchema = z.enum(PAIN_SINCE);
export type PainSince = z.infer<typeof painSinceSchema>;

export const PAIN_SCORE_MAX = 10;
export const painScoreSchema = z.number().int().min(0).max(PAIN_SCORE_MAX);

/** The steps of each type, in order. */
const STEPS: Readonly<Record<VisitType, readonly VisitStep[]>> = {
  examination: ['intake', 'examine', 'findings', 'plan', 'perform', 'complete'],
  consultation: ['intake', 'examine', 'findings', 'plan', 'perform', 'complete'],
  emergency: ['complaint', 'examine', 'perform', 'complete'],
  treatment: ['today', 'perform', 'complete'],
  hygiene: ['perform', 'complete'],
};

/**
 * The types that are not about treating: their `perform` step is there for the dentist who
 * treats on the spot, and says it is optional.
 */
const PERFORM_OPTIONAL: ReadonlySet<VisitType> = new Set(['examination', 'consultation']);

/**
 * What a visit holds, as far as its steps care. Counts are of this visit only. `files` is the
 * SPA's to give: the API does not know a visit's files and never needs the ticks.
 */
export interface VisitFlowFacts {
  historyConfirmed: boolean;
  hasReason: boolean;
  /** A pain score or a "since" was entered. */
  hasComplaint: boolean;
  /** Diagnoses recorded in this visit. */
  diagnoses: number;
  /** Tooth presence set by hand in this visit. */
  presenceChanges: number;
  /** Files linked to this visit. */
  files: number;
  /** Plans made in this visit. */
  plans: number;
  /** Items of today's list that the visit performed or continued. */
  worklistTouched: number;
  /** Services that were not added automatically, plus this visit's sessions. */
  work: number;
}

export const NO_FLOW_FACTS: VisitFlowFacts = {
  historyConfirmed: false,
  hasReason: false,
  hasComplaint: false,
  diagnoses: 0,
  presenceChanges: 0,
  files: 0,
  plans: 0,
  worklistTouched: 0,
  work: 0,
};

/** The steps a visit of this type shows, in order. */
export function stepsOf(type: VisitType): readonly VisitStep[] {
  return STEPS[type];
}

/** The step a new visit of this type opens on. */
export function firstStep(type: VisitType): VisitStep {
  return STEPS[type][0] ?? 'complete';
}

/** Whether a type has a step; the API refuses to store one it does not. */
export function hasStep(type: VisitType, step: VisitStep): boolean {
  return STEPS[type].includes(step);
}

/** A step the visit is not expected to fill: Perform in an examination or a consultation. */
export function isOptionalStep(type: VisitType, step: VisitStep): boolean {
  return step === 'perform' && PERFORM_OPTIONAL.has(type);
}

/**
 * The i18n key of a step's label, which depends on the type: Plan is the Proposal of a
 * consultation, Perform is "Treat now" in an emergency.
 */
export function stepLabelKey(type: VisitType, step: VisitStep): string {
  if (step === 'plan' && type === 'consultation') return 'proposal';
  if (step === 'perform' && type === 'emergency') return 'treatNow';
  return step;
}

const DONE: Readonly<Record<VisitStep, (facts: VisitFlowFacts) => boolean>> = {
  intake: (facts) => facts.historyConfirmed || facts.hasReason,
  complaint: (facts) => facts.hasReason || facts.hasComplaint,
  examine: (facts) => facts.diagnoses > 0 || facts.presenceChanges > 0 || facts.files > 0,
  findings: (facts) => facts.diagnoses > 0,
  plan: (facts) => facts.plans > 0,
  today: (facts) => facts.worklistTouched > 0,
  perform: (facts) => facts.work > 0,
  // Completing ends the flow: a live visit never shows it ticked.
  complete: () => false,
};

/**
 * The steps that earn their tick: those the visit holds a record of. It is derived, so an Undo
 * removes the tick and every device agrees.
 */
export function doneSteps(type: VisitType, facts: VisitFlowFacts): VisitStep[] {
  return stepsOf(type).filter((step) => DONE[step](facts));
}

/**
 * What a treatment visit has on its list for today when nobody has chosen yet (ADR-0048): the
 * work in progress and what is urgent, in the order given. The dentist ticks the rest on
 * Today's work.
 */
export function defaultWorklist<TPlan extends { status: string; priority: string }>(
  open: readonly TPlan[],
): TPlan[] {
  return open.filter((plan) => plan.status === 'in_progress' || plan.priority === 'urgent');
}

/**
 * The type the Start visit popover suggests: Treatment while the patient has open plans, else
 * what a new patient was registered for, else an examination.
 */
export function suggestVisitType(patient: {
  openPlans: number;
  countedVisits: number;
  firstVisitType: EntryVisitType | null;
}): VisitType {
  if (patient.openPlans > 0) return 'treatment';
  if (patient.countedVisits === 0 && patient.firstVisitType !== null) return patient.firstVisitType;
  return 'examination';
}
