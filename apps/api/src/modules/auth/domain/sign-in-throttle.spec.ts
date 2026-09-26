import { describe, expect, it } from 'vitest';
import {
  attemptsLeft,
  LOCK_DURATION_MS,
  lockedUntil,
  MAX_FAILED_ATTEMPTS,
  recordFailure,
  type ThrottleState,
} from './sign-in-throttle';

const now = new Date('2026-09-26T10:00:00Z');
const later = (ms: number) => new Date(now.getTime() + ms);

function failTimes(times: number, at = now): ThrottleState | null {
  let state: ThrottleState | null = null;
  for (let i = 0; i < times; i++) state = recordFailure(state, at);
  return state;
}

describe('sign-in throttle (D11)', () => {
  it('allows five attempts', () => {
    expect(MAX_FAILED_ATTEMPTS).toBe(5);
    expect(attemptsLeft(null, now)).toBe(5);
    expect(attemptsLeft(failTimes(1), now)).toBe(4);
    expect(attemptsLeft(failTimes(4), now)).toBe(1);
    expect(lockedUntil(failTimes(4), now)).toBeNull();
  });

  it('locks for 15 minutes on the fifth consecutive failure', () => {
    expect(LOCK_DURATION_MS).toBe(15 * 60_000);
    const state = failTimes(5);
    expect(lockedUntil(state, now)).toEqual(later(LOCK_DURATION_MS));
    expect(attemptsLeft(state, now)).toBe(0);
  });

  it('stays locked until the lock expires, whatever happens meanwhile', () => {
    const state = failTimes(5);
    expect(lockedUntil(state, later(LOCK_DURATION_MS - 1))).not.toBeNull();
    expect(lockedUntil(recordFailure(state, later(60_000)), later(60_000))).toEqual(
      later(LOCK_DURATION_MS),
    );
  });

  it('starts counting afresh once the lock has expired', () => {
    const expired = later(LOCK_DURATION_MS);
    const state = failTimes(5);
    expect(lockedUntil(state, expired)).toBeNull();
    expect(attemptsLeft(state, expired)).toBe(5);
    expect(recordFailure(state, expired)).toEqual({
      failedAttempts: 1,
      lockedUntil: null,
      lastFailedAt: expired,
    });
  });
});
