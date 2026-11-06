import { describe, expect, it } from 'vitest';
import { catchUp, resumedNextMonth } from './catch-up';
import {
  assertCategoryChange,
  assertDescribed,
  assertNameFree,
  assertSelectable,
} from './categories';

describe('catchUp', () => {
  it('gives an active template every month from its next month through now, then moves on', () => {
    expect(catchUp({ status: 'active', nextMonth: '2026-09' }, '2026-11')).toEqual({
      months: ['2026-09', '2026-10', '2026-11'],
      nextMonth: '2026-12',
    });
  });

  it('crosses the year', () => {
    expect(catchUp({ status: 'active', nextMonth: '2026-12' }, '2027-01').months).toEqual([
      '2026-12',
      '2027-01',
    ]);
  });

  it('gives nothing twice, nothing before a future first month, nothing paused or ended', () => {
    expect(catchUp({ status: 'active', nextMonth: '2026-12' }, '2026-11')).toEqual({
      months: [],
      nextMonth: '2026-12',
    });
    expect(catchUp({ status: 'active', nextMonth: '2027-02' }, '2026-11').months).toEqual([]);
    expect(catchUp({ status: 'paused', nextMonth: '2026-09' }, '2026-11').months).toEqual([]);
    expect(catchUp({ status: 'ended', nextMonth: '2026-09' }, '2026-11').months).toEqual([]);
  });

  it('skips the paused months on resume, but keeps a future first month', () => {
    expect(resumedNextMonth('2026-09', '2026-11')).toBe('2026-11');
    expect(resumedNextMonth('2026-12', '2026-11')).toBe('2026-12');
  });
});

describe('categories', () => {
  it('lets a predefined category be deactivated, never renamed or deleted', () => {
    expect(() => {
      assertCategoryChange('predefined', 'deactivate', true);
    }).not.toThrow();
    expect(() => {
      assertCategoryChange('predefined', 'rename', false);
    }).toThrow(/can't be changed/);
    expect(() => {
      assertCategoryChange('predefined', 'delete', false);
    }).toThrow(/can't be changed/);
  });

  it('never changes Other or a reserved category', () => {
    for (const change of ['rename', 'deactivate', 'delete'] as const) {
      expect(() => {
        assertCategoryChange('other', change, false);
      }).toThrow();
      expect(() => {
        assertCategoryChange('reserved', change, false);
      }).toThrow();
    }
  });

  it('deletes a custom category only while unused', () => {
    expect(() => {
      assertCategoryChange('custom', 'delete', false);
    }).not.toThrow();
    expect(() => {
      assertCategoryChange('custom', 'delete', true);
    }).toThrow(/used/);
  });

  it('refuses a reserved or deactivated category, and Other without a description', () => {
    expect(() => {
      assertSelectable({ kind: 'reserved', active: true });
    }).toThrow(/system/);
    expect(() => {
      assertSelectable({ kind: 'custom', active: false });
    }).toThrow(/deactivated/);
    expect(() => {
      assertDescribed('other', null);
    }).toThrow();
    expect(() => {
      assertDescribed('predefined', null);
    }).not.toThrow();
  });

  it('compares names case-insensitively, against the translations too', () => {
    expect(() => {
      assertNameFree(' lab SHIPPING ', ['Lab shipping']);
    }).toThrow(/name/);
    expect(() => {
      assertNameFree('loyer', ['Rent', 'إيجار', 'Loyer']);
    }).toThrow(/name/);
    expect(() => {
      assertNameFree('Lab shipping', ['Rent']);
    }).not.toThrow();
  });
});
