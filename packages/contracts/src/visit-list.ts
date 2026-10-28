import { z } from 'zod';
import { reasonSchema } from './audit.js';
import { chargeUnitSchema, jawSchema, nonNegativeAmountSchema } from './catalog.js';
import {
  aggregateAmountSchema,
  blankToUndefined,
  commaSeparatedIds,
  currencySchema,
  cursorPageQuerySchema,
  cursorPageSchema,
  displayNumberSchema,
  idSchema,
  isoDateSchema,
  isoDateTimeSchema,
  moneySchema,
} from './common.js';
import { surfacesSchema, toothCodeSchema } from './tooth.js';
import { visitStepSchema, visitTypeSchema } from './visit-flow.js';
import { discountModeSchema, visitStatusSchema } from './visits.js';

/**
 * Feature 4b (spec `2026-10-01-visits-list-amend-void-design.md`): the clinic-wide visits list,
 * its summary, amend and void, and the per-patient visit stats. `visits.ts` has the live visit.
 */

/**
 * `all` = live + completed + amended + voided; `in_progress` includes paused; `history` (a
 * patient's record tab) = completed + amended + voided. Discarded visits never appear. The
 * *Unpaid* tab is `billing`'s route, not a value here.
 */
export const VISIT_LIST_TABS = ['all', 'in_progress', 'voided_amended', 'history'] as const;
export const visitListTabSchema = z.enum(VISIT_LIST_TABS);
export type VisitListTab = z.infer<typeof visitListTabSchema>;

/** On the visit's tenant-local date, counted back from the tenant's today (`today` = 1 day). */
export const VISIT_RANGES = ['today', '7d', '30d', '90d', '12m', 'all'] as const;
export const visitRangeSchema = z.enum(VISIT_RANGES);
export type VisitRange = z.infer<typeof visitRangeSchema>;

/** The filters shared by the list, its summary, the Unpaid routes and the export. */
export const visitFiltersSchema = z.object({
  tab: blankToUndefined(visitListTabSchema.default('all')),
  range: blankToUndefined(visitRangeSchema.default('90d')),
  /** A staff profile id (ADR-0020). */
  dentistId: blankToUndefined(idSchema.optional()),
  roomId: blankToUndefined(idSchema.optional()),
  type: blankToUndefined(visitTypeSchema.optional()),
  /** A visit number (`V-123` or `123`), a service code or name, or a patient (name, number, phone). */
  q: z
    .string()
    .trim()
    .max(100)
    .nullish()
    .transform((value) => (value ? value : undefined)),
  /** One patient's visits across every branch (the record's history tab); without it the list
   * is the session branch's. */
  patientId: blankToUndefined(idSchema.optional()),
});
export type VisitFilters = z.infer<typeof visitFiltersSchema>;

export const visitListQuerySchema = visitFiltersSchema.extend(cursorPageQuerySchema.shape);
export type VisitListQuery = z.infer<typeof visitListQuerySchema>;

export const visitListServiceSchema = z.object({
  id: idSchema,
  code: z.string(),
  name: z.string(),
  chargeUnit: chargeUnitSchema,
  toothCode: toothCodeSchema.nullable(),
  jaw: jawSchema.nullable(),
  surfaces: surfacesSchema,
  /** Set when the service performed a treatment plan: amend can remove it but not re-tooth it. */
  planId: idSchema.nullable(),
  /** Null when the caller may not see the visit's money (ADR-0055). */
  final: moneySchema.nullable(),
});
export type VisitListService = z.infer<typeof visitListServiceSchema>;

/** One row of the visits list, with everything the detail panel and the history tab show. */
export const visitListItemSchema = z.object({
  id: idSchema,
  displayNumber: z.number().int().positive(),
  type: visitTypeSchema,
  /** The step a live visit is on (`resolveStep`); `complete` once it is finished. */
  currentStep: visitStepSchema,
  reason: z.string().nullable(),
  status: visitStatusSchema,
  localDate: isoDateSchema,
  startedAt: isoDateTimeSchema,
  completedAt: isoDateTimeSchema.nullable(),
  durationMinutes: z.number().int().positive().nullable(),
  pausedAt: isoDateTimeSchema.nullable(),
  pausedSeconds: z.number().int().nonnegative(),
  branchId: idSchema,
  room: z.object({ id: idSchema, name: z.string() }).nullable(),
  patient: z.object({ id: idSchema, displayNumber: displayNumberSchema, fullName: z.string() }),
  dentist: z.object({ id: idSchema, name: z.string() }),
  services: z.array(visitListServiceSchema),
  notes: z.string(),
  /** The money fields are null when the caller may not see the visit's money: without
   * `payment:read`, on a visit that is not their own (ADR-0055). */
  discount: z.object({ mode: discountModeSchema, value: nonNegativeAmountSchema }).nullable(),
  currency: currencySchema,
  /** Frozen for completed/amended/voided visits, computed for live ones. */
  subtotal: aggregateAmountSchema.nullable(),
  discountAmount: aggregateAmountSchema.nullable(),
  total: aggregateAmountSchema.nullable(),
  amendmentCount: z.number().int().nonnegative(),
  /** Imported from the previous system (ADR-0053): only its times may be corrected. */
  imported: z.boolean(),
  /** When the checkout was closed without a payment (ADR-0033): it no longer waits at the desk. */
  checkedOutAt: isoDateTimeSchema.nullable(),
  voidedAt: isoDateTimeSchema.nullable(),
  voidReason: z.string().nullable(),
  updatedAt: isoDateTimeSchema,
  serverNow: isoDateTimeSchema,
});
export type VisitListItem = z.infer<typeof visitListItemSchema>;

