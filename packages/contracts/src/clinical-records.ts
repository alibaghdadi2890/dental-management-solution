import { z } from 'zod';
import { chargeUnitSchema, jawSchema } from './catalog.js';
import { idSchema, isoDateSchema, isoDateTimeSchema, moneySchema, optionalText } from './common.js';
import { dentitionStageSchema } from './patient-age.js';
import {
  successionPositionSchema,
  surfaceKeySchema,
  surfacesSchema,
  toothCodeSchema,
} from './tooth.js';
import { visitSchema } from './visits.js';

/**
 * `clinical`'s charting records (spec §Data model / §Backend — clinical): diagnoses,
 * treatment plans, tooth presence, the patient chart and its supporting reads. `visits.ts` has
 * the visit lifecycle and money shapes; `visit-money.ts` the pure arithmetic.
 * `dentitionStageSchema` lives in `patient-age.ts` (`patients` owns the override); this file
 * imports it.
 */

/** A free-text note on a diagnosis or plan record — short, unlike a patient's own notes field
 * (`patients.ts`'s `optionalText(2000)`). */
const RECORD_NOTE_MAX = 500;

export const DIAGNOSIS_STATUSES = ['active', 'resolved'] as const;
export type DiagnosisStatus = (typeof DIAGNOSIS_STATUSES)[number];
export const diagnosisStatusSchema = z.enum(DIAGNOSIS_STATUSES);

/** `patient_diagnoses`, camelCase, plus `dentistName` and `recordedDate` (the chart never
 * needs a second call just to show who and when). Recorded in a visit, or on the patient record
 * without one (`recordedInVisitId` null, ADR-0031). */
export const diagnosisRecordSchema = z.object({
  id: idSchema,
  patientId: idSchema,
  toothCode: toothCodeSchema,
  surfaces: surfacesSchema,
  diagnosisId: idSchema,
  /** Snapshot of the catalog item at record-time (CLAUDE.md §7). */
  code: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  status: diagnosisStatusSchema,
  note: z.string().nullable(),
  /** A staff profile id (ADR-0020). */
  dentistId: idSchema,
  dentistName: z.string(),
  /** The auth user id who recorded it. */
  recordedBy: idSchema,
  recordedInVisitId: idSchema.nullable(),
  /** The visit's tenant-local date, or the tenant-local date it was recorded on without one. */
  recordedDate: isoDateSchema,
  recordedAt: isoDateTimeSchema,
  resolvedInVisitId: idSchema.nullable(),
  resolvedAt: isoDateTimeSchema.nullable(),
});
export type DiagnosisRecord = z.infer<typeof diagnosisRecordSchema>;

/**
 * `planned → in_progress → performed`, with `cancelled` from either open state (ADR-0032). Work
 * that takes several visits is `in_progress` from its first session until it is marked done, and
 * is charged only then.
 */
export const PLAN_STATUSES = ['planned', 'in_progress', 'performed', 'cancelled'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export const planStatusSchema = z.enum(PLAN_STATUSES);

/** A plan that still has work to do: planned, or started and not yet done. */
export const isOpenPlan = (plan: { status: PlanStatus }): boolean =>
  plan.status === 'planned' || plan.status === 'in_progress';

/** One visit's work on a plan in progress (`treatment_plan_sessions`): no money, a note at most. */
export const planSessionSchema = z.object({
  visitId: idSchema,
  /** The visit's tenant-local date. */
  date: isoDateSchema,
  note: z.string().nullable(),
});
export type PlanSession = z.infer<typeof planSessionSchema>;

/** `treatment_plans`, camelCase, plus `dentistName`. */
export const treatmentPlanSchema = z.object({
  id: idSchema,
  patientId: idSchema,
  toothCode: toothCodeSchema.nullable(),
  /** Set iff `chargeUnit` is `per_jaw`. */
  jaw: jawSchema.nullable(),
  surfaces: surfacesSchema,
  procedureId: idSchema,
  /** Snapshot of the catalog item at record-time (CLAUDE.md §7). */
  code: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  chargeUnit: chargeUnitSchema,
  /** Copied from the catalog at plan-time; performing the plan charges this price. */
  price: moneySchema,
  diagnosisRecordId: idSchema.nullable(),
  status: planStatusSchema,
  note: z.string().nullable(),
  /** A staff profile id (ADR-0020). */
  dentistId: idSchema,
  dentistName: z.string(),
  /** The auth user id who recorded it. */
  recordedBy: idSchema,
  recordedInVisitId: idSchema.nullable(),
  recordedAt: isoDateTimeSchema,
  /** The named plan it belongs to, if any. */
  groupId: idSchema.nullable(),
  /** Set once the work was started (ADR-0032); kept after it is done. */
  startedInVisitId: idSchema.nullable(),
  startedAt: isoDateTimeSchema.nullable(),
  /** The visits that worked on it, oldest first; a voided visit's stay (`voidedVisitIds`). */
  sessions: z.array(planSessionSchema),
  performedInVisitId: idSchema.nullable(),
  performedAt: isoDateTimeSchema.nullable(),
  cancelledInVisitId: idSchema.nullable(),
  cancelledAt: isoDateTimeSchema.nullable(),
});
export type TreatmentPlan = z.infer<typeof treatmentPlanSchema>;

/** A named plan (`plan_groups`): a title over some of the patient's planned procedures. It has no
 * status and no money of its own; its estimate is the sum of its open plans. */
export const planGroupSchema = z.object({
  id: idSchema,
  patientId: idSchema,
  title: z.string(),
  note: z.string().nullable(),
});
export type PlanGroup = z.infer<typeof planGroupSchema>;

export const planGroupInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  note: optionalText(RECORD_NOTE_MAX),
});
export type PlanGroupInput = z.infer<typeof planGroupInputSchema>;

