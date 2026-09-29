import { z } from 'zod';
import { nonNegativeAmountSchema, chargeUnitSchema } from './catalog.js';
import {
  aggregateAmountSchema,
  blankToUndefined,
  currencySchema,
  idSchema,
  isoDateSchema,
  isoDateTimeSchema,
  moneySchema,
} from './common.js';
import { surfacesSchema, toothCodeSchema } from './tooth.js';
import { DISCOUNT_MODES } from './visit-money.js';

/**
 * `clinical`'s live visit (feature 4a, spec §Data model / §Backend — clinical): lifecycle,
 * services and money. The money arithmetic itself (subtotal/discount/total, duration) is
 * `visit-money.ts`, shared verbatim with the SPA's live preview; these are the request/response
 * shapes around it. `clinical-records.ts` has the charting schemas (diagnoses, plans, chart).
 */

export const VISIT_STATUSES = ['in_progress', 'paused', 'completed', 'discarded'] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];
export const visitStatusSchema = z.enum(VISIT_STATUSES);

/** Same values as `DiscountMode` (`visit-money.ts`); the schema lives here with the rest of the
 * visit request/response shapes. */
export const discountModeSchema = z.enum(DISCOUNT_MODES);

const VISIT_NOTES_MAX = 20000;

export const visitServiceSchema = z.object({
  id: idSchema,
  procedureId: idSchema,
  /** Snapshot of the catalog item at add-time (CLAUDE.md §7); later catalog edits never change a
   * recorded service. */
  code: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  chargeUnit: chargeUnitSchema,
  /** Set iff `chargeUnit` is `per_tooth`. */
  toothCode: toothCodeSchema.nullable(),
  surfaces: surfacesSchema,
  base: moneySchema,
  discount: moneySchema,
  final: moneySchema,
  /** Set when this service was created by performing a treatment plan. */
  planId: idSchema.nullable(),
  /** The auth user id who recorded it (CLAUDE.md §6/§10 — never the dentist). */
  recordedBy: idSchema,
  createdAt: isoDateTimeSchema,
});
export type VisitService = z.infer<typeof visitServiceSchema>;

export const visitSchema = z.object({
  id: idSchema,
  patientId: idSchema,
  branchId: idSchema,
  roomId: idSchema.nullable(),
  /** A staff profile id (ADR-0020), never the auth user id. */
  dentistId: idSchema,
  /** The auth user id who started the visit. */
  startedBy: idSchema,
  status: visitStatusSchema,
  /** The tenant's local date at start (CLAUDE.md §5). */
  localDate: isoDateSchema,
  startedAt: isoDateTimeSchema,
  pausedAt: isoDateTimeSchema.nullable(),
  pausedSeconds: z.number().int().nonnegative(),
  completedAt: isoDateTimeSchema.nullable(),
  /** Set only once the visit is completed. */
  durationMinutes: z.number().int().positive().nullable(),
  notes: z.string(),
  discountMode: discountModeSchema,
  /** The raw entry (spec V7 invariant 2), not the computed discount amount — that's `money`. */
  discountValue: nonNegativeAmountSchema,
  currency: currencySchema,
  services: z.array(visitServiceSchema),
  money: z.object({
    subtotal: aggregateAmountSchema,
    discount: aggregateAmountSchema,
    total: aggregateAmountSchema,
    capped: z.boolean(),
  }),
  /** So the client can render the timer from an offset instead of trusting its own clock. */
  serverNow: isoDateTimeSchema,
});
export type Visit = z.infer<typeof visitSchema>;

export const startVisitSchema = z.object({
  patientId: idSchema,
  dentistId: idSchema,
  roomId: idSchema.optional(),
});
export type StartVisitInput = z.infer<typeof startVisitSchema>;

export const visitNotesSchema = z.object({
  notes: z.string().max(VISIT_NOTES_MAX),
});
export type VisitNotesInput = z.infer<typeof visitNotesSchema>;

export const visitDiscountSchema = z.object({
  mode: discountModeSchema,
  value: nonNegativeAmountSchema,
});
export type VisitDiscountInput = z.infer<typeof visitDiscountSchema>;

export const addServiceSchema = z.object({
  procedureId: idSchema,
  toothCode: toothCodeSchema.optional(),
  surfaces: surfacesSchema.default([]),
});
export type AddServiceInput = z.infer<typeof addServiceSchema>;

export const updateServiceSchema = z
  .object({
    baseAmount: nonNegativeAmountSchema.optional(),
    discountAmount: nonNegativeAmountSchema.optional(),
  })
  .refine((patch) => patch.baseAmount !== undefined || patch.discountAmount !== undefined, {
    message: 'Change at least one field',
  });
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;

export const startVisitResultSchema = z.object({
  visit: visitSchema,
  resumed: z.boolean(),
});
export type StartVisitResult = z.infer<typeof startVisitResultSchema>;

/** The header pill / start popover's "resume" reference: enough to render without fetching the
 * full `Visit`. */
export const liveVisitRefSchema = z.object({
  id: idSchema,
  patientId: idSchema,
  patientName: z.string(),
  dentistName: z.string(),
  status: visitStatusSchema,
  startedAt: isoDateTimeSchema,
  pausedAt: isoDateTimeSchema.nullable(),
  pausedSeconds: z.number().int().nonnegative(),
});
export type LiveVisitRef = z.infer<typeof liveVisitRefSchema>;

/** Query-string booleans arrive as text; blank/absent means "not set" (mirrors `blankToUndefined`
 * elsewhere in this package). */
const queryBooleanSchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

export const liveVisitQuerySchema = z.object({
  patientId: blankToUndefined(idSchema.optional()),
  mine: blankToUndefined(queryBooleanSchema),
});
export type LiveVisitQuery = z.infer<typeof liveVisitQuerySchema>;

/** `GET /visits/start-defaults`: the popover's defaults (spec V3) — `null` when there is none to
 * default to (e.g. no branch dentist, no active room). */
export const startDefaultsSchema = z.object({
  dentistId: idSchema.nullable(),
  roomId: idSchema.nullable(),
});
export type StartDefaults = z.infer<typeof startDefaultsSchema>;
