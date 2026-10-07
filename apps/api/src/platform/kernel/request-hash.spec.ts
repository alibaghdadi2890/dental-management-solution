import { describe, expect, it } from 'vitest';
import { requestHash } from './request-hash';

describe('requestHash', () => {
  it('ignores key order and absent fields', () => {
    const a = requestHash({ amount: '10.00', note: undefined, nested: { b: 1, a: [1, 2] } });
    const b = requestHash({ nested: { a: [1, 2], b: 1 }, amount: '10.00' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('tells apart different values, null from absent, and array order', () => {
    const base = requestHash({ amount: '10.00', tags: ['a', 'b'] });
    expect(requestHash({ amount: '10.01', tags: ['a', 'b'] })).not.toBe(base);
    expect(requestHash({ amount: '10.00', tags: ['b', 'a'] })).not.toBe(base);
    expect(requestHash({ amount: '10.00', tags: ['a', 'b'], note: null })).not.toBe(base);
  });
});
