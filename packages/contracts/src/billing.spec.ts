import { describe, expect, it } from 'vitest';
import {
  adjustmentInputSchema,
  balancesQuerySchema,
  createWithOpeningBalanceSchema,
  balanceAmountSchema,
  openingBalanceInputSchema,
  patientBalanceSchema,
  owingCountSchema,
  patientExportQuerySchema,
} from './billing.js';

const ID_A = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e';
const ID_B = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6f';

describe('openingBalanceInputSchema', () => {
  it('requires a positive amount with at most two decimals', () => {
    expect(openingBalanceInputSchema.safeParse({ amount: '0', asOf: '2026-01-01' }).success).toBe(
      false,
    );
    expect(openingBalanceInputSchema.safeParse({ amount: '-5', asOf: '2026-01-01' }).success).toBe(
      false,
    );
    expect(
      openingBalanceInputSchema.safeParse({ amount: '1.234', asOf: '2026-01-01' }).success,
    ).toBe(false);
    expect(
      openingBalanceInputSchema.safeParse({ amount: '250.50', asOf: '2026-01-01' }).success,
    ).toBe(true);
  });

  it('rejects an asOf date far in the future', () => {
    expect(openingBalanceInputSchema.safeParse({ amount: '10', asOf: '2099-01-01' }).success).toBe(
      false,
    );
  });

  it('treats a blank note as null', () => {
    expect(
      openingBalanceInputSchema.parse({ amount: '10', asOf: '2026-01-01', note: '  ' }).note,
    ).toBeNull();
  });
});

describe('adjustmentInputSchema', () => {
  const base = { effectiveDate: '2026-01-01', reason: 'Correcting a data entry error' };

  it('rejects a zero amount', () => {
    expect(adjustmentInputSchema.safeParse({ ...base, amount: '0' }).success).toBe(false);
    expect(adjustmentInputSchema.safeParse({ ...base, amount: '0.00' }).success).toBe(false);
  });

  it('accepts a signed non-zero amount and requires a reason', () => {
    expect(adjustmentInputSchema.safeParse({ ...base, amount: '-30' }).success).toBe(true);
    expect(
      adjustmentInputSchema.safeParse({ amount: '-30', effectiveDate: '2026-01-01' }).success,
    ).toBe(false);
  });

  it('rejects an effectiveDate far in the future', () => {
    expect(
      adjustmentInputSchema.safeParse({ ...base, amount: '5', effectiveDate: '2099-01-01' })
        .success,
    ).toBe(false);
  });
});

describe('balanceAmountSchema', () => {
  it('takes aggregate sums wider than numeric(12,2), always with two decimals', () => {
    for (const amount of ['19999999999.98', '-5.00', '0.01', '999999999999999999.99']) {
      expect(balanceAmountSchema.safeParse(amount).success, amount).toBe(true);
    }
    for (const amount of ['5', '5.0', '1.234', '1e3', '', '1000000000000000000.00']) {
      expect(balanceAmountSchema.safeParse(amount).success, amount).toBe(false);
    }
  });

  it('is what a patient balance carries', () => {
    expect(
      patientBalanceSchema.safeParse({
        patientId: ID_A,
        balances: [{ amount: '19999999999.98', currency: 'USD' }],
      }).success,
    ).toBe(true);
  });
});

describe('createWithOpeningBalanceSchema', () => {
  it('nests a patient input and an opening balance', () => {
    const result = createWithOpeningBalanceSchema.safeParse({
      patient: { fullName: 'Jane Doe', phone: '03123456' },
      openingBalance: { amount: '100', asOf: '2026-01-01' },
    });
    expect(result.success).toBe(true);
  });
});

describe('balancesQuerySchema', () => {
  it('splits a comma-separated list of ids', () => {
    expect(balancesQuerySchema.parse({ patientIds: `${ID_A},${ID_B}` }).patientIds).toEqual([
      ID_A,
      ID_B,
    ]);
  });

  it('de-duplicates repeated ids in the list', () => {
    expect(balancesQuerySchema.parse({ patientIds: `${ID_A},${ID_B},${ID_A}` }).patientIds).toEqual(
      [ID_A, ID_B],
    );
  });

  it('rejects more than 100 ids and non-uuid entries', () => {
    const many = Array.from(
      { length: 101 },
      (_, i) => `01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5${String(i).padStart(3, '0')}`,
    ).join(',');
    expect(balancesQuerySchema.safeParse({ patientIds: many }).success).toBe(false);
    expect(balancesQuerySchema.safeParse({ patientIds: 'not-a-uuid' }).success).toBe(false);
  });
});

describe('patientExportQuerySchema', () => {
  it('drops paging and accepts an optional comma-separated id filter', () => {
    const parsed = patientExportQuerySchema.parse({ ids: `${ID_A},${ID_B}` });
    expect(parsed.ids).toEqual([ID_A, ID_B]);
    expect(parsed).not.toHaveProperty('page');
    expect(parsed).not.toHaveProperty('size');
  });

  it('de-duplicates repeated ids and caps the filter at 100 (not 1000)', () => {
    expect(patientExportQuerySchema.parse({ ids: `${ID_A},${ID_A}` }).ids).toEqual([ID_A]);
    const many = Array.from(
      { length: 101 },
      (_, i) => `01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5${String(i).padStart(3, '0')}`,
    ).join(',');
    expect(patientExportQuerySchema.safeParse({ ids: many }).success).toBe(false);
  });

  it('works without ids, keeping the list query filters', () => {
    expect(patientExportQuerySchema.parse({ view: 'archived' }).view).toBe('archived');
  });
});

describe('owingCountSchema', () => {
  it('is a non-negative integer count', () => {
    expect(owingCountSchema.parse({ count: 3 })).toEqual({ count: 3 });
    expect(owingCountSchema.safeParse({ count: -1 }).success).toBe(false);
    expect(owingCountSchema.safeParse({ count: 1.5 }).success).toBe(false);
  });
});
