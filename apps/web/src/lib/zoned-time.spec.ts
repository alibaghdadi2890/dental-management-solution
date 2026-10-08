import { describe, expect, it } from 'vitest';
import { fromZonedInput, toZonedInput } from './zoned-time';

describe('zoned datetime-local values', () => {
  it("shows an instant in the clinic's zone, not the browser's", () => {
    expect(toZonedInput('2026-03-12T08:42:00.000Z', 'Asia/Beirut')).toBe('2026-03-12T10:42');
    expect(toZonedInput('2026-06-09T22:30:00.000Z', 'Asia/Beirut')).toBe('2026-06-10T01:30');
    expect(toZonedInput('2026-06-10T03:00:00.000Z', 'America/New_York')).toBe('2026-06-09T23:00');
  });

  it('reads the value back as the same instant', () => {
    for (const zone of ['Asia/Beirut', 'America/New_York', 'UTC', 'Pacific/Auckland']) {
      for (const iso of ['2026-03-12T08:42:00.000Z', '2026-11-01T07:30:00.000Z']) {
        expect(fromZonedInput(toZonedInput(iso, zone), zone)).toBe(iso);
      }
    }
  });

  it('refuses what is not a date and time', () => {
    expect(fromZonedInput('', 'UTC')).toBeNull();
    expect(fromZonedInput('2026-02-30T10:00', 'UTC')).toBeNull();
    expect(fromZonedInput('tomorrow', 'UTC')).toBeNull();
  });
});
