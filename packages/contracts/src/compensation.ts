import { z } from 'zod';
import { reasonSchema } from './audit.js';
import {
  balanceAmountSchema,
  exportLanguageSchema,
  paymentMethodSchema,
  VISIT_LEDGER_KINDS,
} from './billing.js';
import {
  blankToUndefined,
  currencySchema,
  decimalAmountSchema,
  idSchema,
  isoDateSchema,
  isoDateTimeSchema,
  optionalText,
} from './common.js';
import type { Permission } from './permissions.js';
import { visitTypeSchema } from './visit-flow.js';

/**
 * Feature 13b (spec `2026-10-25-dentist-compensation-design.md`, ADR-0058–0060): how a clinic
 * pays each dentist. An agreement is an effective-dated set of components; the monthly statement
 * is derived from the ledger for open months and frozen on close. Clinic-managed only
 * (`compensation:manage`); a dentist reads their own statement (`compensation:read`).
 */

/** `YYYY-MM`: a calendar month in the tenant time zone. */
export const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected a month as YYYY-MM');
export type Month = z.infer<typeof monthSchema>;

/** A percentage 0–100 with at most 2 decimals, as a decimal string (never a float). */
export const percentSchema = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, 'Expected a percentage with at most 2 decimals')
  .refine((value) => Number(value) <= 100, 'At most 100 %');

const isZero = (amount: string) => /^-?0+(\.0+)?$/.test(amount);
const nonZeroAmountSchema = decimalAmountSchema.refine(
  (amount) => !isZero(amount),
  'Must not be zero',
);
const positiveAmountSchema = decimalAmountSchema.refine(
  (amount) => !amount.startsWith('-') && !isZero(amount),
  'Must be greater than zero',
);
const nonNegativeAmountSchema = decimalAmountSchema.refine(
  (amount) => !amount.startsWith('-') || isZero(amount),
  'Must not be negative',
);

export const COMPONENT_KINDS = ['monthlyFixed', 'share', 'perVisit', 'perDay'] as const;
export const componentKindSchema = z.enum(COMPONENT_KINDS);
export type ComponentKind = z.infer<typeof componentKindSchema>;

/** What a share is a percentage of: billed amounts (the ledger's visit entries) or collected ones
 * (payments allocated to the dentist's visits). Always after discount. */
export const SHARE_BASES = ['production', 'collection'] as const;
export const shareBasisSchema = z.enum(SHARE_BASES);
export type ShareBasis = z.infer<typeof shareBasisSchema>;

/** A rate for one service code or one catalog category; a code match beats a category match. */
export const rateOverrideSchema = z.object({
  target: z.enum(['service', 'category']),
  key: z.string().trim().min(1).max(80),
  percent: percentSchema,
});
export type RateOverride = z.infer<typeof rateOverrideSchema>;

/** A fixed amount per month; negative = the dentist pays the clinic (chair rent). */
export const monthlyFixedComponentSchema = z.object({
  kind: z.literal('monthlyFixed'),
  amount: nonZeroAmountSchema,
  prorate: z.boolean().default(true),
});

export const shareComponentSchema = z.object({
  kind: z.literal('share'),
  percent: percentSchema,
  basis: shareBasisSchema.default('collection'),
  rateOverrides: z
    .array(rateOverrideSchema)
    .max(100)
    .default([])
    .refine(
      (overrides) =>
        new Set(overrides.map((override) => `${override.target}:${override.key}`)).size ===
        overrides.length,
      'Each service or category may have one rate',
    ),
  /** The monthly base above which the share applies; null = from the first unit. */
  threshold: positiveAmountSchema.nullable().default(null),
});

export const perVisitComponentSchema = z.object({
  kind: z.literal('perVisit'),
  amount: nonNegativeAmountSchema,
  /** An amount per visit type, overriding `amount` (e.g. Consultation 0). */
  byType: z.partialRecord(visitTypeSchema, nonNegativeAmountSchema).default({}),
  /** Off: a visit with a net total of 0 still counts. */
  chargedOnly: z.boolean().default(false),
});

export const perDayComponentSchema = z.object({
  kind: z.literal('perDay'),
  amount: positiveAmountSchema,
});

export const agreementComponentSchema = z.discriminatedUnion('kind', [
  monthlyFixedComponentSchema,
  shareComponentSchema,
  perVisitComponentSchema,
  perDayComponentSchema,
]);
export type AgreementComponent = z.infer<typeof agreementComponentSchema>;
export type MonthlyFixedComponent = z.infer<typeof monthlyFixedComponentSchema>;
export type ShareComponent = z.infer<typeof shareComponentSchema>;
export type PerVisitComponent = z.infer<typeof perVisitComponentSchema>;
export type PerDayComponent = z.infer<typeof perDayComponentSchema>;

