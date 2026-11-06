import { z } from 'zod';
import { reasonSchema } from './audit.js';
import { balanceAmountSchema, exportLanguageSchema, paymentMethodSchema } from './billing.js';
import {
  blankToUndefined,
  currencySchema,
  idSchema,
  isoDateSchema,
  isoDateTimeSchema,
  optionalText,
  queryBooleanSchema,
} from './common.js';
import { monthSchema, positiveAmountSchema } from './compensation.js';

/**
 * Feature 17 (spec `2026-11-06-expenses-and-payroll-design.md`, ADR-0076–0080): what the clinic
 * spends. An expense is always a payment that already happened. Fixed expenses are monthly
 * templates whose items wait for a person to confirm them; salaries (`payroll`) and dentist
 * payouts (`compensation`) are mirrored in as read-only rows.
 */

/** The list every clinic starts with, translated by key (`expenses:category.<key>`). */
export const PREDEFINED_CATEGORY_KEYS = [
  'rent',
  'electricity',
  'water',
  'internet_phone',
  'supplies',
  'lab_fees',
  'equipment',
  'cleaning',
  'marketing',
  'software',
  'taxes_fees',
  'insurance',
  'professional_fees',
  'transport',
] as const;
/** Created by the system for the mirrored rows; never chosen by hand. */
export const RESERVED_CATEGORY_KEYS = ['salaries', 'dentist_compensation'] as const;
export const EXPENSE_CATEGORY_KEYS = [
  ...PREDEFINED_CATEGORY_KEYS,
  'other',
  ...RESERVED_CATEGORY_KEYS,
] as const;
export const expenseCategoryKeySchema = z.enum(EXPENSE_CATEGORY_KEYS);
export type ExpenseCategoryKey = z.infer<typeof expenseCategoryKeySchema>;
export type ReservedCategoryKey = (typeof RESERVED_CATEGORY_KEYS)[number];

/**
 * What a category may do (D7): a predefined one is deactivated but never renamed; *Other* and the
 * reserved ones never change; a custom one is renamed, deactivated, and deleted while unused.
 */
export const EXPENSE_CATEGORY_KINDS = ['predefined', 'other', 'reserved', 'custom'] as const;
export type ExpenseCategoryKind = (typeof EXPENSE_CATEGORY_KINDS)[number];

export function categoryKindOf(key: ExpenseCategoryKey | null): ExpenseCategoryKind {
  if (key === null) return 'custom';
  if (key === 'other') return 'other';
  return (RESERVED_CATEGORY_KEYS as readonly string[]).includes(key) ? 'reserved' : 'predefined';
}

export const CATEGORY_NAME_MAX = 60;
export const categoryNameSchema = z.string().trim().min(1).max(CATEGORY_NAME_MAX);

export const expenseCategorySchema = z.object({
  id: idSchema,
  /** Set for the clinic's starting list; the name is then the translation of the key. */
  key: expenseCategoryKeySchema.nullable(),
  /** A custom category's own name; null for a keyed one. */
  name: z.string().nullable(),
  kind: z.enum(EXPENSE_CATEGORY_KINDS),
  active: z.boolean(),
  /** Some expense, fixed expense or item uses it: it can't be deleted. */
  inUse: z.boolean(),
});
export type ExpenseCategory = z.infer<typeof expenseCategorySchema>;

export const createExpenseCategorySchema = z.object({ name: categoryNameSchema });
export type CreateExpenseCategory = z.infer<typeof createExpenseCategorySchema>;

export const updateExpenseCategorySchema = z
  .object({ name: categoryNameSchema.optional(), active: z.boolean().optional() })
  .refine((patch) => patch.name !== undefined || patch.active !== undefined, 'Nothing to change');
export type UpdateExpenseCategory = z.infer<typeof updateExpenseCategorySchema>;

/** Where an expense comes from: typed by hand, a confirmed fixed item, or a mirror (read-only). */
export const EXPENSE_SOURCES = ['manual', 'fixed', 'payroll', 'compensation'] as const;
export const expenseSourceSchema = z.enum(EXPENSE_SOURCES);
export type ExpenseSource = z.infer<typeof expenseSourceSchema>;

export const PAYEE_MAX = 120;
export const EXPENSE_REFERENCE_MAX = 80;
export const DESCRIPTION_MAX = 300;

