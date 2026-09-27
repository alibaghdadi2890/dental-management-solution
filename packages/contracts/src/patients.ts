import { z } from 'zod';
import { emailSchema } from './auth.js';
import {
  idSchema,
  isoDateSchema,
  isoDateTimeSchema,
  nameSchema,
  notFutureDateSchema,
  offsetPageSchema,
  optionalText,
} from './common.js';
import { reasonSchema } from './audit.js';

/**
 * `patients` (feature 3): patient records, the palette, the list and its filters, and the pure
 * age/dentition/merge helpers the list and record screens both need. No I/O, no time-zone math —
 * every date here is an ISO `YYYY-MM-DD` string and every "today" is passed in by the caller,
 * already resolved to the tenant's time zone (CLAUDE.md §5).
 */

export const PATIENT_SEXES = ['female', 'male', 'other', 'unknown'] as const;
export const patientSexSchema = z.enum(PATIENT_SEXES);
export type PatientSex = z.infer<typeof patientSexSchema>;

const MEDICAL_ALERTS_MAX = 20;

function dedupeCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

/** Trimmed, 1–60 chars each, de-duplicated case-insensitively (first occurrence wins), max 20. */
export const medicalAlertsSchema = z
  .array(z.string().trim().min(1).max(60))
  .transform(dedupeCaseInsensitive)
  .pipe(z.array(z.string()).max(MEDICAL_ALERTS_MAX));

/** `P-` + at least 6 digits, zero-padded (`P-000001`), minted by the create transaction. */
export const displayNumberSchema = z.string().regex(/^P-\d{6,}$/, 'Expected a patient number');

/** Blank/absent → null, validated as an email only when present. */
const optionalEmailSchema = z
  .string()
  .trim()
  .nullish()
  .transform((value) => (value ? value : null))
  .pipe(z.union([z.null(), emailSchema]));

const primaryDentistIdSchema = idSchema.nullish().transform((value) => value ?? null);

/**
 * The editable fields, without defaults — shared verbatim by `patientInputSchema` (create) and
 * `patientPatchSchema` (edit) so a `.partial()` on a defaulted field can never leak a default
 * into a patch (a bare `z.object({...}).partial()` on a schema with `.default()` fields keeps
 * injecting them; see the users module's `staffUserPatchSchema` for the same pattern).
 */
const patientFields = {
  fullName: nameSchema,
  /** Raw text as typed; the server normalises it against the tenant's country (`phone.ts`). */
  phone: z.string().trim().min(1).max(40),
  dateOfBirth: notFutureDateSchema().optional(),
  sex: patientSexSchema,
  email: optionalEmailSchema,
  address: optionalText(240),
  insurance: optionalText(120),
  emergencyContact: optionalText(160),
  medicalAlerts: medicalAlertsSchema,
  primaryDentistUserId: primaryDentistIdSchema,
  notes: optionalText(2000),
  guardianName: optionalText(120),
  guardianPhone: optionalText(40),
  externalId: optionalText(64),
};

export const patientInputSchema = z.object({
  ...patientFields,
  sex: patientSexSchema.default('unknown'),
  medicalAlerts: medicalAlertsSchema.default([]),
});
export type PatientInput = z.infer<typeof patientInputSchema>;

export const patientPatchSchema = z
  .object(patientFields)
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Change at least one field' });
export type PatientPatch = z.infer<typeof patientPatchSchema>;