export const TOOTH_PRESENCE_VALUES = ['primary', 'permanent'] as const;
export type ToothPresenceValue = (typeof TOOTH_PRESENCE_VALUES)[number];
export const toothPresenceValueSchema = z.enum(TOOTH_PRESENCE_VALUES);

/** One `tooth_status` row: an explicit override of what occupies a chart column (spec W5/W15). */
export const toothPresenceSchema = z.object({
  position: successionPositionSchema,
  present: toothPresenceValueSchema,
});
export type ToothPresence = z.infer<typeof toothPresenceSchema>;

export const recordDiagnosisSchema = z.object({
  diagnosisId: idSchema,
  toothCode: toothCodeSchema,
  surfaces: surfacesSchema.default([]),
  note: optionalText(RECORD_NOTE_MAX),
});
export type RecordDiagnosisInput = z.infer<typeof recordDiagnosisSchema>;

export const planTreatmentSchema = z.object({
  procedureId: idSchema,
  toothCode: toothCodeSchema.optional(),
  jaw: jawSchema.optional(),
  surfaces: surfacesSchema.default([]),
  note: optionalText(RECORD_NOTE_MAX),
  /** One of the patient's named plans. */
  groupId: idSchema.optional(),
});
export type PlanTreatmentInput = z.infer<typeof planTreatmentSchema>;

/** Continue today: this visit's session on a plan in progress. */
export const recordSessionSchema = z.object({ note: optionalText(RECORD_NOTE_MAX) });
export type RecordSessionInput = z.infer<typeof recordSessionSchema>;

/** A visit's answer to "which unfinished services do you continue today?" (unfinished spec U5):
 * the plans it continues; none is "Not today". */
export const answerUnfinishedSchema = z.object({
  continue: z
    .array(idSchema)
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'Each plan once' }),
});
export type AnswerUnfinishedInput = z.infer<typeof answerUnfinishedSchema>;

/**
 * Recording on the patient record, outside a visit (`chart:write`, ADR-0031). `dentistId` is a
 * staff profile id; without it the caller is the dentist, when they are one.
 */
export const recordPatientDiagnosisSchema = recordDiagnosisSchema.extend({
  dentistId: idSchema.optional(),
});
export type RecordPatientDiagnosisInput = z.infer<typeof recordPatientDiagnosisSchema>;

export const planPatientTreatmentSchema = planTreatmentSchema.extend({
  dentistId: idSchema.optional(),
});
export type PlanPatientTreatmentInput = z.infer<typeof planPatientTreatmentSchema>;

/** Moves an open plan between named plans (`groupId: null` ungroups it) or edits its note. */
export const updatePlanSchema = z
  .object({
    groupId: idSchema.nullable().optional(),
    note: optionalText(RECORD_NOTE_MAX).optional(),
  })
  .refine((patch) => patch.groupId !== undefined || patch.note !== undefined, {
    message: 'Change at least one field',
  });
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

export const setToothPresenceSchema = z.object({
  present: toothPresenceValueSchema,
});
export type SetToothPresenceInput = z.infer<typeof setToothPresenceSchema>;

/** The charting routes answer with the updated visit plus the affected record (spec §HTTP). */
export const diagnosisResultSchema = z.object({
  visit: visitSchema,
  record: diagnosisRecordSchema,
});
export type DiagnosisResult = z.infer<typeof diagnosisResultSchema>;

export const planResultSchema = z.object({ visit: visitSchema, record: treatmentPlanSchema });
export type PlanResult = z.infer<typeof planResultSchema>;

export const toothPresenceResultSchema = z.object({
  visit: visitSchema,
  record: toothPresenceSchema,
});
export type ToothPresenceResult = z.infer<typeof toothPresenceResultSchema>;

/** One completed service in a patient's tooth or visit history: `visit_services` joined back to
 * its visit and dentist. */
export const historyServiceSchema = z.object({
  id: idSchema,
  visitId: idSchema,
  visitDate: isoDateSchema,
  dentistName: z.string(),
  code: z.string(),
  name: z.string(),
  toothCode: toothCodeSchema.nullable(),
  jaw: jawSchema.nullable(),
  surfaces: surfacesSchema,
  final: moneySchema,
  /** The plan this service performed, if any (the record's treatment threads, 4b). */
  planId: idSchema.nullable(),
});
export type HistoryService = z.infer<typeof historyServiceSchema>;

