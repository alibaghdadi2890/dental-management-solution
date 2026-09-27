import { z } from 'zod';

export const idSchema = z.uuid();

export const isoDateTimeSchema = z.iso.datetime({ offset: true });

/** ISO calendar date, `YYYY-MM-DD`, with no time-of-day or time zone (CLAUDE.md §7). */
export const isoDateSchema = z.iso.date();

/**
 * An ISO date that isn't obviously in the future, with one day of tolerance so a tenant whose
 * local "today" (e.g. `Asia/Baghdad`, UTC+3) is already past midnight UTC isn't rejected by a
 * schema that only knows UTC "now". This is a coarse client-side guard, not the source of truth:
 * the server re-checks against the tenant's own today, in the tenant's time zone, at write time.
 */
export function notFutureDateSchema(message = 'Date cannot be in the future') {
  return isoDateSchema.refine((date) => {
    const now = new Date();
    const tolerant = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
    );
    return date <= tolerant.toISOString().slice(0, 10);
  }, message);
}

/** ISO 3166-1 alpha-2 country code, upper-case (tenant country, ADR pending — feature 3 Q3). */
export const countrySchema = z
  .string()
  .regex(/^[A-Z]{2}$/, 'Expected an ISO 3166-1 alpha-2 country code');

function isKnownTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** A person's, clinic's or place's display name. */
export const nameSchema = z.string().trim().min(1).max(120);

/** Optional free text: blank input means "not set". */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

/** IANA time zone name, e.g. `Asia/Baghdad`. */
export const timeZoneSchema = z.string().refine(isKnownTimeZone, 'Unknown IANA time zone');

/** App languages; Arabic is right-to-left. */
export const LOCALES = ['en', 'ar', 'fr'] as const;
export const localeSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof localeSchema>;

/** ISO 4217 alphabetic code. */
export const currencySchema = z.string().regex(/^[A-Z]{3}$/, 'Expected an ISO 4217 currency code');

/** Decimal string that fits Postgres `numeric(12,2)`. Money is never a float. */
export const decimalAmountSchema = z
  .string()
  .regex(/^-?\d{1,10}(\.\d{1,2})?$/, 'Expected a decimal amount with at most 2 decimals');

export const moneySchema = z.object({
  amount: decimalAmountSchema,
  currency: currencySchema,
});
export type Money = z.infer<typeof moneySchema>;

export const cursorPageQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type CursorPageQuery = z.infer<typeof cursorPageQuerySchema>;

export function cursorPageSchema<TItem extends z.ZodType>(item: TItem) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

/**
 * Offset pagination, for the lists bounded enough (thousands, not millions) that a pager with
 * page numbers and a `total` is worth the cost of a count query (ADR-0018 amends CLAUDE.md §12).
 */
export function offsetPageSchema<TItem extends z.ZodType>(item: TItem) {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1),
    size: z.number().int().min(1),
  });
}

/**
 * RFC 7807 problem details with a stable machine-readable `code` (CLAUDE.md §12). Extension
 * members are listed explicitly so clients can rely on their types.
 */
export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  detail: z.string().optional(),
  instance: z.string().optional(),
  requestId: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), code: z.string(), message: z.string() })).optional(),
  /** `auth.invalid_credentials`: failed sign-ins left before the account locks. */
  attemptsLeft: z.number().int().nonnegative().optional(),
  /** `auth.account_locked`: when sign-in is allowed again. */
  lockedUntil: isoDateTimeSchema.optional(),
});
export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
