/**
 * Account lockout (D11, ADR-0013): five consecutive failed sign-ins for an email lock it for 15
 * minutes. A success clears the state (the caller deletes it). Pure: time comes in as `now`.
 */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_DURATION_MS = 15 * 60_000;

export interface ThrottleState {
  failedAttempts: number;
  lockedUntil: Date | null;
  lastFailedAt: Date | null;
}

/** A lock that has run out behaves as if nothing had happened. */
function current(state: ThrottleState | null, now: Date): ThrottleState | null {
  if (state?.lockedUntil && state.lockedUntil.getTime() <= now.getTime()) {
    return null;
  }
  return state;
}

export function lockedUntil(state: ThrottleState | null, now: Date): Date | null {
  return current(state, now)?.lockedUntil ?? null;
}

export function attemptsLeft(state: ThrottleState | null, now: Date): number {
  return Math.max(0, MAX_FAILED_ATTEMPTS - (current(state, now)?.failedAttempts ?? 0));
}

export function recordFailure(state: ThrottleState | null, now: Date): ThrottleState {
  const active = current(state, now);
  if (active?.lockedUntil) {
    return active;
  }
  const failedAttempts = (active?.failedAttempts ?? 0) + 1;
  return {
    failedAttempts,
    lockedUntil:
      failedAttempts >= MAX_FAILED_ATTEMPTS ? new Date(now.getTime() + LOCK_DURATION_MS) : null,
    lastFailedAt: now,
  };
}
