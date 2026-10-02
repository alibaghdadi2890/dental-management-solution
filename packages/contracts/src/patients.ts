import { z } from 'zod';
import { optionalEmailSchema } from './auth.js';
import { reasonSchema } from './audit.js';
import {
  blankToUndefined,
  displayNumberSchema,
  idSchema,
  isoDateSchema,
  isoDateTimeSchema,
  nameSchema,
  offsetPageSchema,
  optionalDate,
  optionalText,
} from './common.js';
import { contactLinkInputSchema, matchedContactSchema, primaryGuardianSchema } from './contacts.js';
import { AGE_BANDS, dentitionStageSchema } from './patient-age.js';

/**
 * `patients` (feature 3): patient records, the palette, the list and its filters, and merge.
 * Calendar/age arithmetic lives in `patient-age.ts`. No I/O, no time-zone math here either — every
 * date is an ISO `YYYY-MM-DD` string and every "today" is passed in by the caller, already
 * resolved to the tenant's time zone (CLAUDE.md §5).
 */

export const PATIENT_SEXES = ['female', 'male', 'other', 'unknown'] as const;
export const patientSexSchema = z.enum(PATIENT_SEXES);
export type PatientSex = z.infer<typeof patientSexSchema>;

/** Also the merge patch's overflow threshold (`MergeAlertsOverflowError`, `domain/merge.ts`). */
export const MEDICAL_ALERTS_MAX = 20;

/**
 * De-dupes case- and normalization-insensitively (NFKC folds compatibility forms — full-width,
 * ligatures — as well as composed/decomposed accents; e.g. "Café" typed as `e` + combining acute
 * (NFD) collapses with "Café" typed as the single precomposed `é` (NFC)), keeping the first
 * occurrence. Values have already been normalized to NFC (canonical composition) by
 * `medicalAlertItemSchema` — the text isn't rewritten more than necessary to make it comparable.
 * Exported so `domain/merge.ts` (patient merge's alert union) reuses this exact semantics instead
 * of a copy.
 */
export function dedupeAlerts(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.normalize('NFKC').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

/**
 * Normalizes to NFC *before* trimming/length-checking: a decomposed string (each accent typed as
 * a separate combining mark) is longer in UTF-16 code units than its composed form, so checking
 * the length first could reject an alert the user would see as exactly 60 characters.
 */
const medicalAlertItemSchema = z
  .string()
  .transform((value) => value.normalize('NFC').trim())
  .pipe(z.string().min(1).max(60));

/** Normalized, trimmed, 1–60 chars each, de-duplicated (see `dedupeAlerts`), max 20. */
export const medicalAlertsSchema = z
  .array(medicalAlertItemSchema)
  .transform(dedupeAlerts)
  .pipe(z.array(z.string()).max(MEDICAL_ALERTS_MAX));

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
  /**
   * Raw text as typed; the server normalises it against the tenant's country (`phone.ts`). Blank
   * → null: the phone is required for adults only, a rule the server enforces against the tenant's
   * time zone (design addendum C3), so the schema alone cannot decide it.
   */
  phone: optionalText(40),
  dateOfBirth: dateOfBirthSchema,
  sex: patientSexSchema,
  email: optionalEmailSchema,
  address: optionalText(240),
  insurance: optionalText(120),
  medicalAlerts: medicalAlertsSchema,
  /** A staff profile id (`staff_profiles.id`, ADR-0020), never an auth user id. */
  primaryDentistId: primaryDentistIdSchema,
  notes: optionalText(2000),
  // No `externalId`: it is the import key, set only by the import (feature 6), never by an edit.
};

export const patientInputSchema = z.object({
  ...patientFields,
  sex: patientSexSchema.default('unknown'),
  medicalAlerts: medicalAlertsSchema.default([]),
});
export type PatientInput = z.infer<typeof patientInputSchema>;

/** At most this many contacts are linked by one create (addendum C4). */
export const PATIENT_CREATE_CONTACTS_MAX = 10;

/**
 * Creating a patient (addendum C4): the fields, plus contacts linked in the same transaction, plus
 * `linkContactId` — an existing *unlinked* contact who becomes this patient ("the mother becomes
 * a patient"). The same contact or patient may not be targeted twice.
 */
