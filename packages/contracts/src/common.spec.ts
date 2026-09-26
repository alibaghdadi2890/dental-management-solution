import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  cursorPageQuerySchema,
  cursorPageSchema,
  idSchema,
  moneySchema,
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
