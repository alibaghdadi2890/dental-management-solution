import { z } from 'zod';
import { emailSchema } from './auth.js';
import {
  blankToUndefined,
  idSchema,
  isoDateSchema,
  isoDateTimeSchema,
  nameSchema,
  offsetPageSchema,
  optionalDate,
  optionalText,
} from './common.js';
import { reasonSchema } from './audit.js';
import { AGE_BANDS } from './patient-age.js';

/**
 * `patients` (feature 3): patient records, the palette, the list and its filters, and merge.
 * Calendar/age arithmetic lives in `patient-age.ts`. No I/O, no time-zone math here either — every
 * date is an ISO `YYYY-MM-DD` string and every "today" is passed in by the caller, already
 * resolved to the tenant's time zone (CLAUDE.md §5).
 */

export const PATIENT_SEXES = ['female', 'male', 'other', 'unknown'] as const;
export const patientSexSchema = z.enum(PATIENT_SEXES);
export type PatientSex = z.infer<typeof patientSexSchema>;

const MEDICAL_ALERTS_MAX = 20;

/**
 * De-dupes case- and normalization-insensitively (NFKC folds compatibility forms — full-width,
 * ligatures — as well as composed/decomposed accents; e.g. "Café" typed as `e` + combining acute
 * (NFD) collapses with "Café" typed as the single precomposed `é` (NFC)), keeping the first
 * occurrence. The stored value itself is only normalized to NFC (canonical composition) — the
 * text isn't rewritten more than necessary to make it comparable.
 */
function dedupeAlerts(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const stored = value.normalize('NFC');
    const key = stored.normalize('NFKC').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(stored);
  }
  return result;
}

/** Trimmed, 1–60 chars each, de-duplicated (see `dedupeAlerts`, first occurrence wins), max 20. */
export const medicalAlertsSchema = z
  .array(z.string().trim().min(1).max(60))
  .transform(dedupeAlerts)
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

/** No patient can plausibly have been born before this; also keeps display formatting sane. */
const DATE_OF_BIRTH_FLOOR = '1900-01-01';

/** Blank/`null`/absent → `null` (so `PATCH { dateOfBirth: null }` clears it); 1900–tomorrow. */
const dateOfBirthSchema = optionalDate('Date of birth cannot be in the future').refine(
  (date) => date === null || date >= DATE_OF_BIRTH_FLOOR,
  'Date of birth is not plausible',
);

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
  dateOfBirth: dateOfBirthSchema,
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
 * Parsed from a URL query string, so a cleared filter (`?dentist=`) must behave like an absent
 * one rather than a 400 — every field but `q` (already blank-tolerant) goes through
 * `blankToUndefined`, wrapping the field's own default/optional (design Q6/Q7). `view=owing` and
 * `sort=balance` are only answered by the `billing` route (`GET /billing/patients`); `GET
 * /patients` rejects them with 400 (design Q5).
 */
export const patientListQuerySchema = z.object({
  view: blankToUndefined(patientViewSchema.default('active')),
  q: z
    .string()
    .trim()
    .max(100)
    .nullish()
    .transform((value) => (value ? value : undefined)),
  dentist: blankToUndefined(z.union([idSchema, z.literal('none')]).optional()),
  age: blankToUndefined(z.enum(AGE_BANDS).optional()),
  alerts: blankToUndefined(z.enum(['yes', 'no']).optional()),
  lastVisit: blankToUndefined(z.enum(['any', 'never']).optional()),
  sort: blankToUndefined(patientSortSchema.default('name')),
  dir: blankToUndefined(z.enum(['asc', 'desc']).default('asc')),
  page: blankToUndefined(z.coerce.number().int().min(1).default(1)),
  size: blankToUndefined(z.coerce.number().pipe(patientPageSizeSchema).default(25)),
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
  excludeId: blankToUndefined(idSchema.optional()),
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

/** `complete` only when both email and address are recorded (README §Patient information). */
export function profileCompleteness(patient: {
  email: string | null;
  address: string | null;
}): 'complete' | 'partial' {
  return patient.email && patient.address ? 'complete' : 'partial';
}