/** The full record (`GET /patients/:id`). Age and dentition stage are derived, never stored. */
export const patientSchema = z.object({
  id: idSchema,
  displayNumber: displayNumberSchema,
  fullName: z.string(),
  /** E.164, as stored. */
  phone: z.string(),
  dateOfBirth: isoDateSchema.nullable(),
  sex: patientSexSchema,
  email: z.string().nullable(),
  address: z.string().nullable(),
  insurance: z.string().nullable(),
  emergencyContact: z.string().nullable(),
  medicalAlerts: z.array(z.string()),
  primaryDentistUserId: idSchema.nullable(),
  notes: z.string().nullable(),
  guardianName: z.string().nullable(),
  guardianPhone: z.string().nullable(),
  externalId: z.string().nullable(),
  archivedAt: isoDateTimeSchema.nullable(),
  mergedIntoId: idSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Patient = z.infer<typeof patientSchema>;

/** The list/palette columns (README §Patients, §App shell). */
export const patientListItemSchema = patientSchema.pick({
  id: true,
  displayNumber: true,
  fullName: true,
  phone: true,
  dateOfBirth: true,
  sex: true,
  medicalAlerts: true,
  primaryDentistUserId: true,
  email: true,
  archivedAt: true,
  updatedAt: true,
});
export type PatientListItem = z.infer<typeof patientListItemSchema>;

export const PATIENT_VIEWS = ['active', 'owing', 'notSeen', 'archived'] as const;
export const patientViewSchema = z.enum(PATIENT_VIEWS);
export type PatientView = z.infer<typeof patientViewSchema>;

export const PATIENT_SORTS = ['name', 'age', 'dentist', 'recent', 'balance'] as const;
export const patientSortSchema = z.enum(PATIENT_SORTS);
export type PatientSort = z.infer<typeof patientSortSchema>;

export const PATIENT_PAGE_SIZES = [10, 25, 50] as const;
const patientPageSizeSchema = z.union([
  z.literal(PATIENT_PAGE_SIZES[0]),
  z.literal(PATIENT_PAGE_SIZES[1]),
  z.literal(PATIENT_PAGE_SIZES[2]),
]);

/**
 * Parsed from a URL query string. `view=owing` and `sort=balance` are only answered by the
 * `billing` route (`GET /billing/patients`); `GET /patients` rejects them with 400 (design Q5/Q7).
 */
export const patientListQuerySchema = z.object({
  view: patientViewSchema.default('active'),
  q: z
    .string()
    .trim()
    .max(100)
    .nullish()
    .transform((value) => (value ? value : undefined)),
  dentist: z.union([idSchema, z.literal('none')]).optional(),
  age: z.enum(['child', 'adult', 'senior']).optional(),
  alerts: z.enum(['yes', 'no']).optional(),
  lastVisit: z.enum(['any', 'never']).optional(),
  sort: patientSortSchema.default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce.number().pipe(patientPageSizeSchema).default(25),
});
export type PatientListQuery = z.infer<typeof patientListQuerySchema>;

/** `GET /patients` (and `GET /billing/patients`, design Q6/Q7): offset paging, not a cursor. */
export const patientPageSchema = offsetPageSchema(patientListItemSchema);
export type PatientPage = z.infer<typeof patientPageSchema>;

export const patientCountsSchema = z.object({
  active: z.number().int().nonnegative(),
  notSeen: z.number().int().nonnegative(),
  archived: z.number().int().nonnegative(),
});
export type PatientCounts = z.infer<typeof patientCountsSchema>;

/** Active patients sharing a `name_key` and a non-null date of birth. */
export const duplicateGroupSchema = z.object({ patients: z.array(patientListItemSchema) });
export type DuplicateGroup = z.infer<typeof duplicateGroupSchema>;

export const duplicateGroupsSchema = z.array(duplicateGroupSchema);

/** The create/edit panel's debounced duplicate warning. */
export const duplicateCheckQuerySchema = z.object({
  fullName: nameSchema,
  dateOfBirth: isoDateSchema,
  excludeId: idSchema.optional(),
});
export type DuplicateCheckQuery = z.infer<typeof duplicateCheckQuerySchema>;

const patientIdsSchema = z
  .array(idSchema)
  .min(1)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, 'The same patient id is sent twice');

/** Bulk archive: all-or-nothing; already-archived ids are a no-op (design Q11). */
export const patientArchiveSchema = z.object({
  ids: patientIdsSchema,
  reason: optionalText(500),
});
export type PatientArchive = z.infer<typeof patientArchiveSchema>;

export const patientRestoreSchema = z.object({ ids: patientIdsSchema });
export type PatientRestore = z.infer<typeof patientRestoreSchema>;

/** The pickable fields of a merge; `guardian` moves `guardianName`/`guardianPhone` together. */
export const MERGE_FIELDS = [
  'fullName',
  'phone',
  'dateOfBirth',
  'sex',
  'email',
  'address',
  'insurance',
  'emergencyContact',
  'primaryDentistUserId',
  'notes',
  'guardian',
] as const;
export const mergeFieldSchema = z.enum(MERGE_FIELDS);
export type MergeField = z.infer<typeof mergeFieldSchema>;

const mergeChoiceSchema = z.enum(['keep', 'drop']);

/** Medical alerts are always unioned, never picked (design Q8) — not a field choice. */
export const patientMergeSchema = z
  .object({
    keepId: idSchema,
    dropId: idSchema,
    /** A field missing here means "keep" (the kept record's own value). */
    fieldChoices: z.partialRecord(mergeFieldSchema, mergeChoiceSchema).default({}),
    reason: reasonSchema,
  })
  .refine((merge) => merge.keepId !== merge.dropId, {
    message: 'A patient cannot be merged into itself',
    path: ['dropId'],
  });
export type PatientMerge = z.infer<typeof patientMergeSchema>;

// ---------------------------------------------------------------------------------------------
// Pure helpers — no Date objects, no time zone: callers pass "today" already resolved to the
// tenant's time zone as an ISO `YYYY-MM-DD` string (CLAUDE.md §5, §8).
// ---------------------------------------------------------------------------------------------

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function parseIsoDate(date: string): DateParts {
  const [year, month, day] = date.split('-').map(Number);
  return { year: year ?? 0, month: month ?? 0, day: day ?? 0 };
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0');
}

function formatIsoDate(parts: DateParts): string {
  return `${pad(parts.year, 4)}-${pad(parts.month, 2)}-${pad(parts.day, 2)}`;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month - 1] ?? 31;
}