/** At least one component, at most one of each kind. */
export const agreementComponentsSchema = z
  .array(agreementComponentSchema)
  .min(1, 'Add at least one component')
  .refine(
    (components) =>
      new Set(components.map((component) => component.kind)).size === components.length,
    'Each component may appear once',
  );

/** A preset only pre-fills the form and labels the agreement; the components are the truth. */
export const AGREEMENT_PRESETS = [
  'revenueShare',
  'perVisit',
  'monthlySalary',
  'salaryCommission',
  'perDay',
  'chairRent',
  'custom',
] as const;
export const agreementPresetSchema = z.enum(AGREEMENT_PRESETS);
export type AgreementPreset = z.infer<typeof agreementPresetSchema>;

/** The components each preset starts with (Custom: none, the owner adds them). */
export const PRESET_COMPONENTS: Record<AgreementPreset, readonly ComponentKind[]> = {
  revenueShare: ['share'],
  perVisit: ['perVisit'],
  monthlySalary: ['monthlyFixed'],
  salaryCommission: ['monthlyFixed', 'share'],
  perDay: ['perDay'],
  chairRent: ['monthlyFixed', 'share'],
  custom: [],
};

/**
 * An agreement's state on the tenant's today: not started (`future`), in force or open-ended
 * (`active`), past its end (`ended`), or replaced from its first day (`superseded`, ADR-0058).
 */
export const AGREEMENT_STATUSES = ['future', 'active', 'ended', 'superseded'] as const;
export const agreementStatusSchema = z.enum(AGREEMENT_STATUSES);
export type AgreementStatus = z.infer<typeof agreementStatusSchema>;

const NOTE_MAX = 500;

export const agreementSchema = z.object({
  id: idSchema,
  profileId: idSchema,
  preset: agreementPresetSchema,
  components: agreementComponentsSchema,
  effectiveFrom: isoDateSchema,
  effectiveTo: isoDateSchema.nullable(),
  statementVisibleToDentist: z.boolean(),
  note: z.string().nullable(),
  status: agreementStatusSchema,
  createdAt: isoDateTimeSchema,
  endReason: z.string().nullable(),
  supersededAt: isoDateTimeSchema.nullable(),
  supersedeReason: z.string().nullable(),
});
export type Agreement = z.infer<typeof agreementSchema>;

const agreementTermsSchema = z.object({
  preset: agreementPresetSchema,
  components: agreementComponentsSchema,
  statementVisibleToDentist: z.boolean().default(true),
  note: optionalText(NOTE_MAX),
});

/** `POST …/agreements`. */
export const createAgreementSchema = agreementTermsSchema
  .extend({
    effectiveFrom: isoDateSchema,
    effectiveTo: isoDateSchema.nullable().default(null),
  })
  .refine((input) => input.effectiveTo === null || input.effectiveTo >= input.effectiveFrom, {
    path: ['effectiveTo'],
    message: 'Ends before it starts',
  });
export type CreateAgreement = z.infer<typeof createAgreementSchema>;
export type CreateAgreementRequest = z.input<typeof createAgreementSchema>;

/** `POST …/agreements/:id/end`: the last day it is in force. */
export const endAgreementSchema = z.object({
  date: isoDateSchema,
  reason: optionalText(NOTE_MAX),
});
export type EndAgreement = z.infer<typeof endAgreementSchema>;

/**
 * `POST …/agreements/change-terms`: the current agreement ends on `effectiveFrom − 1` and the new
 * one starts on `effectiveFrom`, in one transaction (C5). On the current agreement's first day it
 * is superseded instead (ADR-0058).
 */
export const changeTermsSchema = agreementTermsSchema.extend({
  effectiveFrom: isoDateSchema,
  reason: optionalText(NOTE_MAX),
});
export type ChangeTerms = z.infer<typeof changeTermsSchema>;
export type ChangeTermsRequest = z.input<typeof changeTermsSchema>;

export const ADJUSTMENT_KINDS = [
  'bonus',
  'deduction',
  'lab_cost',
  'materials',
  'advance',
  'opening_balance',
  'correction',
  'other',
] as const;
export const adjustmentKindSchema = z.enum(ADJUSTMENT_KINDS);
export type AdjustmentKind = z.infer<typeof adjustmentKindSchema>;

/** `POST …/adjustments`: signed — positive adds to what the clinic owes the dentist. */
export const recordAdjustmentSchema = z
  .object({
    kind: adjustmentKindSchema,
    amount: nonZeroAmountSchema,
    date: isoDateSchema,
    note: optionalText(NOTE_MAX),
  })
  .refine((input) => input.kind !== 'other' || input.note !== null, {
    path: ['note'],
    message: 'Say what it is for',
  });
