import type { FixedItem } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import { batchTotal, confirmRequest, rowAmount, rowsOf } from './confirm-items';

const item = (id: string, month: string, method: FixedItem['method']): FixedItem => ({
  id,
  fixedExpenseId: 'f1',
  month,
  name: 'Electricity',
  categoryId: 'c1',
  amount: '120.00',
  currency: 'USD',
  method,
  payee: 'EDL',
  branchId: null,
  status: 'pending',
  expenseId: null,
  skipReason: null,
});

describe('the bulk confirmation', () => {
  it('starts each row at its usual amount and method, and totals what is typed', () => {
    const rows = rowsOf([item('a', '2026-09', 'cash'), item('b', '2026-10', 'cash')]);
    expect(batchTotal(rows, 'en')).toBe('240.00');
    const edited = rows.map((row, index) => (index === 0 ? { ...row, amountText: '138.50' } : row));
    expect(batchTotal(edited, 'en')).toBe('258.50');
    expect(confirmRequest(edited, '2026-11-01', 'en')?.items).toEqual([
      expect.objectContaining({ itemId: 'a', amount: '138.50', spentOn: '2026-11-01' }),
      expect.objectContaining({ itemId: 'b', amount: '120.00', description: 'Electricity' }),
    ]);
  });

  it('reads amounts in the UI language', () => {
    const [row] = rowsOf([item('a', '2026-09', 'cash')]);
    if (!row) throw new Error('row');
    expect(rowAmount({ ...row, amountText: '138,50' }, 'fr')).toEqual({ amount: '138.50' });
  });

  it('holds the confirmation while a row has no amount, a zero, or no method', () => {
    const rows = rowsOf([item('a', '2026-09', null), item('b', '2026-10', 'cash')]);
    expect(confirmRequest(rows, '2026-11-01', 'en')).toBeNull();
    const withMethod = rows.map((row) => ({ ...row, method: 'cash' as const }));
    expect(confirmRequest(withMethod, '2026-11-01', 'en')).not.toBeNull();
    const zero = withMethod.map((row, index) => (index === 1 ? { ...row, amountText: '0' } : row));
    expect(confirmRequest(zero, '2026-11-01', 'en')).toBeNull();
    expect(rowAmount({ ...withMethod[0]!, amountText: '' }, 'en')).toEqual({ problem: 'required' });
  });
});
