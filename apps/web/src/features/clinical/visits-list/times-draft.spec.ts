import { describe, expect, it } from 'vitest';
import { draftMinutes, isTimesDirty, timesDraftOf, timesOf, timesProblem } from './times-draft';

/** Beirut is UTC+3 in June. */
const ZONE = 'Asia/Beirut';

const visit = {
  localDate: '2026-06-10',
  startedAt: '2026-06-10T07:00:41.000Z',
  completedAt: '2026-06-10T09:30:12.000Z',
};

const on = (date: string, start: string, end: string) => ({ date, start, end });

describe('times draft', () => {
  it("opens on the visit's day and clock times, to the minute", () => {
    const draft = timesDraftOf(visit, ZONE);
    expect(draft).toEqual(on('2026-06-10', '10:00', '12:30'));
    expect(isTimesDirty(draft, visit, ZONE)).toBe(false);
    expect(isTimesDirty({ ...draft, end: '11:00' }, visit, ZONE)).toBe(true);
    expect(isTimesDirty({ ...draft, date: '2026-06-09' }, visit, ZONE)).toBe(true);
  });

  it('names instants on its day, and the end on the next one past midnight', () => {
    expect(timesOf(on('2026-06-10', '10:15', '11:00'), ZONE)).toEqual({
      startedAt: '2026-06-10T07:15:00.000Z',
      completedAt: '2026-06-10T08:00:00.000Z',
      nextDay: false,
    });
    expect(timesOf(on('2026-06-08', '23:30', '00:20'), ZONE)).toEqual({
      startedAt: '2026-06-08T20:30:00.000Z',
      completedAt: '2026-06-08T21:20:00.000Z',
      nextDay: true,
    });
    expect(draftMinutes(on('2026-06-10', '23:30', '00:20'), ZONE)).toBe(50);
    expect(timesOf(on('2026-06-10', '', '11:00'), ZONE)).toBeNull();
    expect(timesOf(on('', '10:00', '11:00'), ZONE)).toBeNull();
  });

  it('says what keeps a draft from saving', () => {
    const now = new Date('2026-06-10T12:00:00Z');
    expect(timesProblem(on('2026-06-10', '10:00', ''), ZONE, now)).toBe('missing');
    expect(timesProblem(on('2026-06-10', '10:00', '10:00'), ZONE, now)).toBe('order');
    expect(timesProblem(on('2026-06-10', '10:00', '15:01'), ZONE, now)).toBe('future');
    expect(timesProblem(on('2026-06-11', '09:00', '10:00'), ZONE, now)).toBe('future');
    expect(timesProblem(on('2026-06-10', '10:00', '15:00'), ZONE, now)).toBeNull();
  });
});