export const expenseSchema = z.object({
  id: idSchema,
  spentOn: isoDateSchema,
  categoryId: idSchema,
  amount: balanceAmountSchema,
  currency: currencySchema,
  method: paymentMethodSchema,
  payee: z.string().nullable(),
  reference: z.string().nullable(),
  description: z.string().nullable(),
  branchId: idSchema.nullable(),
  source: expenseSourceSchema,
  /** The fixed item, payroll payment or payout the row comes from. */
  sourceId: idSchema.nullable(),
  /** The month a fixed item or a salary is for. */
  sourceMonth: monthSchema.nullable(),
  createdAt: isoDateTimeSchema,
  voidedAt: isoDateTimeSchema.nullable(),
  voidReason: z.string().nullable(),
});
export type Expense = z.infer<typeof expenseSchema>;

/** Editable from Expenses: typed or confirmed rows, never the mirrors. */
export const isEditableExpense = (expense: Pick<Expense, 'source' | 'voidedAt'>): boolean =>
  (expense.source === 'manual' || expense.source === 'fixed') && expense.voidedAt === null;

const expenseFields = {
  spentOn: isoDateSchema,
  categoryId: idSchema,
  amount: positiveAmountSchema,
  method: paymentMethodSchema,
  payee: optionalText(PAYEE_MAX),
  reference: optionalText(EXPENSE_REFERENCE_MAX),
  description: optionalText(DESCRIPTION_MAX),
  branchId: idSchema.nullish().transform((value) => value ?? null),
};

/** `POST /expenses` (Idempotency-Key). *Other* needs a description (checked by the service). */
export const recordExpenseSchema = z.object(expenseFields);
export type RecordExpense = z.infer<typeof recordExpenseSchema>;
export type RecordExpenseRequest = z.input<typeof recordExpenseSchema>;

export const updateExpenseSchema = z
  .object(expenseFields)
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to change');
export type UpdateExpense = z.infer<typeof updateExpenseSchema>;
export type UpdateExpenseRequest = z.input<typeof updateExpenseSchema>;

export const expenseReasonSchema = z.object({ reason: reasonSchema });
export type ExpenseReason = z.infer<typeof expenseReasonSchema>;

const filterFields = {
  from: isoDateSchema,
  to: isoDateSchema,
  categoryId: blankToUndefined(idSchema.optional()),
  branchId: blankToUndefined(idSchema.optional()),
  method: blankToUndefined(paymentMethodSchema.optional()),
  q: blankToUndefined(z.string().trim().max(100).optional()),
  includeVoided: queryBooleanSchema,
};
const rangeInOrder = (filter: { from: string; to: string }) => filter.from <= filter.to;

/** `GET /expenses`: a date range (the SPA sends the month by default), newest first. */
export const expenseListQuerySchema = z
  .object({
    ...filterFields,
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .refine(rangeInOrder, { path: ['to'], message: 'The end is before the start' });
export type ExpenseListQuery = z.infer<typeof expenseListQuerySchema>;

export const expenseExportQuerySchema = z
  .object({ ...filterFields, lang: blankToUndefined(exportLanguageSchema.optional()) })
  .refine(rangeInOrder, { path: ['to'], message: 'The end is before the start' });
export type ExpenseExportQuery = z.infer<typeof expenseExportQuerySchema>;

export const expenseTotalSchema = z.object({
  amount: balanceAmountSchema,
  count: z.number().int().nonnegative(),
});
export type ExpenseTotal = z.infer<typeof expenseTotalSchema>;

export const expensePageSchema = z.object({
  items: z.array(expenseSchema),
  nextCursor: z.string().nullable(),
  /** Over the whole filter, voided rows never counted. */
  total: expenseTotalSchema,
  byCategory: z.array(expenseTotalSchema.extend({ categoryId: idSchema })),
});
export type ExpensePage = z.infer<typeof expensePageSchema>;

export const expenseYearQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
});
export type ExpenseYearQuery = z.infer<typeof expenseYearQuerySchema>;

export const expenseYearSchema = z.object({
  year: z.number().int(),
  months: z.array(expenseTotalSchema.extend({ month: monthSchema })),
  total: expenseTotalSchema,
});
export type ExpenseYear = z.infer<typeof expenseYearSchema>;

// --- Fixed expenses ---

