import { describe, expect, it } from 'vitest';
import { deriveTakenAt, isAfterToday, wallTimeToInstant } from './taken-at';

const BEIRUT = 'Asia/Beirut';

describe('wallTimeToInstant', () => {
  it("reads a camera time in the clinic's zone", () => {
    // Beirut is UTC+3 in June and UTC+2 in January.
    expect(wallTimeToInstant('2026-06-10T12:30:00', BEIRUT)?.toISOString()).toBe(
      '2026-06-10T09:30:00.000Z',
    );
    expect(wallTimeToInstant('2026-01-10T12:30:00', BEIRUT)?.toISOString()).toBe(
      '2026-01-10T10:30:00.000Z',
    );
    expect(wallTimeToInstant('2026-06-10T12:30:00', 'UTC')?.toISOString()).toBe(
      '2026-06-10T12:30:00.000Z',
    );
  });

  it('crosses midnight and the date line', () => {
    expect(wallTimeToInstant('2026-06-10T01:00:00', BEIRUT)?.toISOString()).toBe(
      '2026-06-09T22:00:00.000Z',
    );
    expect(wallTimeToInstant('2026-06-10T08:00:00', 'Pacific/Auckland')?.toISOString()).toBe(
      '2026-06-09T20:00:00.000Z',
    );
  });

  it('is right on both sides of a daylight-saving change', () => {
    // New York leaves daylight time on 2026-11-01 at 02:00 (UTC-4 → UTC-5).
    expect(wallTimeToInstant('2026-11-01T00:30:00', 'America/New_York')?.toISOString()).toBe(
      '2026-11-01T04:30:00.000Z',
    );
    expect(wallTimeToInstant('2026-11-01T03:30:00', 'America/New_York')?.toISOString()).toBe(
      '2026-11-01T08:30:00.000Z',
    );
  });

  it.each(['', '2026-06-10', '2026:06:10 12:30:00', '2026-02-30T10:00:00', '2026-06-10T25:00:00'])(
    'refuses %j',
    (text) => {
      expect(wallTimeToInstant(text, BEIRUT)).toBeNull();
    },
  );
});

describe('deriveTakenAt (D10)', () => {
  const now = new Date('2026-06-10T09:00:00Z');
  const visitStartedAt = new Date('2026-06-10T07:15:00Z');

  it("prefers the camera's own time", () => {
    expect(
      deriveTakenAt({
        exifTakenAt: '2026-03-12T10:42:00',
        visitStartedAt,
        now,
        timeZone: BEIRUT,
      }).toISOString(),
    ).toBe('2026-03-12T08:42:00.000Z');
  });

  it('falls back to the visit, then to now', () => {
    expect(deriveTakenAt({ exifTakenAt: null, visitStartedAt, now, timeZone: BEIRUT })).toEqual(
      visitStartedAt,
    );
    expect(
      deriveTakenAt({ exifTakenAt: undefined, visitStartedAt: null, now, timeZone: BEIRUT }),
    ).toEqual(now);
  });

  it('does not believe a camera whose clock is ahead, or text that is no date', () => {
    expect(
      deriveTakenAt({ exifTakenAt: '2031-01-01T00:00:00', visitStartedAt, now, timeZone: BEIRUT }),
    ).toEqual(visitStartedAt);
    expect(
      deriveTakenAt({
        exifTakenAt: '0000-00-00T00:00:00',
        visitStartedAt: null,
        now,
        timeZone: BEIRUT,
      }),
    ).toEqual(now);
  });
});

describe('isAfterToday', () => {
  // 22:30 UTC on the 10th is already the 11th in Beirut.
  const now = new Date('2026-06-10T22:30:00Z');

  it("compares dates in the clinic's zone", () => {
    expect(isAfterToday(new Date('2026-06-11T20:00:00Z'), now, BEIRUT)).toBe(false);
    expect(isAfterToday(new Date('2026-06-11T21:30:00Z'), now, BEIRUT)).toBe(true);
    expect(isAfterToday(new Date('2026-06-01T00:00:00Z'), now, BEIRUT)).toBe(false);
  });
});
