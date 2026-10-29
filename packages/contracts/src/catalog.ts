import { z } from 'zod';
import { decimalAmountSchema, idSchema, moneySchema, nameSchema, optionalText } from './common.js';
import { markColorSchema, markIconSchema, markPrioritySchema } from './marks.js';
import { entryVisitTypeSchema } from './visit-flow.js';

/**
 * The per-tenant service and diagnosis catalogs (`clinical`, ADR-0002): what a clinic charges for
 * and what its dentists record. Both are edited in batches from the Catalog screen.
 */
export const CATALOG_KINDS = ['service', 'diagnosis'] as const;
export const catalogKindSchema = z.enum(CATALOG_KINDS);
export type CatalogKind = z.infer<typeof catalogKindSchema>;

/**
 * The level a service is performed and charged at: each tooth, one jaw, or the whole mouth. The
 * catalog sets it; a record's target follows it (a tooth, a `Jaw`, or neither).
 */
export const CHARGE_UNITS = ['per_tooth', 'per_jaw', 'per_mouth'] as const;
export const chargeUnitSchema = z.enum(CHARGE_UNITS);
export type ChargeUnit = z.infer<typeof chargeUnitSchema>;

/** The target of a `per_jaw` service or plan; both jaws are two records. */
export const JAWS = ['upper', 'lower'] as const;
export const jawSchema = z.enum(JAWS);
export type Jaw = z.infer<typeof jawSchema>;

/** Codes are upper-case (the POC upper-cases while typing) and unique per tenant and catalog. */
export const catalogCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, 'Letters, digits and . _ / - only')
  .transform((code) => code.toUpperCase());

/** Free text a tenant extends; the Catalog filter pills are the distinct values. Blank = none. */
export const catalogCategorySchema = optionalText(40);

/** A price as sent by the client: a decimal amount ≥ 0; the server adds the tenant currency. */
export const nonNegativeAmountSchema = decimalAmountSchema.refine(
  (amount) => !amount.startsWith('-'),
  'Must not be negative',
);

/**
 * What performing a per-tooth service does to the tooth's presence on the chart (feature 7, H2):
 * nothing, it takes the tooth out (`removes`: extractions), or it puts an implant there
 * (`implant`: implant placement). Always `none` for a service that is not per tooth.
 */
export const TOOTH_EFFECTS = ['none', 'removes', 'implant'] as const;
export const toothEffectSchema = z.enum(TOOTH_EFFECTS);
export type ToothEffect = z.infer<typeof toothEffectSchema>;

/** How many sessions a service usually takes, when more than one ("session 2 of 3"). */
export const typicalSessionsSchema = z.number().int().min(2).max(20);

export const serviceItemSchema = z.object({
  id: idSchema,
  code: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  chargeUnit: chargeUnitSchema,
  price: moneySchema,
  /** Listed under "Frequently used" at the top of the visit drawer. */
  frequent: z.boolean(),
  active: z.boolean(),
  toothEffect: toothEffectSchema,
  /** The chart mark (feature 9): a per-tooth service has a colour, an icon or both, never neither
   * (ADR-0054). Any other has none, unless it was a per-tooth service once: it keeps its mark for
   * the records made then. */
  color: markColorSchema.nullable(),
  icon: markIconSchema.nullable(),
  markPriority: markPrioritySchema,
  /** "Added on": a visit of this type starts with this service in Today's services, at its
   * catalog price (feature 10, ADR-0047). Only a service charged per mouth can be. */
  addedOnVisitType: entryVisitTypeSchema.nullable(),
  /** Null for work done in one sitting. */
  typicalSessions: typicalSessionsSchema.nullable(),
});
export type ServiceItem = z.infer<typeof serviceItemSchema>;

export const diagnosisItemSchema = z.object({
  id: idSchema,
  code: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  frequent: z.boolean(),
  active: z.boolean(),
  /** Where it is recorded (ADR-0064): a tooth, a jaw or the whole mouth, as services are charged. */
  level: chargeUnitSchema,
  /** The chart mark (feature 9). Every diagnosis has a colour; only a tooth's is painted. */
  color: markColorSchema,
  markPriority: markPrioritySchema,
});
export type DiagnosisItem = z.infer<typeof diagnosisItemSchema>;