export const patientCreateSchema = patientInputSchema
  .extend({
    contacts: z.array(contactLinkInputSchema).max(PATIENT_CREATE_CONTACTS_MAX).default([]),
    linkContactId: idSchema.optional(),
  })
  .superRefine((input, context) => {
    const seen = new Set<string>();
    input.contacts.forEach((link, index) => {
      const target = link.target;
      const key =
        'contactId' in target
          ? `contact:${target.contactId}`
          : 'patientId' in target
            ? `patient:${target.patientId}`
            : undefined;
      if (key === undefined) return;
      if (seen.has(key)) {
        context.addIssue({
          code: 'custom',
          message: 'The same contact is linked twice',
          path: ['contacts', index, 'target'],
        });
      }
      seen.add(key);
    });
    if (input.linkContactId !== undefined && seen.has(`contact:${input.linkContactId}`)) {
      context.addIssue({
        code: 'custom',
        message: 'A patient is never their own contact',
        path: ['linkContactId'],
      });
    }
  });
export type PatientCreate = z.infer<typeof patientCreateSchema>;
/** What a client sends (defaults such as `contacts: []` may be left out). */
export type PatientCreateInput = z.input<typeof patientCreateSchema>;

export const patientPatchSchema = z
  .object(patientFields)
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Change at least one field' });
export type PatientPatch = z.infer<typeof patientPatchSchema>;

/**
 * The full record (`GET /patients/:id`). Age is derived, never stored. `dentitionOverride` is the
 * one stored override of the chart's otherwise age-derived dentition stage (spec W14); `null`
 * means "auto" (`effectiveDentition` in `@dcm/contracts` `tooth.ts` resolves it against age).
 */
export const patientSchema = z.object({
  id: idSchema,
  displayNumber: displayNumberSchema,
  fullName: z.string(),
  /** E.164, as stored; null only for a minor recorded without one (addendum C3). */
  phone: z.string().nullable(),
  dateOfBirth: isoDateSchema.nullable(),
  sex: patientSexSchema,
  email: z.string().nullable(),
  address: z.string().nullable(),
  insurance: z.string().nullable(),
  medicalAlerts: z.array(z.string()),
  primaryDentistId: idSchema.nullable(),
  notes: z.string().nullable(),
  dentitionOverride: dentitionStageSchema.nullable(),
  /** The import key (feature 6); read-only here, null for records not imported. */
  externalId: z.string().nullable(),
  archivedAt: isoDateTimeSchema.nullable(),
  mergedIntoId: idSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Patient = z.infer<typeof patientSchema>;

/**
 * `PUT /patients/:id/dentition` (spec W14): sets or clears the chart's dentition override. Set
 * from the workspace's chart card header only, so it needs `visit:write`, not `patient:write`
 * (`PatientsService.setDentition`).
 */
export const dentitionOverrideSchema = z.object({ override: dentitionStageSchema.nullable() });
export type DentitionOverride = z.infer<typeof dentitionOverrideSchema>;

/**
 * The list/palette columns (README §Patients, §App shell), plus (addendum C7) the resolved primary
 * guardian, and `matchedContact` when a search `q` matched this patient only through a contact's
 * phone (null otherwise, and always null outside a search).
 */
export const patientListItemSchema = patientSchema
  .pick({
    id: true,
    displayNumber: true,
    fullName: true,
    phone: true,
    dateOfBirth: true,
    sex: true,
    medicalAlerts: true,
    primaryDentistId: true,
    email: true,
    archivedAt: true,
    updatedAt: true,
  })
  .extend({
    primaryGuardian: primaryGuardianSchema.nullable(),
    matchedContact: matchedContactSchema.nullable(),
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
  /** A staff profile id (ADR-0020), or `none` for patients without a primary dentist. */
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

/** The *Not seen* chip comes from `clinical` (`GET /clinical/patients/not-seen/count`, 4b). */
export const patientCountsSchema = z.object({
  active: z.number().int().nonnegative(),
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

/** The pickable fields of a merge. */
export const MERGE_FIELDS = [
  'fullName',
  'phone',
  'dateOfBirth',
  'sex',
  'email',
  'address',
  'insurance',
  'primaryDentistId',
  'notes',
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

/**
 * `complete` when email and address are recorded (README §Patient information) and, for a minor,
 * a guardian too (design addendum C10). `minor` is the caller's: `isMinor` on the date of birth
 * against the tenant's today (no date of birth is an adult); `hasGuardian` is whether any of the
 * patient's contacts holds the guardian role.
 */
export function profileCompleteness(patient: {
  email: string | null;
  address: string | null;
  minor: boolean;
  hasGuardian: boolean;
}): 'complete' | 'partial' {
  const reachable = Boolean(patient.email) && Boolean(patient.address);
  return reachable && (!patient.minor || patient.hasGuardian) ? 'complete' : 'partial';
}
