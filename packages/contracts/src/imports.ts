import { z } from 'zod';
import { optionalEmailSchema } from './auth.js';
import { openingBalanceInputSchema } from './billing.js';
import {
  catalogCodeSchema,
  jawSchema,
  nonNegativeAmountSchema,
  serviceItemInputSchema,
} from './catalog.js';
import { idSchema, isoDateSchema, nameSchema, optionalText } from './common.js';
import { patientInputSchema, patientSexSchema } from './patients.js';
import { toothCodeSchema } from './tooth.js';

/**
 * The import APIs (feature 6, ADR-0053): rows from a previous system, as JSON, written through
 * the owning modules' services. Each row is its own transaction and answers on its own; a re-run
 * finds what it already imported (`exists`). `dryRun` runs every row and rolls it back.
 */

/** Rows per request: small enough for one request, big enough for a migration in a few dozen. */
export const IMPORT_ROWS_MAX = 100;

function importRequestSchema<TRow extends z.ZodType>(row: TRow) {
  return z.object({
    /** Run every row and roll it back: the results say what a real run would do. */
    dryRun: z.boolean().default(false),
    rows: z.array(row).min(1).max(IMPORT_ROWS_MAX),
  });
}

/** The previous system's id of a record, the import key (`patients.external_id`, `visits.external_id`). */
const externalIdSchema = z.string().trim().min(1).max(80);

/** A catalog service to add: the Catalog's row, new only (no `id`). */
export const importServiceRowSchema = serviceItemInputSchema.refine((row) => row.id === undefined, {
  message: 'An imported service is new: no id',
  path: ['id'],
});
export const importServicesRequestSchema = importRequestSchema(importServiceRowSchema);
export type ImportServicesRequest = z.infer<typeof importServicesRequestSchema>;
export type ImportServiceRow = z.infer<typeof importServiceRowSchema>;

export const IMPORT_PATIENT_STATUSES = ['active', 'archived'] as const;

/**
 * A patient: the record's fields, its key in the previous system, the allergies by name (each
 * added to the clinic's list when new), the medication line, whether it comes in archived, and
 * the balance it carries over (an opening balance, ADR-0053).
 */
export const importPatientRowSchema = z.object({
  externalId: externalIdSchema,
  fullName: nameSchema,
  sex: patientSexSchema.default('unknown'),
  dateOfBirth: patientInputSchema.shape.dateOfBirth,
  phone: optionalText(40),
  email: optionalEmailSchema,
  address: optionalText(240),
  notes: optionalText(2000),
  medication: optionalText(500),
  allergies: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  status: z.enum(IMPORT_PATIENT_STATUSES).default('active'),
  openingBalance: openingBalanceInputSchema.nullish().transform((balance) => balance ?? null),
});
export const importPatientsRequestSchema = importRequestSchema(importPatientRowSchema);
export type ImportPatientsRequest = z.infer<typeof importPatientsRequestSchema>;
export type ImportPatientRow = z.infer<typeof importPatientRowSchema>;

/** A clock time `HH:MM`, in the clinic's time zone. */
const clockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');

/**
 * A service line of an imported visit. The target follows the catalog's charge unit (a tooth, a
 * jaw, or neither). `amount` is what was charged for it, as recorded. A line not `done` was
 * started, not finished: it becomes plan work in progress (ADR-0053).
 */
export const importVisitLineSchema = z.object({
  serviceCode: catalogCodeSchema,
  tooth: toothCodeSchema.nullish().transform((tooth) => tooth ?? null),
  jaw: jawSchema.nullish().transform((jaw) => jaw ?? null),
  amount: nonNegativeAmountSchema.default('0'),
  done: z.boolean().default(true),
});
export type ImportVisitLine = z.infer<typeof importVisitLineSchema>;

/**
 * A finished visit from the previous system, imported as completed, with no charge (the opening
 * balance holds the money). Times are the clinic's; without them it is the day's start.
 */
export const importVisitRowSchema = z
  .object({
    externalId: externalIdSchema,
    patientExternalId: externalIdSchema,
    branchId: idSchema,
    /** A staff profile id (ADR-0020). */
    dentistId: idSchema,
    /** Blank or absent: no room (a variable left empty in a client). */
    roomId: z
      .union([idSchema, z.literal('')])
      .nullish()
      .transform((room) => room || null),
    date: isoDateSchema,
    startTime: clockTimeSchema.nullish().transform((time) => time ?? null),
    endTime: clockTimeSchema.nullish().transform((time) => time ?? null),
    notes: optionalText(4000),
    lines: z.array(importVisitLineSchema).max(50).default([]),
  })
  .refine((row) => row.lines.length > 0 || row.notes !== null, {
    message: 'A visit needs a service or a note',
    path: ['lines'],
  });
export const importVisitsRequestSchema = importRequestSchema(importVisitRowSchema);
export type ImportVisitsRequest = z.infer<typeof importVisitsRequestSchema>;
export type ImportVisitRow = z.infer<typeof importVisitRowSchema>;

export const IMPORT_ROW_STATUSES = ['created', 'exists', 'failed'] as const;

/** Why a row failed: a domain error's code, or a field's issue (`path` within the row). */
export const importIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  path: z.string().nullable(),
});

/** One row's outcome, in request order. `ref` is the row's key (external id or code). */
export const importRowResultSchema = z.object({
  ref: z.string(),
  status: z.enum(IMPORT_ROW_STATUSES),
  /** The record created, or found when it `exists`; null when it failed. */
  id: idSchema.nullable(),
  issues: z.array(importIssueSchema),
});
export type ImportRowResult = z.infer<typeof importRowResultSchema>;

export const importResultSchema = z.object({
  dryRun: z.boolean(),
  results: z.array(importRowResultSchema),
});
export type ImportResult = z.infer<typeof importResultSchema>;