/**
 * The chart mark of a row being saved. All optional: a new row without a colour gets the least
 * used one of its catalog, and a saved row keeps what it has. A service's `color: null` is no
 * colour, which needs an icon (ADR-0054); a diagnosis's is the same as not sending one. For a
 * service that is not charged per tooth what is sent is ignored.
 */
const markInput = {
  color: markColorSchema.nullable().optional(),
  markPriority: markPrioritySchema.optional(),
};

/** A row of a batch save: the whole row, `id` absent for a new one. */
export const serviceItemInputSchema = z
  .object({
    id: idSchema.optional(),
    code: catalogCodeSchema,
    name: nameSchema,
    category: catalogCategorySchema,
    chargeUnit: chargeUnitSchema,
    price: nonNegativeAmountSchema,
    frequent: z.boolean().default(false),
    active: z.boolean().default(true),
    toothEffect: toothEffectSchema.default('none'),
    ...markInput,
    icon: markIconSchema.nullable().optional(),
    addedOnVisitType: entryVisitTypeSchema.nullish().transform((type) => type ?? null),
    typicalSessions: typicalSessionsSchema.nullish().transform((count) => count ?? null),
  })
  .superRefine((row, context) => {
    if (row.addedOnVisitType !== null && row.chargeUnit !== 'per_mouth') {
      context.addIssue({
        code: 'custom',
        path: ['addedOnVisitType'],
        message: 'Only a service charged per mouth can be added to a visit by itself',
      });
    }
    if (row.toothEffect !== 'none' && row.chargeUnit !== 'per_tooth') {
      context.addIssue({
        code: 'custom',
        path: ['toothEffect'],
        message: 'Only a service charged per tooth can change a tooth',
      });
    }
    if (row.chargeUnit === 'per_tooth' && row.color === null && row.icon === null) {
      context.addIssue({
        code: 'custom',
        path: ['color'],
        message: 'A service on a tooth needs a colour or an icon',
      });
    }
  });
export type ServiceItemInput = z.infer<typeof serviceItemInputSchema>;

export const diagnosisItemInputSchema = z.object({
  id: idSchema.optional(),
  code: catalogCodeSchema,
  name: nameSchema,
  category: catalogCategorySchema,
  level: chargeUnitSchema.default('per_tooth'),
  frequent: z.boolean().default(false),
  active: z.boolean().default(true),
  ...markInput,
});
export type DiagnosisItemInput = z.infer<typeof diagnosisItemInputSchema>;

function batchOf<TItem extends z.ZodType<{ id?: string | undefined }>>(item: TItem) {
  return z.object({
    items: z
      .array(item)
      .min(1)
      .max(500)
      .superRefine((items, context) => {
        const seen = new Set<string>();
        items.forEach((row, index) => {
          if (row.id === undefined) return;
          if (seen.has(row.id)) {
            context.addIssue({
              code: 'custom',
              path: [index, 'id'],
              message: 'The same row is sent twice',
            });
          }
          seen.add(row.id);
        });
      }),
  });
}

/** The Catalog save bar: every new or changed row of one catalog, applied in one transaction. */
export const serviceBatchSchema = batchOf(serviceItemInputSchema);
export type ServiceBatch = z.infer<typeof serviceBatchSchema>;

export const diagnosisBatchSchema = batchOf(diagnosisItemInputSchema);
export type DiagnosisBatch = z.infer<typeof diagnosisBatchSchema>;

/** Rows created by seeding the default catalog; both 0 when the tenant already had a catalog. */
export const catalogSeedResultSchema = z.object({
  services: z.number().int().nonnegative(),
  diagnoses: z.number().int().nonnegative(),
});
export type CatalogSeedResult = z.infer<typeof catalogSeedResultSchema>;
