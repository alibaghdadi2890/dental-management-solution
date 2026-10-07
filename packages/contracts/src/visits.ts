import { z } from 'zod';
import { nonNegativeAmountSchema, chargeUnitSchema, jawSchema } from './catalog.js';
import {
  aggregateAmountSchema,
  blankToUndefined,
  commaSeparatedIds,
  currencySchema,
  idSchema,
  isoDateSchema,
  isoDateTimeSchema,
  moneySchema,
  queryBooleanSchema,
} from './common.js';
import { surfacesSchema, toothCodeSchema, toothPresenceChangeSchema } from './tooth.js';
import { DISCOUNT_MODES } from './visit-money.js';

/**
 * `clinical`'s live visit (feature 4a, spec §Data model / §Backend — clinical): lifecycle,
 * services and money. The money arithmetic itself (subtotal/discount/total, duration) is
 * `visit-money.ts`, shared verbatim with the SPA's live preview; these are the request/response
 * shapes around it. `clinical-records.ts` has the charting schemas (diagnoses, plans, chart).
 */

export const VISIT_STATUSES = [
  'in_progress',
  'paused',
  'completed',
  'discarded',
  'amended',
  'voided',
] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];
export const visitStatusSchema = z.enum(VISIT_STATUSES);

/**
 * The statuses that count as a visit the patient had (feature 4b, D18): completed, possibly
 * amended since. A voided visit stays in the history but counts nowhere — not in Last visit, the
 * visit count, the billed sums or the treatment summary.
 */
export const COUNTED_VISIT_STATUSES = ['completed', 'amended'] as const satisfies VisitStatus[];

const VISIT_NUMBER_PAD = 6;

/** `V-` + the per-tenant visit counter, zero-padded to at least 6 digits (`V-000123`), like
 * patient numbers. Pure. */
export function formatVisitNumber(value: number): string {
  return `V-${String(value).padStart(VISIT_NUMBER_PAD, '0')}`;
}

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
  /** Set iff `chargeUnit` is `per_jaw`. */
  jaw: jawSchema.nullable(),
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
  /** The per-tenant visit counter value, minted at start; shown as `formatVisitNumber`. */
  displayNumber: z.number().int().positive(),
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
  /** The auth user id who completed it (W10); the workspace tells others it was done elsewhere. */
  completedBy: idSchema.nullable(),
  /** When the visit answered which unfinished services it continues (unfinished spec U5). */
  unfinishedAnsweredAt: isoDateTimeSchema.nullable(),
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
  voidedAt: isoDateTimeSchema.nullable(),
  voidReason: z.string().nullable(),
  /** Amend and void send it back as `expectedUpdatedAt` (D8): a stale one is refused. */
  updatedAt: isoDateTimeSchema,
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
  jaw: jawSchema.optional(),
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

/** What every route that changes a visit answers with (spec §HTTP), so the client replaces its
 * cached visit without a refetch: pause, resume, discard, complete, notes and discount. */
export const visitResultSchema = z.object({ visit: visitSchema });
export type VisitResult = z.infer<typeof visitResultSchema>;

/** The service routes (add, price edit, remove): the updated visit plus the service itself, so
 * an Undo after an add has the new service's id. */
export const serviceResultSchema = z.object({
  visit: visitSchema,
  record: visitServiceSchema,
  /** The tooth's new presence, when recording or removing the service changed it (H2). */
  presenceChange: toothPresenceChangeSchema.nullable().optional(),
});
export type ServiceResult = z.infer<typeof serviceResultSchema>;

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
  /** So the pill can run the timer from an offset, like `Visit.serverNow`. */
  serverNow: isoDateTimeSchema,
});
export type LiveVisitRef = z.infer<typeof liveVisitRefSchema>;

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

/** How many ids one lookup takes (`GET /visits/numbers`). */
const MAX_NUMBER_IDS = 100;

/** `GET /visits/numbers?ids=`: the display numbers of these visits (the Activity screen). */
export const visitNumbersQuerySchema = z.object({ ids: commaSeparatedIds(MAX_NUMBER_IDS) });
export type VisitNumbersQuery = z.infer<typeof visitNumbersQuerySchema>;

export const visitNumberSchema = z.object({
  visitId: idSchema,
  displayNumber: z.number().int().positive(),
  localDate: isoDateSchema,
});
export type VisitNumber = z.infer<typeof visitNumberSchema>;
