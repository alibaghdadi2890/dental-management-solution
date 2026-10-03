import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  clearFilters,
  outstandingQueryOf,
  parsePaymentsSearch,
  toggleBucket,
  transactionQueryOf,
} from './payments-search';

describe('the /payments URL', () => {
  it('falls back to the defaults for anything unknown', () => {
    expect(parsePaymentsSearch({ tab: 'nope', range: '1y', method: 'gold', size: '7' })).toEqual({
      tab: 'transactions',
      range: '30d',
      method: undefined,
      q: undefined,
      bucket: undefined,
      group: 'patient',
      size: 25,
    });
  });

  it('maps each tab to its API query', () => {
    const search = parsePaymentsSearch({ range: '7d', method: 'card', q: ' Rana ', size: '10' });
    expect(transactionQueryOf(search, 'c1')).toEqual({
      range: '7d',
      method: 'card',
      q: 'Rana',
      limit: 10,
      cursor: 'c1',
    });
    expect(outstandingQueryOf({ ...search, bucket: 'd31_60' }, undefined)).toEqual({
      limit: 10,
      group: 'patient',
      q: 'Rana',
      bucket: 'd31_60',
    });
  });

  it('a bucket button opens Outstanding on that bucket, and clears it on a second click', () => {
    const start = parsePaymentsSearch({});
    const filtered = toggleBucket(start, 'd90_plus');
    expect(filtered).toMatchObject({ tab: 'outstanding', bucket: 'd90_plus' });
    expect(toggleBucket(filtered, 'd90_plus').bucket).toBeUndefined();
    expect(toggleBucket(filtered, 'd0_30').bucket).toBe('d0_30');
  });

  it('counts and clears the open tab’s filters', () => {
    const search = parsePaymentsSearch({ range: 'all', method: 'cash', q: 'x', size: '50' });
    expect(activeFilterCount(search)).toBe(3);
    expect(clearFilters(search)).toEqual({
      tab: 'transactions',
      range: '30d',
      group: 'patient',
      size: 50,
    });
    expect(activeFilterCount({ ...search, tab: 'outstanding', bucket: 'd0_30' })).toBe(2);
  });
});