export const visitPageSchema = cursorPageSchema(visitListItemSchema);
export type VisitPage = z.infer<typeof visitPageSchema>;

const billedSchema = z.array(z.object({ currency: currencySchema, amount: aggregateAmountSchema }));

/**
 * `GET /visits/summary`: `count` and `billed` (Σ total of counted visits, per currency) follow the
 * filters; `tabs` ignore them (D12) but keep the branch and visit scope; `today` = visits started
 * today. `billed` is money across patients: null without `finance:read` (ADR-0055).
 */
export const visitListSummarySchema = z.object({
  count: z.number().int().nonnegative(),
  billed: billedSchema.nullable(),
  tabs: z.object({
    all: z.number().int().nonnegative(),
    inProgress: z.number().int().nonnegative(),
    voidedAmended: z.number().int().nonnegative(),
    today: z.number().int().nonnegative(),
  }),
});
export type VisitListSummary = z.infer<typeof visitListSummarySchema>;

/** A service the visit keeps: a per-tooth one may change tooth and surfaces; `price` sets its
 * base price and clears its line discount. */
export const amendKeptServiceSchema = z.object({
  id: idSchema,
  toothCode: toothCodeSchema.optional(),
  surfaces: surfacesSchema.optional(),
  price: nonNegativeAmountSchema.optional(),
});

/** A catalog service the correction adds, at its catalog price unless `price` is given. */
export const amendAddedServiceSchema = z.object({
  procedureId: idSchema,
  toothCode: toothCodeSchema.optional(),
  jaw: jawSchema.optional(),
  surfaces: surfacesSchema.default([]),
  price: nonNegativeAmountSchema.optional(),
});

/**
 * The whole desired state of a completed or amended visit (D1–D4, ADR-0062): the services that
 * stay (one left out is removed) and those added, the visit discount, and optionally its start and
 * end. Users see this as "Correct visit".
 */
export const amendVisitSchema = z.object({
  expectedUpdatedAt: isoDateTimeSchema,
  reason: reasonSchema,
  discount: z.object({ mode: discountModeSchema, value: nonNegativeAmountSchema }),
  services: z.array(z.union([amendKeptServiceSchema, amendAddedServiceSchema])).min(1),
  times: z.object({ startedAt: isoDateTimeSchema, completedAt: isoDateTimeSchema }).optional(),
});
export type AmendVisitInput = z.infer<typeof amendVisitSchema>;
export type AmendKeptService = z.infer<typeof amendKeptServiceSchema>;
export type AmendAddedService = z.infer<typeof amendAddedServiceSchema>;

/**
 * The visit discount set at checkout, on the visit's day (checkout handoff, C3–C5): the services
 * stay as they are, the visit keeps its status and a reason is optional.
 */
export const checkoutDiscountSchema = z.object({
  expectedUpdatedAt: isoDateTimeSchema,
  reason: reasonSchema.optional(),
  discount: amendVisitSchema.shape.discount,
});
export type CheckoutDiscountInput = z.infer<typeof checkoutDiscountSchema>;

export const voidVisitSchema = z.object({
  expectedUpdatedAt: isoDateTimeSchema,
  reason: reasonSchema,
});
export type VoidVisitInput = z.infer<typeof voidVisitSchema>;

/** The visible page's patients (1–100). */
export const visitStatsQuerySchema = z.object({ patientIds: commaSeparatedIds(100) });
export type VisitStatsQuery = z.infer<typeof visitStatsQuerySchema>;

/** One patient's row of `GET /clinical/patients/visit-stats`: counted visits (D18), any branch. */
export const visitStatSchema = z.object({
  patientId: idSchema,
  lastVisitDate: isoDateSchema.nullable(),
  visitCount: z.number().int().nonnegative(),
});
export type VisitStat = z.infer<typeof visitStatSchema>;
export const visitStatsSchema = z.array(visitStatSchema);
export type VisitStats = z.infer<typeof visitStatsSchema>;
