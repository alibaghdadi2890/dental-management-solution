import { describe, expect, it } from 'vitest';
import { calendarDateOf, dateTextOf, isoOfCalendarDate, parseDateText } from './date-text';

describe('parseDateText', () => {
  it('reads day/month/year for a DMY tenant', () => {
    expect(parseDateText('07/03/2019', 'DMY')).toBe('2019-03-07');
    expect(parseDateText('7.3.2019', 'DMY')).toBe('2019-03-07');
    expect(parseDateText('07032019', 'DMY')).toBe('2019-03-07');
  });

  it('reads month/day/year for an MDY tenant and year/month/day for a YMD one', () => {
    expect(parseDateText('03/07/2019', 'MDY')).toBe('2019-03-07');
    expect(parseDateText('2019-03-07', 'YMD')).toBe('2019-03-07');
    expect(parseDateText('20190307', 'YMD')).toBe('2019-03-07');
  });

  it('reads Arabic-Indic digits', () => {
    expect(parseDateText('٠٧/٠٣/٢٠١٩', 'DMY')).toBe('2019-03-07');
  });

  it('rejects impossible dates and partial input', () => {
    expect(parseDateText('31/02/2019', 'DMY')).toBeNull();
    expect(parseDateText('07/03/19', 'DMY')).toBeNull();
    expect(parseDateText('07/03', 'DMY')).toBeNull();
    expect(parseDateText('', 'DMY')).toBeNull();
  });
});

describe('dateTextOf', () => {
  it('writes an ISO date in the tenant order, and leaves anything else as typed', () => {
    expect(dateTextOf('2019-03-07', 'DMY')).toBe('07/03/2019');
    expect(dateTextOf('2019-03-07', 'MDY')).toBe('03/07/2019');
    expect(dateTextOf('2019-03-07', 'YMD')).toBe('2019/03/07');
    expect(dateTextOf('07/03/20', 'DMY')).toBe('07/03/20');
    expect(dateTextOf('', 'DMY')).toBe('');
  });
});

describe('calendarDateOf / isoOfCalendarDate', () => {
  it('round-trips a calendar date through a local Date without shifting the day', () => {
    const date = calendarDateOf('1990-05-01');
    expect(date?.getFullYear()).toBe(1990);
    expect(date?.getMonth()).toBe(4);
    expect(date?.getDate()).toBe(1);
    expect(date && isoOfCalendarDate(date)).toBe('1990-05-01');
    expect(isoOfCalendarDate(new Date(1900, 0, 1, 23, 59))).toBe('1900-01-01');
  });

  it('gives nothing for text that is not an ISO date', () => {
    expect(calendarDateOf('')).toBeUndefined();
    expect(calendarDateOf('01/05/1990')).toBeUndefined();
    expect(calendarDateOf('1990-02-30')).toBeUndefined();
  });
});
