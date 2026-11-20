import { z } from 'zod';
import { PLAN_PRIORITIES } from './clinical-records.js';
import { toCents } from './cents.js';
import {
  aggregateAmountSchema,
  blankToUndefined,
  currencySchema,
  idSchema,
  isoDateSchema,
} from './common.js';
import { monthSchema } from './compensation.js';
import { PAYMENT_METHODS } from './billing.js';
import { addDays } from './labs.js';
import { AGING_BUCKETS, payerSchema } from './payments.js';
import { ENTRY_VISIT_TYPES, VISIT_TYPES } from './visit-flow.js';

/**
 * Feature 19 (spec `2026-11-18-dashboards-design.md`): the Financial and Operational dashboards.
 * Read only; every figure is its home screen's for the same filter (ADR-0087). The period
 * arithmetic is here so the API (authoritative) and the SPA (printing the dates while cards load)
 * share one definition (ADR-0089).
 */

export const DASHBOARD_TABS = ['financial', 'operational'] as const;
export type DashboardTab = (typeof DASHBOARD_TABS)[number];

export const DASHBOARD_PERIODS = [
  'this_month',
  'last_month',
  'last_3_months',
  'this_year',
  'last_12_months',
  'custom',
] as const;
export const dashboardPeriodSchema = z.enum(DASHBOARD_PERIODS);
export type DashboardPeriod = z.infer<typeof dashboardPeriodSchema>;

/** A custom period is at most this many months long (24). */
export const CUSTOM_PERIOD_MAX_MONTHS = 24;
/** Trend charts: months and weeks shown, ending with the period's last month or week. */
export const TREND_POINTS = 12;

