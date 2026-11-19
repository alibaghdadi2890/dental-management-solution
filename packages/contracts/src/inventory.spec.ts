import { describe, expect, it } from 'vitest';
import {
  formatGoodsReceiptNumber,
  lineAmount,
  parseGoodsReceiptNumber,
  receiveSchema,
  splitPacks,
  type StockState,
  stockLabels,
  toUnits,
} from './inventory.js';

describe('packs and units', () => {
  it('turns packs into units and back', () => {
    expect(toUnits(5, 'pack', 100)).toBe(500);
    expect(toUnits(5, 'unit', 100)).toBe(5);
    expect(toUnits(3, 'pack', null)).toBe(3);
    expect(splitPacks(720, 100)).toEqual({ packs: 7, units: 20 });
    expect(splitPacks(50, 50)).toEqual({ packs: 1, units: 0 });
    expect(splitPacks(7, null)).toEqual({ packs: 0, units: 7 });
    expect(splitPacks(-110, 100)).toEqual({ packs: -1, units: -10 });
    // A pack may hold a single unit: a box of one bottle.
    expect(toUnits(3, 'pack', 1)).toBe(3);
    expect(splitPacks(3, 1)).toEqual({ packs: 3, units: 0 });
  });

  it('prices a line per pack or per unit, to the cent', () => {
    expect(lineAmount('9.00', 'pack', 500, 100)).toBe('45.00');
    expect(lineAmount('22.00', 'pack', 200, 50)).toBe('88.00');
    expect(lineAmount('0.08', 'unit', 300, 100)).toBe('24.00');
    expect(lineAmount('10.00', 'pack', 1, 3)).toBe('3.33');
    expect(lineAmount('0', 'unit', 5, null)).toBe('0.00');
  });
});

describe('goods receipt numbers', () => {
  it('formats and parses', () => {
    expect(formatGoodsReceiptNumber(12)).toBe('GR-000012');
    expect(parseGoodsReceiptNumber('GR-000012')).toBe(12);
    expect(parseGoodsReceiptNumber('gr12')).toBe(12);
    expect(parseGoodsReceiptNumber('12')).toBe(12);
    expect(parseGoodsReceiptNumber('gloves')).toBeNull();
  });
});

describe('stockLabels', () => {
  const base: StockState = {
    active: true,
    onHand: 500,
    reorderLevel: 200,
    everStocked: true,
    expiries: [],
    orderedOn: null,
    toCount: false,
  };
  const today = '2026-11-19';
  const kinds = (state: Partial<StockState>, on = today) =>
    stockLabels({ ...base, ...state }, on, 60).map((label) => label.kind);

  it('says out, low and nothing at the levels', () => {
    expect(kinds({ onHand: 0 })).toEqual(['out']);
    expect(kinds({ onHand: 200 })).toEqual(['low']);
    expect(kinds({ onHand: 201 })).toEqual([]);
    expect(kinds({ onHand: 0, reorderLevel: null, everStocked: false })).toEqual([]);
    expect(kinds({ onHand: 0, reorderLevel: null, everStocked: true })).toEqual(['out']);
    expect(kinds({ onHand: 0, active: false })).toEqual([]);
  });

  it('lets ordered replace low and out, and keeps the others', () => {
    expect(stockLabels({ ...base, onHand: 50, orderedOn: today }, today, 60)).toEqual([
      { kind: 'ordered', date: today },
    ]);
    expect(kinds({ onHand: 0, orderedOn: today, toCount: true })).toEqual(['ordered', 'to_count']);
  });

  it('dates expiry in the clinic day, around midnight', () => {
    // Composite A2: 10 Jan 2027 is within 60 days of 19 Nov 2026; 28 Feb 2027 is not.
    expect(stockLabels({ ...base, expiries: ['2027-01-10'] }, today, 60)).toEqual([
      { kind: 'expiring', date: '2027-01-10' },
    ]);
    expect(kinds({ expiries: ['2027-02-28'] })).toEqual([]);
    expect(kinds({ expiries: ['2026-11-15'] })).toEqual(['expired']);
    // A batch expiring today is still good today and expired tomorrow.
    expect(kinds({ expiries: [today] })).toEqual(['expiring']);
    expect(kinds({ expiries: [today] }, '2026-11-20')).toEqual(['expired']);
  });

  it('orders the labels most urgent first', () => {
    expect(kinds({ onHand: 10, expiries: ['2026-11-01', '2026-12-01'], toCount: true })).toEqual([
      'expired',
      'low',
      'expiring',
      'to_count',
    ]);
  });
});

describe('receiveSchema', () => {
  const line = { itemId: '0195f000-0000-7000-8000-000000000001', quantity: 500 };
  const branchId = '0195f000-0000-7000-8000-000000000002';
  it('needs a supplier or a payee, not both', () => {
    expect(
      receiveSchema.safeParse({ branchId, receivedOn: '2026-11-19', lines: [line] }).success,
    ).toBe(false);
    expect(
      receiveSchema.safeParse({
        payee: 'Pharmacy Rima',
        branchId,
        receivedOn: '2026-11-19',
        lines: [line],
      }).success,
    ).toBe(true);
  });
});
