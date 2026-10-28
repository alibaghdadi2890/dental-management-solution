import { describe, expect, it } from 'vitest';
import { draftMinutes, isTimesDirty, timesDraftOf, timesOf, timesProblem } from './times-draft';

/** Beirut is UTC+3 in June. */
const ZONE = 'Asia/Beirut';

const visit = {
  localDate: '2026-06-10',
  startedAt: '2026-06-10T07:00:41.000Z',
  completedAt: '2026-06-10T09:30:12.000Z',
};

describe('times draft', () => {
  it("opens on the visit's clock times, to the minute", () => {
    const draft = timesDraftOf(visit, ZONE);
    expect(draft).toEqual({ start: '10:00', end: '12:30' });
    expect(isTimesDirty(draft, visit, ZONE)).toBe(false);
    expect(isTimesDirty({ ...draft, end: '11:00' }, visit, ZONE)).toBe(true);
  });

  it("names instants on the visit's day, and the end on the next one past midnight", () => {
    expect(timesOf({ start: '10:15', end: '11:00' }, visit, ZONE)).toEqual({
      startedAt: '2026-06-10T07:15:00.000Z',
      completedAt: '2026-06-10T08:00:00.000Z',
      nextDay: false,
    });
    expect(timesOf({ start: '23:30', end: '00:20' }, visit, ZONE)).toEqual({
      startedAt: '2026-06-10T20:30:00.000Z',
      completedAt: '2026-06-10T21:20:00.000Z',
      nextDay: true,
    });
    expect(draftMinutes({ start: '23:30', end: '00:20' }, visit, ZONE)).toBe(50);
    expect(timesOf({ start: '', end: '11:00' }, visit, ZONE)).toBeNull();
  });

  it('says what keeps a draft from saving', () => {
    const now = new Date('2026-06-10T12:00:00Z');
    expect(timesProblem({ start: '10:00', end: '' }, visit, ZONE, now)).toBe('missing');
    expect(timesProblem({ start: '10:00', end: '10:00' }, visit, ZONE, now)).toBe('order');
    expect(timesProblem({ start: '10:00', end: '15:01' }, visit, ZONE, now)).toBe('future');
    expect(timesProblem({ start: '10:00', end: '15:00' }, visit, ZONE, now)).toBeNull();
  });
});
