import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  aggregateAmountSchema,
  blankToUndefined,
  countrySchema,
  cursorPageQuerySchema,
  cursorPageSchema,
  idSchema,
  localeSchema,
  moneySchema,
  notFutureDateSchema,
  offsetPageSchema,
  optionalDate,
  problemDetailsSchema,
  timeZoneSchema,
} from './common.js';

describe('idSchema', () => {
  it('accepts a uuid v7', () => {
    expect(idSchema.safeParse('01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e').success).toBe(true);
  });

  it('rejects non-uuids', () => {
    expect(idSchema.safeParse('42').success).toBe(false);
  });
});

describe('moneySchema', () => {
  it('accepts decimal strings with at most two decimals and an ISO currency', () => {
    expect(moneySchema.safeParse({ amount: '1234.50', currency: 'USD' }).success).toBe(true);
    expect(moneySchema.safeParse({ amount: '-30', currency: 'EUR' }).success).toBe(true);
  });

  it('rejects floats, extra precision and bad currencies', () => {
    expect(moneySchema.safeParse({ amount: 12.5, currency: 'USD' }).success).toBe(false);
    expect(moneySchema.safeParse({ amount: '1.005', currency: 'USD' }).success).toBe(false);
    expect(moneySchema.safeParse({ amount: '10', currency: 'usd' }).success).toBe(false);
  });

  it('rejects amounts that overflow numeric(12,2)', () => {
    expect(moneySchema.safeParse({ amount: '12345678901', currency: 'USD' }).success).toBe(false);
  });
});

describe('aggregateAmountSchema', () => {
  it('accepts wide sums with exactly 2 decimals', () => {
    expect(aggregateAmountSchema.safeParse('123456789012345.67').success).toBe(true);
    expect(aggregateAmountSchema.safeParse('-30.50').success).toBe(true);
    expect(aggregateAmountSchema.safeParse('0.00').success).toBe(true);
  });

  it('rejects anything but exactly 2 decimals', () => {
    expect(aggregateAmountSchema.safeParse('30').success).toBe(false);
    expect(aggregateAmountSchema.safeParse('30.5').success).toBe(false);
    expect(aggregateAmountSchema.safeParse('30.500').success).toBe(false);
  });
});

describe('timeZoneSchema', () => {
  it('accepts IANA names and rejects unknown zones', () => {
    expect(timeZoneSchema.safeParse('Asia/Baghdad').success).toBe(true);
    expect(timeZoneSchema.safeParse('Mars/Olympus').success).toBe(false);
  });
});

describe('cursor pagination', () => {
  it('coerces and bounds the limit, defaulting to 25', () => {
    expect(cursorPageQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(cursorPageQuerySchema.parse({ limit: '10', cursor: 'abc' })).toEqual({
      limit: 10,
      cursor: 'abc',
    });
    expect(cursorPageQuerySchema.safeParse({ limit: '1000' }).success).toBe(false);
  });

  it('wraps an item schema into a page', () => {
    const page = cursorPageSchema(z.object({ id: z.string() }));
    expect(page.parse({ items: [{ id: 'a' }], nextCursor: null })).toEqual({
      items: [{ id: 'a' }],
      nextCursor: null,
    });
  });
});

describe('problemDetailsSchema', () => {
  it('requires a stable code alongside RFC 7807 fields', () => {
    const problem = {
      type: 'urn:dcm:problem:validation_failed',
      title: 'Validation failed',
      status: 400,
      code: 'validation_failed',
      requestId: 'req-123',
      errors: [{ path: 'name', code: 'too_small', message: 'Required' }],
    };
    expect(problemDetailsSchema.parse(problem)).toEqual(problem);
    expect(problemDetailsSchema.safeParse({ ...problem, code: undefined }).success).toBe(false);
  });
});

describe('problem details extensions', () => {
  it('keeps sign-in extension members', () => {
    const problem = {
      type: 'urn:dcm:problem:auth.invalid_credentials',
      title: 'Authentication required',
      status: 401,
      code: 'auth.invalid_credentials',
      attemptsLeft: 3,
    };
    expect(problemDetailsSchema.parse(problem)).toEqual(problem);
    expect(
      problemDetailsSchema.parse({ ...problem, lockedUntil: '2026-09-26T10:15:00.000Z' }),
    ).toMatchObject({ lockedUntil: '2026-09-26T10:15:00.000Z' });
  });
});

describe('localeSchema', () => {
  it('accepts the three app languages', () => {
    expect(localeSchema.options).toEqual(['en', 'ar', 'fr']);
    expect(localeSchema.safeParse('de').success).toBe(false);
  });
});

describe('countrySchema', () => {
  it.each(['LB', 'FR', 'GB'])('accepts %j', (country) => {
    expect(countrySchema.safeParse(country).success).toBe(true);
  });

  it.each(['lb', 'LBN', '', 'UK', 'ZZ'])('rejects %j', (country) => {
    expect(countrySchema.safeParse(country).success).toBe(false);
  });
});

describe('notFutureDateSchema', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T10:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts one day of tolerance and rejects the day after that', () => {
    const schema = notFutureDateSchema();
    expect(schema.safeParse('2026-06-16').success).toBe(true);
    expect(schema.safeParse('2026-06-17').success).toBe(false);
  });

  it('reports exactly one issue for a malformed date, not both format and future errors', () => {
    const result = notFutureDateSchema().safeParse('abc');
    expect(result.success).toBe(false);
    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]?.message).not.toMatch(/future/i);
  });
});

describe('optionalDate', () => {
  it('treats blank, null and absent as null', () => {
    const schema = z.object({ date: optionalDate() });
    expect(schema.parse({ date: '' }).date).toBeNull();
    expect(schema.parse({ date: null }).date).toBeNull();
    expect(schema.parse({}).date).toBeNull();
  });

  it('validates a present date the same way notFutureDateSchema does', () => {
    expect(optionalDate().safeParse('2099-01-01').success).toBe(false);
    expect(optionalDate().safeParse('2020-01-01').success).toBe(true);
    expect(optionalDate().safeParse('not-a-date').success).toBe(false);
  });
});

describe('blankToUndefined', () => {
  it('treats a blank string as absent, applying the wrapped default', () => {
    const schema = blankToUndefined(z.coerce.number().int().min(1).default(1));
    expect(schema.parse('')).toBe(1);
    expect(schema.parse('5')).toBe(5);
    expect(schema.parse(undefined)).toBe(1);
  });

  it('leaves a non-blank invalid value to fail the wrapped schema', () => {
    const schema = blankToUndefined(z.enum(['a', 'b']).optional());
    expect(schema.parse('')).toBeUndefined();
    expect(schema.safeParse('c').success).toBe(false);
  });
});

describe('offsetPageSchema', () => {
  it('wraps an item schema into a page with total, page and size', () => {
    const page = offsetPageSchema(z.string());
    const value = { items: ['a', 'b'], total: 2, page: 1, size: 25 };
    expect(page.parse(value)).toEqual(value);
    expect(page.safeParse({ ...value, total: -1 }).success).toBe(false);
    expect(page.safeParse({ ...value, page: 0 }).success).toBe(false);
  });
});
