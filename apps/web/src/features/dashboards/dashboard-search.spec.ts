import { describe, expect, it } from 'vitest';
import { parseDashboardSearch, queryOf, queryString, switchTab } from './dashboard-search';

const BRANCH = '01a1eee9-62ad-7013-a33c-2bf74d025dc6';
const DENTIST = '01a1eee9-6384-72b4-9d3e-6c8d2c32a2f0';

describe('dashboard search (feature 19, D2)', () => {
  it('drops defaults, malformed values and a stray custom range', () => {
    expect(parseDashboardSearch({ tab: 'nope', period: 'this_month', branch: 'x' })).toEqual({});
    expect(parseDashboardSearch({ period: 'last_month', from: '2026-11-01' })).toEqual({
      period: 'last_month',
    });
    expect(
      parseDashboardSearch({ period: 'custom', from: '2026-11-09', to: '2026-11-14' }),
    ).toEqual({ period: 'custom', from: '2026-11-09', to: '2026-11-14' });
  });

  it('keeps the dentist on Operational only', () => {
    expect(parseDashboardSearch({ dentist: DENTIST })).toEqual({});
    expect(parseDashboardSearch({ tab: 'operational', dentist: DENTIST })).toEqual({
      tab: 'operational',
      dentist: DENTIST,
    });
  });

  it('keeps the period and branch across tabs, never the dentist', () => {
    const search = {
      tab: 'operational' as const,
      period: 'this_year' as const,
      branch: BRANCH,
      dentist: DENTIST,
    };
    expect(switchTab(search, 'financial')).toEqual({ period: 'this_year', branch: BRANCH });
    expect(switchTab({ branch: BRANCH }, 'operational')).toEqual({
      branch: BRANCH,
      tab: 'operational',
    });
  });

  it('builds the cards’ query', () => {
    const query = queryOf({ tab: 'operational', branch: BRANCH, dentist: DENTIST });
    expect(query).toEqual({ period: 'this_month', branchId: BRANCH, dentistId: DENTIST });
    expect(queryString(query)).toBe(`period=this_month&branchId=${BRANCH}&dentistId=${DENTIST}`);
    expect(queryOf({ dentist: DENTIST })).toEqual({ period: 'this_month' });
  });
});
