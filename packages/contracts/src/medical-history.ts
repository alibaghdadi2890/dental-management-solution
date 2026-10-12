import { z } from 'zod';
import { idSchema, optionalText } from './common.js';

/**
 * A patient's medical history (feature 10, ADR-0046; owned by `patients`): allergies and
 * conditions picked from two lists the clinic edits in the Catalog, and a medication line. For
 * each list "none" is an explicit answer, distinct from "not asked" (no items and no flag).
 */

export const MEDICAL_OPTION_KINDS = ['allergy', 'condition'] as const;
export const medicalOptionKindSchema = z.enum(MEDICAL_OPTION_KINDS);
export type MedicalOptionKind = z.infer<typeof medicalOptionKindSchema>;

const OPTION_NAME_MAX = 60;
/** One patient rarely has more than a handful; the cap keeps a request bounded. */
export const MEDICAL_ITEMS_MAX = 30;
const MEDICATION_MAX = 500;

/** A row of a clinic's allergy or condition list. */
export const medicalOptionSchema = z.object({
  id: idSchema,
  kind: medicalOptionKindSchema,
  name: z.string(),
  /** An inactive option stays on the patients who have it and leaves the pickers. */
  active: z.boolean(),
});
export type MedicalOption = z.infer<typeof medicalOptionSchema>;

/** A row of a batch save: the whole row, `id` absent for a new one. */
export const medicalOptionInputSchema = z.object({
  id: idSchema.optional(),
  kind: medicalOptionKindSchema,
  name: z.string().trim().min(1).max(OPTION_NAME_MAX),
  active: z.boolean().default(true),
});
export type MedicalOptionInput = z.infer<typeof medicalOptionInputSchema>;

/**
 * `POST /medical-history/options`: an allergy or condition typed into a patient's history. The
 * name is looked up without case in its list, and added to it when it is new.
 */
export const medicalOptionAddSchema = medicalOptionInputSchema.pick({ kind: true, name: true });
export type MedicalOptionAdd = z.infer<typeof medicalOptionAddSchema>;

/** Names compare without case or surrounding space, as the unique index does. */
export const medicalOptionKey = (option: { kind: MedicalOptionKind; name: string }): string =>
  `${option.kind}:${option.name.trim().toLowerCase()}`;

/** `PUT /medical-history/options`: rows to create or update; a name is unique within its list. */
export const medicalOptionBatchSchema = z.object({
  items: z
    .array(medicalOptionInputSchema)
    .min(1)
    .max(200)
    .superRefine((items, context) => {
      const ids = new Set<string>();
      const names = new Set<string>();
      items.forEach((row, index) => {
        if (row.id !== undefined) {
          if (ids.has(row.id)) {
            context.addIssue({ code: 'custom', path: [index, 'id'], message: 'Sent twice' });
          }
          ids.add(row.id);
        }
        const key = medicalOptionKey(row);
        if (names.has(key)) {
          context.addIssue({
            code: 'custom',
            path: [index, 'name'],
            message: 'Already in this list',
          });
        }
        names.add(key);
      });
    }),
});
export type MedicalOptionBatch = z.infer<typeof medicalOptionBatchSchema>;

/** `POST /medical-history/options/seed-default`: how many rows it created (0 once lists exist). */
export const medicalOptionSeedResultSchema = z.object({ created: z.number().int().nonnegative() });
export type MedicalOptionSeedResult = z.infer<typeof medicalOptionSeedResultSchema>;

const medicalItemSchema = z.object({ id: idSchema, name: z.string() });
export type MedicalItem = z.infer<typeof medicalItemSchema>;

/** A patient's history as the API answers it; items carry their current name. */
export const medicalHistorySchema = z.object({
  /** "None known": asked, and there are none. Never true together with `allergies`. */
  noKnownAllergies: z.boolean(),
  allergies: z.array(medicalItemSchema),
  /** "None": asked, and there are none. Never true together with `conditions`. */
  noConditions: z.boolean(),
  conditions: z.array(medicalItemSchema),
  medication: z.string().nullable(),
});
export type MedicalHistory = z.infer<typeof medicalHistorySchema>;

export const EMPTY_MEDICAL_HISTORY: MedicalHistory = {
  noKnownAllergies: false,
  allergies: [],
  noConditions: false,
  conditions: [],
  medication: null,
};

const optionIdsSchema = z
  .array(idSchema)
  .max(MEDICAL_ITEMS_MAX)
  .refine((ids) => new Set(ids).size === ids.length, 'The same item is listed twice');

/** A patient's history as sent: the whole history, option ids for the items. */
export const medicalHistoryInputSchema = z
  .object({
    noKnownAllergies: z.boolean().default(false),
    allergyIds: optionIdsSchema.default([]),
    noConditions: z.boolean().default(false),
    conditionIds: optionIdsSchema.default([]),
    medication: optionalText(MEDICATION_MAX),
  })
  .superRefine((history, context) => {
    if (history.noKnownAllergies && history.allergyIds.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['noKnownAllergies'],
        message: '"None known" cannot be combined with allergies',
      });
    }
    if (history.noConditions && history.conditionIds.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['noConditions'],
        message: '"None" cannot be combined with conditions',
      });
    }
  });
export type MedicalHistoryInput = z.infer<typeof medicalHistoryInputSchema>;

/** The history as an input again: what an edit form starts from. */
export function toMedicalHistoryInput(history: MedicalHistory): MedicalHistoryInput {
  return {
    noKnownAllergies: history.noKnownAllergies,
    allergyIds: history.allergies.map((item) => item.id),
    noConditions: history.noConditions,
    conditionIds: history.conditions.map((item) => item.id),
    medication: history.medication,
  };
}

/** Whether anyone has answered either list or the medication line. */
export function isHistoryAsked(history: MedicalHistory): boolean {
  return (
    history.noKnownAllergies ||
    history.noConditions ||
    history.allergies.length > 0 ||
    history.conditions.length > 0 ||
    history.medication !== null
  );
}
