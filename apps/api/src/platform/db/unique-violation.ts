const UNIQUE_VIOLATION = '23505';

interface PgErrorLike {
  code?: unknown;
  constraint?: unknown;
  cause?: unknown;
}

/**
 * True when `error` (or the pg error Drizzle wraps in `cause`) is a unique-constraint violation,
 * optionally of a specific constraint. Lets repositories turn races into domain conflicts.
 */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current && typeof current === 'object'; depth++) {
    const candidate = current as PgErrorLike;
    if (candidate.code === UNIQUE_VIOLATION) {
      return constraint === undefined || candidate.constraint === constraint;
    }
    current = candidate.cause;
  }
  return false;
}
