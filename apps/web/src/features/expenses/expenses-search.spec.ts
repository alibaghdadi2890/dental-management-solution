import { describe, expect, it } from 'vitest';
import { filterOf, parseExpensesSearch } from './expenses-search';

const CATEGORY = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

describe('the Expenses URL', () => {
  it('defaults the History to the current month', () => {
    expect(filterOf(parseExpensesSearch({}), '2026-11')).toMatchObject({
      from: '2026-11-01',
      to: '2026-11-30',
    });
  });

  it('keeps a month, or a range that is in order, and drops the rest', () => {
    expect(parseExpensesSearch({ month: '2026-02', category: CATEGORY, voided: 'true' })).toEqual({
      month: '2026-02',
      category: CATEGORY,
      voided: true,
    });
    expect(filterOf(parseExpensesSearch({ month: '2026-02' }), '2026-11').to).toBe('2026-02-28');
    expect(parseExpensesSearch({ from: '2026-01-01', to: '2026-03-31', month: '2026-02' })).toEqual(
      { from: '2026-01-01', to: '2026-03-31' },
    );
    expect(parseExpensesSearch({ from: '2026-03-31', to: '2026-01-01' })).toEqual({});
  });

  it('drops anything malformed instead of failing', () => {
    expect(
      parseExpensesSearch({
        tab: 'nope',
        month: '2026-13',
        category: 'x',
        method: 'gold',
        year: 'y',
      }),
    ).toEqual({});
    expect(parseExpensesSearch({ tab: 'year', year: '2025' })).toEqual({ tab: 'year', year: 2025 });
  });
});