export type RecordAdjustment = z.infer<typeof recordAdjustmentSchema>;
export type RecordAdjustmentRequest = z.input<typeof recordAdjustmentSchema>;

const voidedFields = {
  voidedAt: isoDateTimeSchema.nullable(),
  voidReason: z.string().nullable(),
};

export const adjustmentSchema = z.object({
  id: idSchema,
  profileId: idSchema,
  kind: adjustmentKindSchema,
  amount: balanceAmountSchema,
  currency: currencySchema,
  date: isoDateSchema,
  note: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  ...voidedFields,
});
export type Adjustment = z.infer<typeof adjustmentSchema>;

const REFERENCE_MAX = 80;

/** `POST …/payouts`: money paid to the dentist. */
export const recordPayoutSchema = z.object({
  amount: positiveAmountSchema,
  date: isoDateSchema,
  method: paymentMethodSchema,
  reference: optionalText(REFERENCE_MAX),
  note: optionalText(NOTE_MAX),
});
export type RecordPayout = z.infer<typeof recordPayoutSchema>;
export type RecordPayoutRequest = z.input<typeof recordPayoutSchema>;

export const payoutSchema = z.object({
  id: idSchema,
  profileId: idSchema,
  amount: balanceAmountSchema,
  currency: currencySchema,
  date: isoDateSchema,
  method: paymentMethodSchema,
  reference: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  ...voidedFields,
});
export type Payout = z.infer<typeof payoutSchema>;

/** Voiding an adjustment or a payout, and reopening a closed month, need a reason. */
export const compensationReasonSchema = z.object({ reason: reasonSchema });
export type CompensationReason = z.infer<typeof compensationReasonSchema>;

export const monthQuerySchema = z.object({ month: monthSchema });
export type MonthQuery = z.infer<typeof monthQuerySchema>;

/** The CSV exports: the month, and the header language (the SPA's UI language; else the
 * tenant's). */
export const compensationExportQuerySchema = monthQuerySchema.extend({
  lang: blankToUndefined(exportLanguageSchema.optional()),
});
export type CompensationExportQuery = z.infer<typeof compensationExportQuerySchema>;

export const COMPENSATION_LINE_KINDS = [
  'production',
  'collection',
  'perVisit',
  'perDay',
  'fixed',
  'threshold',
] as const;
export const statementLineKindSchema = z.enum(COMPENSATION_LINE_KINDS);
export type StatementLineKind = z.infer<typeof statementLineKindSchema>;

/** What a line comes from: a visit ledger entry (production) or an allocation (collection). */
export const STATEMENT_SOURCE_KINDS = [
  ...VISIT_LEDGER_KINDS,
  'allocation',
  'credit_applied',
  'release',
] as const;
export const statementSourceKindSchema = z.enum(STATEMENT_SOURCE_KINDS);
export type StatementSourceKind = z.infer<typeof statementSourceKindSchema>;

/** A rate as shown: `30.48`, blended when overrides applied to the visit's lines. */
export const statementRateSchema = z.object({
  percent: z.string(),
  blended: z.boolean(),
  /** The visit's lines behind a blended rate (the tooltip). */
  lines: z
    .array(z.object({ code: z.string(), amount: balanceAmountSchema, percent: z.string() }))
    .default([]),
});
export type StatementRate = z.infer<typeof statementRateSchema>;

/**
 * One line of a statement (ADR-0059). `id` is stable — the entry, allocation, visit or day it
 * comes from — and is how a closed month remembers what it counted. `base`/`rate` for shares,
 * `count`/`unitAmount` for per-visit and per-day, `amount` is what the dentist earns.
 */
export const statementLineSchema = z.object({
  id: z.string(),
  kind: statementLineKindSchema,
  date: isoDateSchema,
  agreementId: idSchema.nullable(),
  visitId: idSchema.nullable(),
  visitNumber: z.number().int().positive().nullable(),
  patientId: idSchema.nullable(),
  patientName: z.string().nullable(),
  visitType: visitTypeSchema.nullable(),
  source: statementSourceKindSchema.nullable(),
  /** A per-visit or per-day line taking back an earlier count (a void after the close). */
  reversal: z.boolean(),
  base: balanceAmountSchema.nullable(),
  rate: statementRateSchema.nullable(),
  count: z.number().int().nullable(),
  unitAmount: balanceAmountSchema.nullable(),
  amount: balanceAmountSchema,
  currency: currencySchema,
});
export type StatementLine = z.infer<typeof statementLineSchema>;

