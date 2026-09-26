import { describe, expect, it } from 'vitest';
import { newId } from './id';

describe('newId', () => {
  it('generates uuid v7 identifiers', () => {
    expect(newId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('generates time-ordered identifiers', () => {
    const ids = Array.from({ length: 50 }, () => newId());
    expect([...ids].sort()).toEqual(ids);
  });
});
