import { describe, expect, it } from 'vitest';
import { isFiltered, parseActivitySearch, rangeStart, searchTerm } from './activity-search';

const ID = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d01';

describe('the /activity URL (H7)', () => {
  it('defaults to the last 30 days and reads bad values as not set', () => {
    expect(parseActivitySearch({})).toEqual({ range: '30d' });
    expect(
      parseActivitySearch({ area: 'nonsense', person: 'x', range: 'year', q: '  ', patient: '1' }),
    ).toEqual({ range: '30d' });
    expect(isFiltered(parseActivitySearch({}))).toBe(false);
  });

  it('keeps the filters and the record a "View all activity" link names', () => {
    const search = parseActivitySearch({
      area: 'payments',
      person: 'admin',
      range: '7d',
      q: ' RCT-3 ',
      patient: ID,
    });
    expect(search).toEqual({
      area: 'payments',
      person: 'admin',
      range: '7d',
      q: 'RCT-3',
      patient: ID,
    });
    expect(isFiltered(search)).toBe(true);
    expect(isFiltered(parseActivitySearch({ visit: ID }))).toBe(true);
    expect(parseActivitySearch({ person: ID }).person).toBe(ID);
  });
});

describe('rangeStart', () => {
  it("starts at the clinic's midnight, today or that many days back", () => {
    // Beirut is UTC+3 in October: local midnight is 21:00 UTC the day before.
    expect(rangeStart('today', '2026-10-06', 'Asia/Beirut')).toBe('2026-10-05T21:00:00.000Z');
    expect(rangeStart('7d', '2026-10-06', 'Asia/Beirut')).toBe('2026-09-28T21:00:00.000Z');
    expect(rangeStart('today', '2026-10-06', 'UTC')).toBe('2026-10-06T00:00:00.000Z');
    expect(rangeStart('today', '2026-01-15', 'America/New_York')).toBe('2026-01-15T05:00:00.000Z');
    expect(rangeStart('all', '2026-10-06', 'Asia/Beirut')).toBeUndefined();
  });
});

describe('searchTerm', () => {
  it('recognises the display numbers, with or without the dash, in any case', () => {
    expect(searchTerm('P-12')).toEqual({ kind: 'patientNumber', text: 'P-12' });
    expect(searchTerm(' v45 ')).toEqual({ kind: 'visitNumber', text: 'v45' });
    expect(searchTerm('rct-3')).toEqual({ kind: 'receiptNumber', text: 'rct-3' });
  });

  it('reads anything else as a name', () => {
    expect(searchTerm('Rami')).toEqual({ kind: 'name', text: 'Rami' });
    expect(searchTerm('P-12 Khoury')).toEqual({ kind: 'name', text: 'P-12 Khoury' });
  });
});
