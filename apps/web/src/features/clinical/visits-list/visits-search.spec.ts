import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  clearFilters,
  filterParams,
  filtersOf,
  listQueryOf,
  parseVisitsSearch,
} from './visits-search';

const DENTIST = '0192f3a0-0000-7000-8000-000000000001';
const VISIT = '0192f3a0-0000-7000-8000-000000000002';

describe('visits search', () => {
  it('defaults to all visits of the last 90 days, 10 a page', () => {
    expect(parseVisitsSearch({})).toEqual({ tab: 'all', range: '90d', size: 10 });
    expect(parseVisitsSearch(undefined)).toEqual({ tab: 'all', range: '90d', size: 10 });
  });

  it('keeps valid values and drops malformed ones', () => {
    expect(
      parseVisitsSearch({
        tab: 'unpaid',
        range: '12m',
        dentist: DENTIST,
        room: 'not-an-id',
        q: '  crown ',
        size: '25',
        visit: VISIT,
      }),
    ).toEqual({
      tab: 'unpaid',
      range: '12m',
      dentist: DENTIST,
      room: undefined,
      q: 'crown',
      size: 25,
      visit: VISIT,
    });
    expect(parseVisitsSearch({ tab: 'nope', range: '5y', size: 7, q: '' })).toEqual({
      tab: 'all',
      range: '90d',
      size: 10,
      q: undefined,
    });
  });

  it('maps the Unpaid tab to the all tab of the API filters, and pages by size', () => {
    const search = parseVisitsSearch({ tab: 'unpaid', dentist: DENTIST, size: 50 });
    expect(filtersOf(search)).toEqual({
      tab: 'all',
      range: '90d',
      dentistId: DENTIST,
      roomId: undefined,
      q: undefined,
    });
    expect(listQueryOf(search, 'abc')).toMatchObject({ limit: 50, cursor: 'abc' });
    expect(listQueryOf(search, undefined)).not.toHaveProperty('cursor');
    expect(filterParams(filtersOf(search))).toEqual({
      tab: 'all',
      range: '90d',
      dentistId: DENTIST,
    });
  });

  it('clears back to 90 days, keeping the tab, size and open visit', () => {
    const search = parseVisitsSearch({
      tab: 'in_progress',
      range: 'all',
      q: 'x',
      size: 25,
      visit: VISIT,
    });
    expect(activeFilterCount(search)).toBe(2);
    const cleared = clearFilters(search);
    expect(cleared).toEqual({ tab: 'in_progress', range: '90d', size: 25, visit: VISIT });
    expect(activeFilterCount(cleared)).toBe(0);
  });
});