export const earnedGroupSchema = z.object({
  component: componentKindSchema,
  lines: z.array(statementLineSchema),
  total: balanceAmountSchema,
});
export type EarnedGroup = z.infer<typeof earnedGroupSchema>;

/** Lines whose own month was closed before they appeared, reported in the first open month. */
export const lateGroupSchema = z.object({
  month: monthSchema,
  lines: z.array(statementLineSchema),
  total: balanceAmountSchema,
});
export type LateGroup = z.infer<typeof lateGroupSchema>;

export const STATEMENT_STATUSES = ['provisional', 'closed'] as const;
export const statementStatusSchema = z.enum(STATEMENT_STATUSES);
export type StatementStatus = z.infer<typeof statementStatusSchema>;

export const statementTotalsSchema = z.object({
  opening: balanceAmountSchema,
  earned: balanceAmountSchema,
  late: balanceAmountSchema,
  adjustments: balanceAmountSchema,
  payouts: balanceAmountSchema,
  /** opening + earned + late + adjustments − payouts; negative = the dentist owes the clinic. */
  closing: balanceAmountSchema,
});
export type StatementTotals = z.infer<typeof statementTotalsSchema>;

export const compensationStatementSchema = z.object({
  profileId: idSchema,
  dentistName: z.string(),
  month: monthSchema,
  status: statementStatusSchema,
  currency: currencySchema,
  /** The agreements in force on some day of the month. */
  agreements: z.array(agreementSchema),
  earned: z.array(earnedGroupSchema),
  late: z.array(lateGroupSchema),
  adjustments: z.array(adjustmentSchema),
  payouts: z.array(payoutSchema),
  /** Billed lines of visits with no agreement on their date: rate "—", they earn nothing. */
  noAgreement: z.array(statementLineSchema),
  /** Lines in another currency (before ADR-0035's lock): listed, never computed. */
  notComputed: z.array(statementLineSchema),
  totals: statementTotalsSchema,
  closedAt: isoDateTimeSchema.nullable(),
  /** The dentist's first month: nothing before it, and its empty state explains imports. */
  firstMonth: monthSchema.nullable(),
});
export type CompensationStatement = z.infer<typeof compensationStatementSchema>;

export const REPORT_ROW_STATUSES = ['provisional', 'closed', 'none'] as const;
export type ReportRowStatus = (typeof REPORT_ROW_STATUSES)[number];

export const compensationReportRowSchema = z.object({
  profileId: idSchema,
  name: z.string(),
  active: z.boolean(),
  visits: z.number().int().nonnegative(),
  production: balanceAmountSchema,
  collections: balanceAmountSchema,
  /** Null without an agreement in the month ("—"). */
  earned: balanceAmountSchema.nullable(),
  adjustments: balanceAmountSchema,
  payouts: balanceAmountSchema,
  balance: balanceAmountSchema,
  status: z.enum(REPORT_ROW_STATUSES),
});
export type CompensationReportRow = z.infer<typeof compensationReportRowSchema>;

export const compensationReportSchema = z.object({
  month: monthSchema,
  currency: currencySchema,
  rows: z.array(compensationReportRowSchema),
  /** Collections on opening balances and balance adjustments, which belong to no visit. */
  unattributed: z.object({ collections: balanceAmountSchema }),
  kpis: z.object({
    production: balanceAmountSchema,
    collections: balanceAmountSchema,
    earned: balanceAmountSchema,
    /** Σ closing balances: what the clinic owes its dentists, net. */
    balanceOwed: balanceAmountSchema,
  }),
});
export type CompensationReport = z.infer<typeof compensationReportSchema>;

/** `GET /compensation/me/months`: the months the dentist may read, newest first. */
export const myMonthsSchema = z.array(monthSchema);

/** The domain events (C8), named so `audit` can hide them from anyone without
 * `compensation:manage` (ADR-0060). */
export const COMPENSATION_EVENTS = [
  'AgreementCreated',
  'AgreementEnded',
  'AgreementSuperseded',
  'AdjustmentRecorded',
  'AdjustmentVoided',
  'PayoutRecorded',
  'PayoutVoided',
  'PeriodClosed',
  'PeriodReopened',
] as const;

export interface StatementActor {
  permissions: Iterable<Permission>;
  /** The caller's staff profile id in this tenant; null without one. */
  profileId: string | null;
}

/**
 * Who reads a dentist's statement (ADR-0060), the second resource rule after `canReadVisit`:
 * `compensation:manage` reads every one, `compensation:read` only the caller's own.
 */
export function canReadStatement(actor: StatementActor, profileId: string): boolean {
  const held = new Set(actor.permissions);
  if (held.has('compensation:manage')) return true;
  return held.has('compensation:read') && actor.profileId !== null && actor.profileId === profileId;
}
