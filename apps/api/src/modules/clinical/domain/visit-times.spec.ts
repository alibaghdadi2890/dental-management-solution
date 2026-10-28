import { describe, expect, it } from 'vitest';
import { VisitTimesInvalidError, VisitTimesOffDayError } from './visit-errors';
import { planVisitTimes } from './visit-times';

/** Beirut is UTC+3 in June: 2026-06-10 runs from 2026-06-09T21:00Z to 2026-06-10T21:00Z. */
const ZONE = 'Asia/Beirut';
const at = (iso: string) => new Date(iso);
const NOW = at('2026-06-11T09:00:00Z');

const visit = {
  localDate: '2026-06-10',
  startedAt: at('2026-06-10T07:00:00Z'),
  completedAt: at('2026-06-10T09:30:00Z'),
  pausedSeconds: 600,
};

const planOrNull = (startedAt: string, completedAt: string, base = visit) =>
  planVisitTimes(base, { startedAt: at(startedAt), completedAt: at(completedAt) }, ZONE, NOW);

const plan = (startedAt: string, completedAt: string, base = visit) => {
  const times = planOrNull(startedAt, completedAt, base);
  if (!times) throw new Error('expected a change');
  return times;
};

describe('planVisitTimes', () => {
  it('sets both times, drops the pauses and makes the duration end − start', () => {
    expect(plan('2026-06-10T07:15:00Z', '2026-06-10T08:00:00Z')).toEqual({
      startedAt: at('2026-06-10T07:15:00Z'),
      completedAt: at('2026-06-10T08:00:00Z'),
      pausedSeconds: 0,
      durationMinutes: 45,
    });
  });

  it("keeps the start on the visit's local day, at either edge of it", () => {
    expect(plan('2026-06-09T21:00:00Z', '2026-06-09T21:30:00Z').durationMinutes).toBe(30);
    expect(() => plan('2026-06-09T20:59:00Z', '2026-06-09T21:30:00Z')).toThrow(
      VisitTimesOffDayError,
    );
    expect(() => plan('2026-06-10T21:00:00Z', '2026-06-10T21:30:00Z')).toThrow(
      VisitTimesOffDayError,
    );
  });

  it('lets the end cross midnight, up to a day after the start', () => {
    expect(plan('2026-06-10T20:30:00Z', '2026-06-10T21:30:00Z').durationMinutes).toBe(60);
    expect(plan('2026-06-10T07:00:00Z', '2026-06-11T07:00:00Z').durationMinutes).toBe(1440);
    expect(() => plan('2026-06-10T07:00:00Z', '2026-06-11T07:01:00Z')).toThrow(
      VisitTimesInvalidError,
    );
  });

  it('refuses an end at or before the start, or in the future', () => {
    expect(() => plan('2026-06-10T08:00:00Z', '2026-06-10T08:00:00Z')).toThrow(
      VisitTimesInvalidError,
    );
    expect(() => plan('2026-06-10T08:00:00Z', '2026-06-10T07:59:00Z')).toThrow(
      VisitTimesInvalidError,
    );
    const today = { ...visit, localDate: '2026-06-11' };
    expect(() => plan('2026-06-11T08:00:00Z', '2026-06-11T09:01:00Z', today)).toThrow(
      VisitTimesInvalidError,
    );
    expect(plan('2026-06-11T08:00:00Z', '2026-06-11T09:00:00Z', today).durationMinutes).toBe(60);
  });

  it("leaves the times alone when they are the visit's own", () => {
    expect(planOrNull('2026-06-10T07:00:00Z', '2026-06-10T09:30:00Z')).toBeNull();
  });
});
