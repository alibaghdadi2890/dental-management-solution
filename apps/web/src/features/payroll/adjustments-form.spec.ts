import { describe, expect, it } from 'vitest';
import { preview, readRow } from './adjustments-form';

describe('the adjustments form', () => {
  it('shows the net live: a bonus adds, a deduction typed positive subtracts', () => {
    const rows = [
      { kind: 'bonus', label: 'Eid bonus', amountText: '50' },
      { kind: 'deduction', label: 'Late', amountText: '20' },
    ] as const;
    expect(preview('900.00', rows, 'en')).toEqual({
      adjustments: [
        { kind: 'bonus', label: 'Eid bonus', amount: '50' },
        { kind: 'deduction', label: 'Late', amount: '20' },
      ],
      net: '930.00',
      negative: false,
    });
  });

  it('takes Other signed, in the UI language', () => {
    expect(readRow({ kind: 'other', label: 'Correction', amountText: '-12,50' }, 'fr')).toEqual({
      adjustment: { kind: 'other', label: 'Correction', amount: '-12.50' },
    });
  });

  it('flags deductions larger than the salary, and keeps the net at zero', () => {
    const result = preview('100', [{ kind: 'deduction', label: 'Loan', amountText: '150' }], 'en');
    expect(result).toMatchObject({ net: '0.00', negative: true });
  });

  it('needs a label and an amount above zero', () => {
    expect(readRow({ kind: 'bonus', label: ' ', amountText: '5' }, 'en')).toEqual({
      problem: 'label',
    });
    expect(readRow({ kind: 'deduction', label: 'x', amountText: '0' }, 'en')).toEqual({
      problem: 'amount',
    });
    expect(readRow({ kind: 'other', label: 'x', amountText: '' }, 'en')).toEqual({
      problem: 'signed',
    });
    expect(
      preview('900', [{ kind: 'bonus', label: '', amountText: '5' }], 'en').adjustments,
    ).toBeNull();
  });
});
