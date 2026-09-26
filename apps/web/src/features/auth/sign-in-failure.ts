import { AUTH_PROBLEM_CODES } from '@dcm/contracts';
import { ApiError } from '@/lib/api';

export type SignInFailure =
  | { kind: 'invalid'; attemptsLeft: number }
  | { kind: 'locked'; lockedUntil: Date }
  | { kind: 'deactivated' }
  | { kind: 'generic' };

const LOCK_FALLBACK_MS = 15 * 60_000;

/** Maps the API's sign-in problems (ADR-0013) to what the login form shows. */
export function signInFailure(error: unknown, now = new Date()): SignInFailure {
  if (!(error instanceof ApiError)) return { kind: 'generic' };
  switch (error.code) {
    case AUTH_PROBLEM_CODES.invalidCredentials:
      return { kind: 'invalid', attemptsLeft: error.problem.attemptsLeft ?? 0 };
    case AUTH_PROBLEM_CODES.accountLocked:
      return {
        kind: 'locked',
        lockedUntil: error.problem.lockedUntil
          ? new Date(error.problem.lockedUntil)
          : new Date(now.getTime() + LOCK_FALLBACK_MS),
      };
    case AUTH_PROBLEM_CODES.accountDeactivated:
      return { kind: 'deactivated' };
    default:
      return { kind: 'generic' };
  }
}