export const FIXED_EXPENSE_STATUSES = ['active', 'paused', 'ended'] as const;
export type FixedExpenseStatus = (typeof FIXED_EXPENSE_STATUSES)[number];

export const FIXED_NAME_MAX = 120;
export const FIXED_NOTE_MAX = 500;

export const fixedExpenseSchema = z.object({
  id: idSchema,
  name: z.string(),
  categoryId: idSchema,
  amount: balanceAmountSchema,
  currency: currencySchema,
  method: paymentMethodSchema.nullable(),
  payee: z.string().nullable(),
  branchId: idSchema.nullable(),
  note: z.string().nullable(),
  firstMonth: monthSchema,
  /** The next month an item will be generated for while active. */
  nextMonth: monthSchema,
  status: z.enum(FIXED_EXPENSE_STATUSES),
  pendingCount: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
});
export type FixedExpense = z.infer<typeof fixedExpenseSchema>;

const fixedFields = {
  name: z.string().trim().min(1).max(FIXED_NAME_MAX),
  categoryId: idSchema,
  amount: positiveAmountSchema,
  method: paymentMethodSchema.nullish().transform((value) => value ?? null),
  payee: optionalText(PAYEE_MAX),
  branchId: idSchema.nullish().transform((value) => value ?? null),
  note: optionalText(FIXED_NOTE_MAX),
};

export const createFixedExpenseSchema = z.object({ ...fixedFields, firstMonth: monthSchema });
export type CreateFixedExpense = z.infer<typeof createFixedExpenseSchema>;
export type CreateFixedExpenseRequest = z.input<typeof createFixedExpenseSchema>;

/** A change applies to months generated after it; the first month is fixed once created. */
export const updateFixedExpenseSchema = z
  .object(fixedFields)
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Nothing to change');
export type UpdateFixedExpense = z.infer<typeof updateFixedExpenseSchema>;
export type UpdateFixedExpenseRequest = z.input<typeof updateFixedExpenseSchema>;

export const FIXED_ITEM_STATUSES = ['pending', 'confirmed', 'skipped'] as const;
export type FixedItemStatus = (typeof FIXED_ITEM_STATUSES)[number];

/** One month of a fixed expense, as the template was when the month was generated. */
export const fixedItemSchema = z.object({
  id: idSchema,
  fixedExpenseId: idSchema,
  month: monthSchema,
  name: z.string(),
  categoryId: idSchema,
  amount: balanceAmountSchema,
  currency: currencySchema,
  method: paymentMethodSchema.nullable(),
  payee: z.string().nullable(),
  branchId: idSchema.nullable(),
  status: z.enum(FIXED_ITEM_STATUSES),
  expenseId: idSchema.nullable(),
  skipReason: z.string().nullable(),
});
export type FixedItem = z.infer<typeof fixedItemSchema>;

export const fixedExpenseDetailSchema = fixedExpenseSchema.extend({
  /** Newest month first. */
  items: z.array(fixedItemSchema),
});
export type FixedExpenseDetail = z.infer<typeof fixedExpenseDetailSchema>;

export const CONFIRM_BATCH_MAX = 50;

/** `POST /expenses/pending/confirm` (Idempotency-Key): each item with what the user confirmed. */
export const confirmItemsSchema = z.object({
  items: z
    .array(z.object({ itemId: idSchema, ...expenseFields }))
    .min(1)
    .max(CONFIRM_BATCH_MAX)
    .refine(
      (items) => new Set(items.map((item) => item.itemId)).size === items.length,
      'An item is listed twice',
    ),
});
export type ConfirmItems = z.infer<typeof confirmItemsSchema>;
export type ConfirmItemsRequest = z.input<typeof confirmItemsSchema>;

export const skipItemSchema = z.object({ reason: optionalText(DESCRIPTION_MAX) });
export type SkipItem = z.infer<typeof skipItemSchema>;

/** Today's card: this month's typed and confirmed expenses (never a mirror), and what waits. */
export const expenseDashboardSchema = z.object({
  month: monthSchema,
  total: expenseTotalSchema,
  recent: z.array(expenseSchema),
  pending: z.array(fixedItemSchema),
});
export type ExpenseDashboard = z.infer<typeof expenseDashboardSchema>;

export const DASHBOARD_RECENT = 8;
