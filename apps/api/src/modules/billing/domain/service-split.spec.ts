import { describe, expect, it } from 'vitest';
import { prorate, splitByService } from './service-split';

const line = (code: string, amount: string) => ({ code, name: code.toUpperCase(), amount });
const cents = (map: ReturnType<typeof splitByService>) =>
  Object.fromEntries([...map].map(([code, row]) => [code, row.cents]));

describe('prorate', () => {
  it('keeps the total and the sign, largest remainder first', () => {
    expect(prorate([1n, 1n, 1n], 100n)).toEqual([34n, 33n, 33n]);
    expect(prorate([2n, 1n], -300n)).toEqual([-200n, -100n]);
    expect(prorate([0n, 0n], 50n)).toEqual([50n, 0n]);
  });
});

describe('splitByService', () => {
  it('spreads a charge over its lines, the visit discount included', () => {
    const history = {
      entries: [
        { id: 'c', amount: '1800.00', lines: [line('crown', '1500.00'), line('xray', '500.00')] },
      ],
    };
    expect(cents(splitByService([history], new Set(['c'])))).toEqual({
      crown: 135000n,
      xray: 45000n,
    });
  });

  it('nets a voided visit to zero per code', () => {
    const history = {
      entries: [
        { id: 'c', amount: '800.00', lines: [line('filling', '800.00')] },
        { id: 'r', amount: '-800.00', lines: [] },
      ],
    };
    expect(cents(splitByService([history], new Set(['c', 'r'])))).toEqual({ filling: 0n });
    expect(cents(splitByService([history], new Set(['r'])))).toEqual({ filling: -80000n });
  });

  it('moves a correction from the old lines to the new', () => {
    const history = {
      entries: [
        { id: 'c', amount: '100.00', lines: [line('a', '100.00')] },
        { id: 'k', amount: '50.00', lines: [line('a', '100.00'), line('b', '50.00')] },
      ],
    };
    const split = splitByService([history], new Set(['k']));
    expect(cents(split)).toEqual({ a: 0n, b: 5000n });
    expect([...split.values()].reduce((sum, row) => sum + row.cents, 0n)).toBe(5000n);
  });
});
