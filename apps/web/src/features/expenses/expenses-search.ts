import { idSchema, isoDateSchema, paymentMethodSchema } from '@dcm/contracts';
import { z } from 'zod';
import { lastDayOf, parseMonth } from '@/features/compensation/months';
import type { ExpenseFilter } from './expenses-api';

export const EXPENSE_TABS = ['history', 'year', 'fixed', 'categories'] as const;
export type ExpenseTab = (typeof EXPENSE_TABS)[number];

/**
 * The Expenses screen's URL (A4): the tab, then the History filter — a month (the current one
 * when absent) or a `from`–`to` range, category, branch, method, search and *Show voided* — and
 * the Year tab's year. Anything malformed is dropped, never an error.
 */
export interface ExpensesSearch {
  tab?: Exclude<ExpenseTab, 'history'> | undefined;
  month?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  category?: string | undefined;
  branch?: string | undefined;
  method?: ExpenseFilter['method'];
  q?: string | undefined;
  voided?: true | undefined;
  year?: number | undefined;
}

const schema = z.object({
  tab: z.enum(['year', 'fixed', 'categories']).optional().catch(undefined),
  month: z
    .string()
    .optional()
    .catch(undefined)
    .transform((value) => parseMonth(value, '') || undefined),
  from: isoDateSchema.optional().catch(undefined),
  to: isoDateSchema.optional().catch(undefined),
  category: idSchema.optional().catch(undefined),
  branch: idSchema.optional().catch(undefined),
  method: paymentMethodSchema.optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
  voided: z
    .union([z.literal(true), z.literal('true')])
    .optional()
    .catch(undefined)
    .transform((value) => (value === undefined ? undefined : (true as const))),
  year: z.coerce.number().int().min(2000).max(2100).optional().catch(undefined),
});

export function parseExpensesSearch(raw: Record<string, unknown>): ExpensesSearch {
  const parsed = schema.parse(raw);
  const range = parsed.from && parsed.to && parsed.from <= parsed.to;
  return Object.fromEntries(
    Object.entries({
      ...parsed,
      q: parsed.q === '' ? undefined : parsed.q,
      from: range ? parsed.from : undefined,
      to: range ? parsed.to : undefined,
      month: range ? undefined : parsed.month,
    }).filter(([, value]) => value !== undefined),
  );
}

/** The History filter the URL asks for; the month defaults to the current one. */
export function filterOf(search: ExpensesSearch, currentMonth: string): ExpenseFilter {
  const month = search.month ?? currentMonth;
  return {
    from: search.from ?? `${month}-01`,
    to: search.to ?? lastDayOf(month),
    categoryId: search.category,
    branchId: search.branch,
    method: search.method,
    q: search.q,
    includeVoided: search.voided,
  };
}
