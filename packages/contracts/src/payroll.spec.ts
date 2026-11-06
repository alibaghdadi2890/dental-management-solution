import { describe, expect, it } from 'vitest';
import {
  adjustmentEffect,
  confirmLinesSchema,
  createEmployeeSchema,
  netPay,
  payrollAdjustmentSchema,
  rawNetCents,
} from './payroll.js';

describe('net pay', () => {
  it('adds bonuses, subtracts deductions typed positive, and takes Other signed', () => {
    const adjustments = [
      { kind: 'bonus', amount: '50' },
      { kind: 'deduction', amount: '20' },
      { kind: 'other', amount: '-5.50' },
    ] as const;
    expect(adjustmentEffect(adjustments[1])).toBe(-2000n);
    expect(netPay('900.00', adjustments)).toBe('924.50');
  });

  it('never goes below zero, and is zero without a base', () => {
    expect(rawNetCents('100', [{ kind: 'deduction', amount: '150' }])).toBe(-5000n);
    expect(netPay('100', [{ kind: 'deduction', amount: '150' }])).toBe('0.00');
    expect(netPay(null, [{ kind: 'bonus', amount: '10' }])).toBe('0.00');
  });
});

describe('payroll inputs', () => {
  it('refuses a zero or negative bonus or deduction, and a zero Other', () => {
    const parse = (kind: string, amount: string) =>
      payrollAdjustmentSchema.safeParse({ kind, label: 'x', amount }).success;
    expect(parse('bonus', '-5')).toBe(false);
    expect(parse('deduction', '0')).toBe(false);
    expect(parse('other', '0.00')).toBe(false);
    expect(parse('other', '-5')).toBe(true);
  });

  it('starts payroll on or after the hire month', () => {
    const input = {
      fullName: 'Rima',
      hireDate: '2026-03-01',
      payrollFrom: '2026-02',
      salary: { amount: '800', effectiveMonth: '2026-03' },
    };
    expect(createEmployeeSchema.safeParse(input).success).toBe(false);
    expect(createEmployeeSchema.safeParse({ ...input, payrollFrom: '2026-03' }).success).toBe(true);
  });

  it('refuses the same line twice in a batch', () => {
    const line = {
      employeeId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      month: '2026-11',
      paidOn: '2026-11-05',
      method: 'cash',
      net: '930',
    };
    expect(confirmLinesSchema.safeParse({ lines: [line, line] }).success).toBe(false);
  });
});
