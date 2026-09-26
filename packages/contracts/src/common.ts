import { z } from 'zod';

export const idSchema = z.uuid();

export const isoDateTimeSchema = z.iso.datetime({ offset: true });

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