/** Every card's filter. `branchId` and `dentistId` are optional; `dentistId` is Operational's. */
export const dashboardQuerySchema = z.object({
  period: blankToUndefined(dashboardPeriodSchema.default('this_month')),
  from: blankToUndefined(isoDateSchema.optional()),
  to: blankToUndefined(isoDateSchema.optional()),
  branchId: blankToUndefined(idSchema.optional()),
  /** A staff profile id (ADR-0020). */
  dentistId: blankToUndefined(idSchema.optional()),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

/** A span of clinic-local days, both ends included. */
export interface DateSpan {
  from: string;
  to: string;
}

/** The period, what it is compared with, and the ends of its trends. */
export interface ResolvedPeriod extends DateSpan {
  compare: DateSpan;
  /** The 12 months (`YYYY-MM`) ending with the period's last month, oldest first. */
  months: string[];
  /** The 12 Monday-weeks (their Monday) ending with the period's last week, oldest first. */
  weeks: string[];
}

const DAY_MS = 86_400_000;
const dayNumber = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / DAY_MS;

/** Days from `from` to `to`, both included. */
export function daysIn(span: DateSpan): number {
  return dayNumber(span.to) - dayNumber(span.from) + 1;
}

/** The month (`YYYY-MM`) `count` months after `month` (negative: before). */
export function addMonths(month: string, count: number): string {
  const [year = 0, monthIndex = 1] = month.split('-').map(Number);
  const total = year * 12 + (monthIndex - 1) + count;
  return `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function lastDayOfMonth(month: string): string {
  return addDays(`${addMonths(month, 1)}-01`, -1);
}

/** The Monday on or before `iso` (the Schedule's week starts on Monday). */
export function weekStartOf(iso: string): string {
  const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDays(iso, -((weekday + 6) % 7));
}

/** The `count` months ending with `last`, oldest first. */
export function monthsEnding(last: string, count = TREND_POINTS): string[] {
  return Array.from({ length: count }, (_, index) => addMonths(last, index - count + 1));
}

/** The `count` Monday-weeks ending with the week of `lastDay`, oldest first. */
export function weeksEnding(lastDay: string, count = TREND_POINTS): string[] {
  const last = weekStartOf(lastDay);
  return Array.from({ length: count }, (_, index) => addDays(last, (index - count + 1) * 7));
}

const monthOf = (iso: string) => iso.slice(0, 7);

/** Whether a span is made of whole calendar months (from a 1st to a month's last day). */
export function isWholeMonths(span: DateSpan): boolean {
  return span.from.endsWith('-01') && span.to === lastDayOfMonth(monthOf(span.to));
}

/** The whole months of a span (`YYYY-MM`), oldest first; empty when it is not whole months. */
export function wholeMonthsOf(span: DateSpan): string[] {
  if (!isWholeMonths(span)) return [];
  const months: string[] = [];
  for (let month = monthOf(span.from); month <= monthOf(span.to); month = addMonths(month, 1)) {
    months.push(month);
  }
  return months;
}

/** The same days one month earlier, clamped to that month's end (1–31 Mar → 1–28 Feb). */
function sameDaysLastMonth(span: DateSpan): DateSpan {
  const month = addMonths(monthOf(span.from), -1);
  const end = lastDayOfMonth(month);
  const day = (iso: string) => iso.slice(8, 10);
  const clamp = (iso: string) => (iso > end ? end : iso);
  return { from: clamp(`${month}-${day(span.from)}`), to: clamp(`${month}-${day(span.to)}`) };
}

/** `count` whole months ending with `last`. */
function wholeMonths(last: string, count: number): DateSpan {
  return { from: `${addMonths(last, 1 - count)}-01`, to: lastDayOfMonth(last) };
}

/** The span immediately before: as many whole months, or as many days. */
function spanBefore(span: DateSpan): DateSpan {
  const months = wholeMonthsOf(span);
  const first = months[0];
  if (first) return wholeMonths(addMonths(first, -1), months.length);
  const days = daysIn(span);
  return { from: addDays(span.from, -days), to: addDays(span.from, -1) };
}

/**
 * The period of `query` on clinic-local `today` (ADR-0089), or null for an invalid custom period
 * (missing ends, reversed, longer than 24 months, or ending after today).
 */
export function resolvePeriod(
  query: Pick<DashboardQuery, 'period' | 'from' | 'to'>,
  today: string,
): ResolvedPeriod | null {
  const thisMonth = monthOf(today);
  let span: DateSpan;
  let compare: DateSpan;
  switch (query.period) {
    case 'this_month':
      span = { from: `${thisMonth}-01`, to: today };
      compare = sameDaysLastMonth(span);
      break;
    case 'last_month':
      span = wholeMonths(addMonths(thisMonth, -1), 1);
      compare = spanBefore(span);
      break;
    case 'last_3_months':
      span = wholeMonths(addMonths(thisMonth, -1), 3);
      compare = spanBefore(span);
      break;
    case 'last_12_months':
      span = wholeMonths(addMonths(thisMonth, -1), 12);
      compare = spanBefore(span);
      break;
    case 'this_year': {
      const year = Number(today.slice(0, 4));
      span = { from: `${today.slice(0, 4)}-01-01`, to: today };
      const previousYear = String(year - 1).padStart(4, '0');
      const sameDay = `${previousYear}${today.slice(4)}`;
      const lastFeb = lastDayOfMonth(`${previousYear}-02`);
      compare = {
        from: `${previousYear}-01-01`,
        // 29 Feb has no twin in a common year.
        to: today.slice(5) === '02-29' ? lastFeb : sameDay,
      };
      break;
    }
    case 'custom': {
      if (!query.from || !query.to || query.from > query.to || query.to > today) return null;
      if (query.from < `${addMonths(monthOf(query.to), 1 - CUSTOM_PERIOD_MAX_MONTHS)}-01`) {
        return null;
      }
      span = { from: query.from, to: query.to };
      compare = spanBefore(span);
      break;
    }
  }
  const lastMonth = monthOf(span.to);
  return {
    ...span,
    compare,
    months: monthsEnding(lastMonth),
    weeks: weeksEnding(span.to),
  };
}

/** `num ÷ den` as a number, or null when `den` is 0 (shown "—", never 0% or NaN). */
export function ratio(num: number | bigint, den: number | bigint): number | null {
  if (typeof num === 'bigint' || typeof den === 'bigint') {
    const n = BigInt(num);
    const d = BigInt(den);
    if (d === 0n) return null;
    // Six decimals is plenty for a percent shown to one decimal.
    return Number((n * 1_000_000n) / d) / 1_000_000;
  }
  return den === 0 ? null : num / den;
}

/** `ratio` of two money amounts (decimal strings), computed on cents. */
export function amountRatio(num: string, den: string): number | null {
  return ratio(toCents(num), toCents(den));
}

/**
 * The relative change from `previous` to `current` (0.25 = +25%), or null when there is nothing
 * to compare with (no previous value, or a previous value of 0).
 */
export function changeOf(
  current: number | null | undefined,
  previous: number | null | undefined,
): number | null {
  if (current === null || current === undefined || previous === null || previous === undefined) {
    return null;
  }
  if (previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

const amount = aggregateAmountSchema;
const count = z.number().int().nonnegative();
const pairOf = <TSchema extends z.ZodType>(schema: TSchema) =>
  z.object({ current: schema, previous: schema });

// --- Financial ---

/** Production, collections and discounts, with the 12-month trend and the payment methods. */
export const financialMoneySchema = z.object({
  currency: currencySchema,
  production: pairOf(amount),
  collected: pairOf(amount),
  /** Visits with a charge in the span and no reversal: the average's denominator. */
  visitsCharged: pairOf(count),
  /** Line and visit discounts of those visits, and their price before discounts. */
  discounts: pairOf(amount),
  gross: pairOf(amount),
  months: z.array(z.object({ month: monthSchema, production: amount, collected: amount })),
  /** Collected in the period by method, net of refunds (each on its own method). */
  methods: z.array(z.object({ method: z.enum(PAYMENT_METHODS), amount })),
});
export type FinancialMoney = z.infer<typeof financialMoneySchema>;

/** The cost groups of _Where the money goes_. */
export const COST_GROUPS = ['salaries', 'dentist_compensation', 'lab_fees', 'other'] as const;
export type CostGroup = (typeof COST_GROUPS)[number];

/**
 * Expenses (ADR-0088). Without complete cost, `total`, `months` and `groups` are null and
 * `categories` holds only what the caller's Expenses screen shows.
 */
export const financialCostsSchema = z.object({
  currency: currencySchema,
  completeCost: z.boolean(),
  total: pairOf(amount).nullable(),
  months: z.array(z.object({ month: monthSchema, amount })).nullable(),
  categories: z.array(
    z.object({
      categoryId: idSchema,
      /** A predefined category's key (the SPA words it), null for the clinic's own. */
      key: z.string().nullable(),
      name: z.string().nullable(),
      amount,
    }),
  ),
  groups: z.array(z.object({ group: z.enum(COST_GROUPS), amount })).nullable(),
});
export type FinancialCosts = z.infer<typeof financialCostsSchema>;

export const financialReceivablesSchema = z.object({
  currency: currencySchema,
  total: amount,
  buckets: z.array(z.object({ bucket: z.enum(AGING_BUCKETS), amount })),
  /**
   * The five largest balances, by family (families C): the owing patients grouped under their
   * primary billing contact, as Outstanding grouped by payer. `patientId`, `fullName` and
   * `displayNumber` are the family's first member (the patient, alone); `members` counts the
   * owing members; `payer` is the billing contact, or null for a patient nobody bills.
   */
  largest: z.array(
    z.object({
      patientId: idSchema,
      fullName: z.string(),
      displayNumber: z.string(),
      payer: payerSchema.nullable(),
      members: z.number().int().positive(),
      amount,
      oldest: isoDateSchema,
      bucket: z.enum(AGING_BUCKETS),
    }),
  ),
});
export type FinancialReceivables = z.infer<typeof financialReceivablesSchema>;

export const financialDentistsSchema = z.object({
  currency: currencySchema,
  /** Whether compensation is shown: the caller manages it and the period is whole months. */
  earnedShown: z.boolean(),
  rows: z.array(
    z.object({
      profileId: idSchema,
      name: z.string(),
      production: amount,
      collected: amount,
      /** Null when not shown or without an agreement in the period. */
      earned: amount.nullable(),
    }),
  ),
  /** Collected that belongs to no dentist: credit not yet applied, advances, old balances. */
  unallocated: amount,
});
export type FinancialDentists = z.infer<typeof financialDentistsSchema>;

export const financialServicesSchema = z.object({
  currency: currencySchema,
  services: z.array(
    z.object({ code: z.string(), name: z.string(), category: z.string().nullable(), amount }),
  ),
  categories: z.array(z.object({ category: z.string().nullable(), amount })),
});
export type FinancialServices = z.infer<typeof financialServicesSchema>;

export const financialPlansSchema = z.object({
  currency: currencySchema,
  /** Accepted and not started, by priority in `planPhases` order. */
  accepted: z.array(z.object({ priority: z.enum(PLAN_PRIORITIES), amount, items: count })),
  proposed: z.object({ amount, items: count }),
});
export type FinancialPlans = z.infer<typeof financialPlansSchema>;

/** What the clinic owes now; each line null without its permission. */
export const financialOwesSchema = z.object({
  currency: currencySchema,
  labs: amount.nullable(),
  /** Suppliers' outstanding (feature 20a); null without `inventory:money_read`. */
  suppliers: amount.nullable(),
  salaries: amount.nullable(),
  dentists: amount.nullable(),
  fixed: z.object({ count, amount }).nullable(),
  credit: amount,
});
export type FinancialOwes = z.infer<typeof financialOwesSchema>;

/**
 * The Stock card (feature 20a, C4): stock value now, consumption in the period, the most consumed
 * items by cost (top eight and the rest). Null with a dentist filter: stock is not a dentist's.
 */
export const financialStockSchema = z.object({
  currency: currencySchema,
  value: amount,
  consumption: amount,
  top: z.array(z.object({ itemId: idSchema, name: z.string(), cost: amount })),
  other: amount,
  unpriced: z.object({ receipts: count, openingBatches: count }),
});
export type FinancialStock = z.infer<typeof financialStockSchema>;

// --- Operational ---

export const appointmentCountsSchema = z.object({
  due: count,
  completed: count,
  cancelled: count,
  noShow: count,
  unresolved: count,
});
export type AppointmentCounts = z.infer<typeof appointmentCountsSchema>;

export const operationalAppointmentsSchema = z.object({
  counts: pairOf(appointmentCountsSchema),
  weeks: z.array(appointmentCountsSchema.extend({ week: isoDateSchema })),
  roomUse: pairOf(z.object({ bookedMinutes: count, capacityMinutes: count })),
});
export type OperationalAppointments = z.infer<typeof operationalAppointmentsSchema>;

export const operationalBusyHoursSchema = z.object({
  /** The hours some day of the branch (or any branch) is open, in order. */
  hours: z.array(z.number().int().min(0).max(23)),
  /** 0 = Sunday … 6 = Saturday; the open weekdays in Monday-first order. */
  weekdays: z.array(z.number().int().min(0).max(6)),
  cells: z.array(
    z.object({
      weekday: z.number().int().min(0).max(6),
      hour: z.number().int().min(0).max(23),
      booked: count,
      noShows: count,
    }),
  ),
});
export type OperationalBusyHours = z.infer<typeof operationalBusyHoursSchema>;

const waitSchema = z.object({
  count,
  medianMinutes: z.number().nullable(),
  over15: count,
});

export const operationalVisitsSchema = z.object({
  visits: pairOf(count),
  months: z.array(z.object({ month: monthSchema, visits: count })),
  wait: pairOf(waitSchema),
  types: z.array(
    z.object({
      type: z.enum(VISIT_TYPES),
      count,
      /** Mean minutes booked, over the visits that came from an appointment. */
      bookedMinutes: z.number().nullable(),
      /** Mean minutes on the visit timer. */
      takenMinutes: z.number().nullable(),
    }),
  ),
});
export type OperationalVisits = z.infer<typeof operationalVisitsSchema>;

export const operationalPatientsSchema = z.object({
  newPatients: pairOf(count),
  active: count,
  cameBack: z.object({ cohort: count, returned: count }),
  months: z.array(z.object({ month: monthSchema, new: count, returning: count })),
  /** What the period's new patients came for (`first_visit_type`), `none` when unknown. */
  reasons: z.array(z.object({ reason: z.enum([...ENTRY_VISIT_TYPES, 'none']), count })),
});
export type OperationalPatients = z.infer<typeof operationalPatientsSchema>;

export const planStageCountsSchema = z.object({
  recorded: count,
  accepted: count,
  started: count,
  completed: count,
});
export type PlanStageCounts = z.infer<typeof planStageCountsSchema>;

export const operationalPlansSchema = pairOf(planStageCountsSchema);
export type OperationalPlans = z.infer<typeof operationalPlansSchema>;

export const operationalDentistsSchema = z.object({
  rows: z.array(
    z.object({
      profileId: idSchema,
      name: z.string(),
      visits: count,
      bookedMinutes: count,
      avgVisitMinutes: z.number().nullable(),
      due: count,
      noShows: count,
      plansRecorded: count,
      plansAccepted: count,
      medianWaitMinutes: z.number().nullable(),
    }),
  ),
});
export type OperationalDentists = z.infer<typeof operationalDentistsSchema>;

export const operationalLabsSchema = z.object({
  rows: z.array(
    z.object({
      labId: idSchema,
      name: z.string(),
      received: count,
      onTimeRate: z.number().nullable(),
      avgTurnaroundDays: z.number().nullable(),
      /** The lab's usual turnaround, in days; null when it has none. */
      promisedDays: z.number().nullable(),
      remakeRate: z.number().nullable(),
    }),
  ),
});
export type OperationalLabs = z.infer<typeof operationalLabsSchema>;

export const operationalFollowUpsSchema = z.object({
  booked: count,
  waiting: count,
  declined: count,
  expired: count,
});
export type OperationalFollowUps = z.infer<typeof operationalFollowUpsSchema>;

/** Needs attention · now. A line is null when the caller may not see it or a filter sets it
 * aside (clinic-wide lines with a branch or dentist). */
export const operationalAttentionSchema = z.object({
  unresolved: count,
  openVisits: count,
  acceptedUnbooked: count.nullable(),
  followUpsOverdue: count,
  /** Today's *Openings to fill* (feature 21); null without `appointment:write_all`. */
  openingsToFill: count.nullable(),
  labLate: count.nullable(),
  labArrivedUnbooked: z.object({ count, orderIds: z.array(idSchema) }).nullable(),
  /** Item-branch pairs labelled so now (feature 20a); null without `inventory:read`. */
  stockOut: count.nullable(),
  stockLow: count.nullable(),
  stockExpired: count.nullable(),
  incomplete: count.nullable(),
});
export type OperationalAttention = z.infer<typeof operationalAttentionSchema>;

// --- Patient cohorts (drill-down lists on the Patients screen) ---

/**
 * The Patients screen's cohorts behind a dashboard figure: `first_seen` (first visit ever in
 * `from`–`to`), `seen` (a visit in the last 12 months), `proposed` (a plan item recorded in the
 * range and not accepted), `accepted` (an accepted item not started), `accepted_unbooked`
 * (`scheduling`: and no upcoming appointment), `incomplete` (`patients`: a quick registration).
 */
export const PATIENT_COHORTS = [
  'first_seen',
  'seen',
  'proposed',
  'accepted',
  'accepted_unbooked',
  'incomplete',
] as const;
export const patientCohortSchema = z.enum(PATIENT_COHORTS);
export type PatientCohort = z.infer<typeof patientCohortSchema>;
