import {
  AGING_BUCKETS,
  type AgingBucket,
  OUTSTANDING_GROUPS,
  type OutstandingGroup,
  type OutstandingQuery,
  PAYMENT_METHODS,
  PAYMENT_RANGES,
  type PaymentMethod,
  type PaymentRange,
  type TransactionFilters,
  type TransactionQuery,
} from '@dcm/contracts';
import { z } from 'zod';

/** The Payments screen's tabs (feature 5 §Screens 2). */
export const PAYMENT_TABS = ['transactions', 'outstanding'] as const;
export type PaymentTab = (typeof PAYMENT_TABS)[number];

export const PAYMENT_PAGE_SIZES = [10, 25, 50] as const;
export type PaymentPageSize = (typeof PAYMENT_PAGE_SIZES)[number];

/** The URL of `/payments`: the tab, each tab's filters and the page size. */
export interface PaymentsSearch {
  tab: PaymentTab;
  range: PaymentRange;
  method?: PaymentMethod | undefined;
  q?: string | undefined;
  bucket?: AgingBucket | undefined;
  /** Outstanding by patient, or by payer (families). */
  group: OutstandingGroup;
  size: PaymentPageSize;
}

export const PAYMENTS_SEARCH_DEFAULTS = {
  tab: 'transactions',
  range: '30d',
  group: 'patient',
  size: 25,
} as const;

const searchSchema = z.object({
  tab: z.enum(PAYMENT_TABS).catch('transactions'),
  range: z.enum(PAYMENT_RANGES).catch('30d'),
  method: z.enum(PAYMENT_METHODS).optional().catch(undefined),
  q: z
    .string()
    .trim()
    .max(100)
    .optional()
    .catch(undefined)
    .transform((value) => (value ? value : undefined)),
  bucket: z.enum(AGING_BUCKETS).optional().catch(undefined),
  group: z.enum(OUTSTANDING_GROUPS).catch('patient'),
  size: z.coerce
    .number()
    .pipe(z.union([z.literal(10), z.literal(25), z.literal(50)]))
    .catch(25),
});

export type PaymentsSearchInput = Partial<PaymentsSearch>;

/** Never throws: an unknown or malformed value falls back to its default. */
export function parsePaymentsSearch(raw: unknown): PaymentsSearch {
  return searchSchema.parse(raw && typeof raw === 'object' ? raw : {});
}

export function transactionFiltersOf(search: PaymentsSearch): TransactionFilters {
  return { range: search.range, method: search.method, q: search.q };
}

export function transactionQueryOf(
  search: PaymentsSearch,
  cursor: string | undefined,
): TransactionQuery {
  return {
    ...transactionFiltersOf(search),
    limit: search.size,
    ...(cursor === undefined ? {} : { cursor }),
  };
}

export function outstandingQueryOf(
  search: PaymentsSearch,
  cursor: string | undefined,
): OutstandingQuery {
  return {
    limit: search.size,
    group: search.group,
    q: search.q,
    ...(search.bucket ? { bucket: search.bucket } : {}),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

/** A bucket button: switches to Outstanding filtered to it; on the active bucket, clears it. */
export function toggleBucket(search: PaymentsSearch, bucket: AgingBucket): PaymentsSearch {
  return search.tab === 'outstanding' && search.bucket === bucket
    ? { ...search, bucket: undefined }
    : { ...search, tab: 'outstanding', bucket };
}

/** How many filters of the open tab differ from their default. */
export function activeFilterCount(search: PaymentsSearch): number {
  return search.tab === 'transactions'
    ? [search.range !== '30d', search.method !== undefined, search.q !== undefined].filter(Boolean)
        .length
    : [search.bucket !== undefined, search.q !== undefined].filter(Boolean).length;
}

export function clearFilters(search: PaymentsSearch): PaymentsSearch {
  return { tab: search.tab, range: '30d', group: search.group, size: search.size };
}
