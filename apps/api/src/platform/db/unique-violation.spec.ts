import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from './unique-violation';

const pgError = { code: '23505', constraint: 'tenants_slug_unique' };

describe('isUniqueViolation', () => {
  it('recognises the pg error directly or wrapped by Drizzle', () => {
    expect(isUniqueViolation(pgError)).toBe(true);
    expect(isUniqueViolation(Object.assign(new Error('query failed'), { cause: pgError }))).toBe(
      true,
    );
  });

  it('can match a specific constraint', () => {
    expect(isUniqueViolation(pgError, 'tenants_slug_unique')).toBe(true);
    expect(isUniqueViolation(pgError, 'branches_name_unique')).toBe(false);
  });

  it('ignores everything else', () => {
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
