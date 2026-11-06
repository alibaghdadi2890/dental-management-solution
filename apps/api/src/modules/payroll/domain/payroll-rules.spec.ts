import { describe, expect, it } from 'vitest';
import {
  assertAdjustable,
  assertConfirmable,
  assertEffectiveMonth,
  assertPaidInside,
  employedMonths,
  isEmployedIn,
  lineNotes,
  salaryFor,
} from './payroll-rules';

const rima = { hireDate: '2026-03-01', payrollFrom: '2026-09', endDate: null };

describe('employment', () => {
  it('has a line every month from the first payroll month to now', () => {
    expect(employedMonths(rima, '2026-11')).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(employedMonths({ ...rima, payrollFrom: '2026-01' }, '2026-04')).toEqual([
      '2026-03',
      '2026-04',
    ]);
  });

  it('ends with the month they left, that month included', () => {
    const left = { ...rima, endDate: '2026-11-12' };
    expect(employedMonths(left, '2027-01')).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(isEmployedIn(left, '2026-11', '2027-01')).toBe(true);
    expect(isEmployedIn(left, '2026-12', '2027-01')).toBe(false);
    expect(isEmployedIn(rima, '2026-12', '2026-11')).toBe(false);
  });

  it('notes the hire and end days on their months, nothing pro-rated', () => {
    const hiredMidMonth = { hireDate: '2026-11-17', payrollFrom: '2026-11', endDate: '2027-02-03' };
    expect(lineNotes(hiredMidMonth, '2026-11')).toEqual({ joinedOn: '2026-11-17', leftOn: null });
    expect(lineNotes(hiredMidMonth, '2027-02')).toEqual({ joinedOn: null, leftOn: '2027-02-03' });
    expect(lineNotes(hiredMidMonth, '2026-12')).toEqual({ joinedOn: null, leftOn: null });
  });

  it('keeps every paid month inside the employment', () => {
    expect(() => {
      assertPaidInside({ ...rima, endDate: '2026-10-31' }, ['2026-11']);
    }).toThrow(/paid/);
    expect(() => {
      assertPaidInside({ ...rima, payrollFrom: '2026-10' }, ['2026-09']);
    }).toThrow(/paid/);
    expect(() => {
      assertPaidInside(rima, ['2026-09', '2026-10']);
    }).not.toThrow();
  });
});

describe('salaries', () => {
  const entries = [
    { amount: '800.00', effectiveMonth: '2026-03' },
    { amount: '900.00', effectiveMonth: '2026-11' },
    { amount: '950.00', effectiveMonth: '2026-11' },
  ];

  it('takes the entry in force, the later-created winning a tie', () => {
    expect(salaryFor(entries, '2026-02')).toBeNull();
    expect(salaryFor(entries, '2026-10')?.amount).toBe('800.00');
    expect(salaryFor(entries, '2026-11')?.amount).toBe('950.00');
    expect(salaryFor(entries, '2027-05')?.amount).toBe('950.00');
  });

  it('back-dates only after the last paid month', () => {
    expect(() => {
      assertEffectiveMonth('2026-10', '2026-10');
    }).toThrow(/paid up to/);
    expect(() => {
      assertEffectiveMonth('2026-11', '2026-10');
    }).not.toThrow();
    expect(() => {
      assertEffectiveMonth('2026-01', null);
    }).not.toThrow();
  });
});

describe('lines', () => {
  const bonus = { kind: 'bonus', amount: '50' } as const;
  const deduction = { kind: 'deduction', amount: '20' } as const;

  it('confirms a pending line at the net the user saw', () => {
    const line = { status: 'pending', base: '900.00', adjustments: [bonus, deduction] };
    expect(assertConfirmable({ ...line, expectedNet: '930' })).toBe(93_000n);
    expect(() => assertConfirmable({ ...line, expectedNet: '900' })).toThrow(/changed/);
    expect(() => assertConfirmable({ ...line, status: 'paid', expectedNet: '930' })).toThrow(
      /not pending/,
    );
  });

  it('needs a salary and a net above zero', () => {
    expect(() =>
      assertConfirmable({ status: 'pending', base: null, adjustments: [], expectedNet: '0' }),
    ).toThrow(/no salary/);
    expect(() =>
      assertConfirmable({
        status: 'pending',
        base: '20',
        adjustments: [deduction],
        expectedNet: '0',
      }),
    ).toThrow(/skip/);
  });

  it('refuses adjustments that take the net below zero, or on a line not pending', () => {
    expect(() => {
      assertAdjustable('pending', '10', [deduction]);
    }).toThrow(/below zero/);
    expect(() => {
      assertAdjustable('skipped', '900', [bonus]);
    }).toThrow(/not pending/);
    expect(() => {
      assertAdjustable('pending', null, [deduction]);
    }).not.toThrow();
  });
});