/** Whole years from `dob` to `today`. A Feb-29 birthday turns a year older on Mar 1 (non-leap). */
export function ageOn(dob: string, today: string): number {
  const birth = parseIsoDate(dob);
  const current = parseIsoDate(today);
  let age = current.year - birth.year;
  const hasHadBirthdayThisYear =
    current.month > birth.month || (current.month === birth.month && current.day >= birth.day);
  if (!hasHadBirthdayThisYear) age -= 1;
  return age;
}

export const DENTITION_STAGES = ['primary', 'mixed', 'permanent'] as const;
export type DentitionStage = (typeof DENTITION_STAGES)[number];

/** `primary` 0–5, `mixed` 6–12, `permanent` 13+ (README §Patients age·sex column). */
export function dentitionStage(age: number): DentitionStage {
  if (age <= 5) return 'primary';
  if (age <= 12) return 'mixed';
  return 'permanent';
}

export function isMinor(dob: string, today: string): boolean {
  return ageOn(dob, today) < 18;
}

const ADULT_AGE = 18;
const SENIOR_AGE = 65;

export const AGE_BANDS = ['child', 'adult', 'senior'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export function ageBand(age: number): AgeBand {
  if (age < ADULT_AGE) return 'child';
  if (age < SENIOR_AGE) return 'adult';
  return 'senior';
}

/** Subtracts whole years, clamping Feb 29 to Feb 28 when the target year is not a leap year. */
function subtractYears(parts: DateParts, years: number): DateParts {
  const year = parts.year - years;
  const day = Math.min(parts.day, daysInMonth(year, parts.month));
  return { year, month: parts.month, day };
}

export interface AgeBandBounds {
  /** Dob must be strictly after this date (exclusive lower age bound). */
  after?: string;
  /** Dob must be on or before this date (inclusive upper age bound). */
  onOrBefore?: string;
}

/**
 * The date-of-birth range such that `dob` falls in it iff `ageOn(dob, today)` falls in `band`
 * (design: "child: after = today−18y; adult: onOrBefore = today−18y, after = today−65y; senior:
 * onOrBefore = today−65y"). Consistent with `ageOn` at the Feb-29 boundary by construction.
 */
export function ageBandBounds(band: AgeBand, today: string): AgeBandBounds {
  const parts = parseIsoDate(today);
  const adultThreshold = formatIsoDate(subtractYears(parts, ADULT_AGE));
  const seniorThreshold = formatIsoDate(subtractYears(parts, SENIOR_AGE));
  switch (band) {
    case 'child':
      return { after: adultThreshold };
    case 'adult':
      return { onOrBefore: adultThreshold, after: seniorThreshold };
    case 'senior':
      return { onOrBefore: seniorThreshold };
  }
}

/** `complete` only when both email and address are recorded (README §Patient information). */
export function profileCompleteness(patient: {
  email: string | null;
  address: string | null;
}): 'complete' | 'partial' {
  return patient.email && patient.address ? 'complete' : 'partial';
}
