import { z } from 'zod';
import { chargeUnitSchema } from './catalog.js';
import { idSchema, isoDateSchema, isoDateTimeSchema, moneySchema, optionalText } from './common.js';
import { DENTITION_STAGES } from './patient-age.js';
import { surfaceKeySchema, surfacesSchema, toothCodeSchema } from './tooth.js';

/**
 * `clinical`'s charting records (feature 4a, spec §Data model / §Backend — clinical): diagnoses,
 * treatment plans, tooth presence, the patient chart and its supporting reads. `visits.ts` has
 * the visit lifecycle and money shapes; `visit-money.ts` the pure arithmetic.
 */

const dentitionStageSchema = z.enum(DENTITION_STAGES);

/** A free-text note on a diagnosis or plan record — short, unlike a patient's own notes field
 * (`patients.ts`'s `optionalText(2000)`). */
const RECORD_NOTE_MAX = 500;

export const DIAGNOSIS_STATUSES = ['active', 'resolved'] as const;
export type DiagnosisStatus = (typeof DIAGNOSIS_STATUSES)[number];
export const diagnosisStatusSchema = z.enum(DIAGNOSIS_STATUSES);

/** `patient_diagnoses`, camelCase, plus `dentistName` and `recordedInVisitDate` (the chart never
 * needs a second call just to show who and when). */
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
  recordedInVisitId: idSchema,
  recordedInVisitDate: isoDateSchema,
  recordedAt: isoDateTimeSchema,
  resolvedInVisitId: idSchema.nullable(),
  resolvedAt: isoDateTimeSchema.nullable(),
});
export type DiagnosisRecord = z.infer<typeof diagnosisRecordSchema>;

export const PLAN_STATUSES = ['planned', 'performed', 'cancelled'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];
export const planStatusSchema = z.enum(PLAN_STATUSES);

/** `treatment_plans`, camelCase, plus `dentistName`. */
export const treatmentPlanSchema = z.object({
  id: idSchema,
  patientId: idSchema,
  toothCode: toothCodeSchema.nullable(),
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
  recordedInVisitId: idSchema,
  recordedAt: isoDateTimeSchema,
  performedInVisitId: idSchema.nullable(),
  performedAt: isoDateTimeSchema.nullable(),
  cancelledInVisitId: idSchema.nullable(),
  cancelledAt: isoDateTimeSchema.nullable(),
});
export type TreatmentPlan = z.infer<typeof treatmentPlanSchema>;

const TOOTH_PRESENCE_VALUES = ['primary', 'permanent'] as const;
export type ToothPresenceValue = (typeof TOOTH_PRESENCE_VALUES)[number];
const toothPresenceValueSchema = z.enum(TOOTH_PRESENCE_VALUES);

/** One `tooth_status` row: an explicit override of what occupies a chart column (spec W5/W15). */
export const toothPresenceSchema = z.object({
  /** A permanent FDI code, position 1–5 — the only chart columns with a primary predecessor. */
  position: toothCodeSchema,
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
  surfaces: surfacesSchema.default([]),
  note: optionalText(RECORD_NOTE_MAX),
});
export type PlanTreatmentInput = z.infer<typeof planTreatmentSchema>;

export const setToothPresenceSchema = z.object({
  present: toothPresenceValueSchema,
});
export type SetToothPresenceInput = z.infer<typeof setToothPresenceSchema>;

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
  surfaces: surfacesSchema,
  final: moneySchema,
});
export type HistoryService = z.infer<typeof historyServiceSchema>;

const TOOTH_MARKS = ['treated_today', 'treated', 'planned'] as const;
const toothMarkSchema = z.enum(TOOTH_MARKS);

/**
 * One tooth's derived chart state (Task A3 computes these from the raw records; the shape is
 * defined here so `chart.ts` can import `ToothState` before it exists). `state` is the glyph's
 * overall precedence (`'none'` when nothing applies); `surfaces` and `wholeTooth` are the
 * finer-grained marks a per-surface or whole-tooth service/plan/diagnosis leaves; `titleParts`
 * feeds the tooltip.
 */
export const toothStateSchema = z.object({
  code: toothCodeSchema,
  state: z.enum([...TOOTH_MARKS, 'none']),
  surfaces: z.partialRecord(surfaceKeySchema, toothMarkSchema),
  wholeTooth: toothMarkSchema.nullable(),
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
  /** Completed services, most recent first. */
  history: z.array(historyServiceSchema),
  liveVisitId: idSchema.nullable(),
  /** Derived per-tooth state (Task A3), one entry per code that has any. */
  teeth: z.array(toothStateSchema),
});
export type PatientChart = z.infer<typeof patientChartSchema>;

/** `GET /clinical/patients/:id/teeth/:toothCode/history`: the three stages, in order. */
export const toothHistorySchema = z.object({
  toothCode: toothCodeSchema,
  diagnoses: z.array(diagnosisRecordSchema),
  plans: z.array(treatmentPlanSchema),
  services: z.array(historyServiceSchema),
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
    services: z.array(z.object({ name: z.string(), toothCode: toothCodeSchema.nullable() })),
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
