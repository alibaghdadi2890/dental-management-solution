import { describe, expect, it } from 'vitest';
import { dateTextOf, parseDateText } from './date-text';

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