const SERVICE_MARKS = ['treated_today', 'treated'] as const;
const serviceMarkSchema = z.enum(SERVICE_MARKS);

export const TOOTH_VISUAL_STATES = [...SERVICE_MARKS, 'in_progress', 'planned', 'none'] as const;
export type ToothVisualState = (typeof TOOTH_VISUAL_STATES)[number];
const toothVisualStateSchema = z.enum(TOOTH_VISUAL_STATES);

/**
 * One tooth's derived chart state (`chart.ts`'s `deriveChart`; spec §Chart state / §Derived
 * values). `state` is the glyph's overall precedence (`'none'` when nothing applies); `surfaces`
 * and `wholeTooth` carry only the marks a per-surface or whole-tooth *service* (completed or
 * live) leaves — never 'planned' or 'in_progress'. An open plan shows only through `state`
 * (`'in_progress'` once started, ADR-0032, else `'planned'`) and `openPlanIds`; the renderer washes the cells that carry no service mark itself once it sees a
 * planned state (`chart.ts`'s `cellMark`), the same way the POC's `toothCells` falls back to a
 * planned wash for cells with no service mark. A diagnosis alone never marks a surface or the
 * whole tooth; it only sets `hasActiveDiagnosis`. `titleParts` feeds the tooltip.
 */
export const toothStateSchema = z.object({
  code: toothCodeSchema,
  state: toothVisualStateSchema,
  surfaces: z.partialRecord(surfaceKeySchema, serviceMarkSchema),
  wholeTooth: serviceMarkSchema.nullable(),
  hasActiveDiagnosis: z.boolean(),
  openPlanIds: z.array(idSchema),
  historyCount: z.number().int().nonnegative(),
  titleParts: z.object({
    diagnoses: z.array(z.string()),
    plans: z.array(z.string()),
    historyCount: z.number().int().nonnegative(),
  }),
});
export type ToothState = z.infer<typeof toothStateSchema>;

/** `GET /clinical/patients/:id/chart`. */
export const patientChartSchema = z.object({
  dentition: z.object({
    stage: dentitionStageSchema,
    source: z.enum(['auto', 'override']),
    ageYears: z.number().int().nonnegative().nullable(),
  }),
  toothStatus: z.array(toothPresenceSchema),
  diagnoses: z.array(diagnosisRecordSchema),
  plans: z.array(treatmentPlanSchema),
  /** The patient's named plans, oldest first. */
  planGroups: z.array(planGroupSchema),
  /** Completed services, most recent first. */
  history: z.array(historyServiceSchema),
  liveVisitId: idSchema.nullable(),
  /** The patient's voided visits (feature 4b, D6): records and services from them stay, marked. */
  voidedVisitIds: z.array(idSchema),
  /** Derived per-tooth state (`chart.ts`'s `deriveChart`), one entry per code that has any. */
  teeth: z.array(toothStateSchema),
});
export type PatientChart = z.infer<typeof patientChartSchema>;

/** What the patient-level charting routes answer with: the chart as it now is. */
export const patientChartResultSchema = z.object({ chart: patientChartSchema });
export type PatientChartResult = z.infer<typeof patientChartResultSchema>;

/** `GET /clinical/patients/:id/teeth/:toothCode/history`: the three stages, in order. */
export const toothHistorySchema = z.object({
  toothCode: toothCodeSchema,
  diagnoses: z.array(diagnosisRecordSchema),
  plans: z.array(treatmentPlanSchema),
  services: z.array(historyServiceSchema),
  /** Which of the visits these records came from were voided (D6). */
  voidedVisitIds: z.array(idSchema),
});
export type ToothHistory = z.infer<typeof toothHistorySchema>;

/** `GET /clinical/patients/:id/last-visit`: `null` when the patient has no completed visit. */
export const lastVisitSchema = z
  .object({
    id: idSchema,
    date: isoDateSchema,
    dentistName: z.string(),
    durationMinutes: z.number().int().positive(),
    total: moneySchema,
    services: z.array(
      z.object({
        name: z.string(),
        toothCode: toothCodeSchema.nullable(),
        jaw: jawSchema.nullable(),
      }),
    ),
    notes: z.string(),
  })
  .nullable();
export type LastVisit = z.infer<typeof lastVisitSchema>;

/** `GET /clinical/patients/:id/summary` (spec W8): the Record overview's treatment counts. */
export const clinicalSummarySchema = z.object({
  visits: z.number().int().nonnegative(),
  activeDiagnoses: z.number().int().nonnegative(),
  plannedProcedures: z.number().int().nonnegative(),
  teethTreated: z.number().int().nonnegative(),
  servicesPerformed: z.number().int().nonnegative(),
});
export type ClinicalSummary = z.infer<typeof clinicalSummarySchema>;
