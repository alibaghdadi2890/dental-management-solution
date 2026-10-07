import { describe, expect, it } from 'vitest';
import { idempotencyKeys } from './idempotency';

describe('idempotencyKeys', () => {
  it('reuses the key while the payload is the same, and mints one when it changes', () => {
    const keyFor = idempotencyKeys();
    const first = keyFor({ fullName: 'Rami', amount: '10.00' });
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(keyFor({ fullName: 'Rami', amount: '10.00' })).toBe(first);
    const edited = keyFor({ fullName: 'Rami', amount: '12.00' });
    expect(edited).not.toBe(first);
    // Back to the first payload is still a new submission: only the last one is remembered.
    expect(keyFor({ fullName: 'Rami', amount: '10.00' })).not.toBe(first);
  });

  it('keeps forms apart', () => {
    expect(idempotencyKeys()({ a: 1 })).not.toBe(idempotencyKeys()({ a: 1 }));
  });
});
