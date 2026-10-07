import { isSupportedCountry } from 'libphonenumber-js/max';
import type { CountryCode } from 'libphonenumber-js/max';
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
  return isoDateSchema.refine(
    (date) => {
      const now = new Date();
      const tolerant = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
      );
      return date <= tolerant.toISOString().slice(0, 10);
    },
    {
      message,
      // Skip this check once the format check has already failed, so a malformed date (e.g.
      // 'abc') reports one issue, not "Invalid ISO date" plus a confusing "in the future" too.
      when: (payload) => payload.issues.length === 0,
    },
  );
}

/**
 * An optional ISO date: blank, `null` or absent → `null` (mirrors `optionalText`); a present
 * value is validated by `notFutureDateSchema`. Callers that need a different floor/ceiling (e.g.
 * a date of birth's 1900 floor) `.refine()` the result further.
 */
export function optionalDate(message?: string) {
  return z
    .string()
    .trim()
    .nullish()
    .transform((value) => (value ? value : null))
    .pipe(z.union([z.null(), notFutureDateSchema(message)]));
}

/**
 * ISO 3166-1 alpha-2 country code, upper-case, and one `libphonenumber-js` actually has dialling
 * data for — its output type is the library's own `CountryCode`, so `normalizePhone` can take it
 * directly with no cast (the tenant country: patients design spec, Q3).
 */
export const countrySchema = z
  .string()
  .regex(/^[A-Z]{2}$/, 'Expected an ISO 3166-1 alpha-2 country code')
  .refine((value): value is CountryCode => isSupportedCountry(value), 'Unsupported country code');

/**
 * Treats a blank query-string value (`?dentist=`) the same as an absent one, so URL search params
 * that a client cleared don't fail validation. Wrap the field's whole schema, `.default()`/
 * `.optional()` included, so the wrapped schema still sees a clean "absent" input (design Q6).
 */
export function blankToUndefined<TSchema extends z.ZodType>(schema: TSchema) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema,
  );
}

function isKnownTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * A patient number: `P-` + at least 6 digits, zero-padded (`P-000001`), minted by the patient
 * create transaction. Here rather than in `patients.ts` because `contacts.ts` needs it too, and
 * `patients.ts` imports `contacts.ts` (no import cycle between the two).
 */
export const displayNumberSchema = z.string().regex(/^P-\d{6,}$/, 'Expected a patient number');

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

/**
 * An aggregate amount: a sum or a server-computed total (a ledger balance, `visitMoney`'s
 * subtotal/discount/total), always formatted with exactly 2 decimals — unlike
 * `decimalAmountSchema`, which also accepts 0 or 1 decimal and is for a single input bounded by
 * one `numeric(12,2)` column. A sum can exceed 10 integer digits, so this allows more.
 */
export const aggregateAmountSchema = z
  .string()
  .regex(/^-?\d{1,18}\.\d{2}$/, 'Expected a decimal amount with exactly 2 decimals');

/** Splits a comma-separated id list (a query string), trims each, drops empties and de-dupes
 * (order preserved). */
export function commaSeparatedIds(max: number) {
  return z
    .string()
    .min(1)
    .transform((value) => {
      const ids = value
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
      return Array.from(new Set(ids));
    })
    .pipe(z.array(idSchema).min(1).max(max));
}

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

/** Query-string booleans arrive as text; wrap in `blankToUndefined` so blank means "not set". */
export const queryBooleanSchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();
