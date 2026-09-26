import { describe, expect, it } from 'vitest';
import { FixedClock, systemClock } from './clock';

describe('clocks', () => {
  it('reads the system time', () => {
    const before = Date.now();
    expect(systemClock.now().getTime()).toBeGreaterThanOrEqual(before);
  });

  it('lets tests move time deterministically', () => {
    const clock = new FixedClock(new Date('2026-09-26T10:00:00Z'));
    clock.advance({ minutes: 15, seconds: 1 });
    expect(clock.now().toISOString()).toBe('2026-09-26T10:15:01.000Z');
  });
});
