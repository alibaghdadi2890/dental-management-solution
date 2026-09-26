/**
 * How a domain error should be understood by callers. The HTTP layer maps kinds to status codes;
 * domain code never deals in HTTP (CLAUDE.md §12).
 */
export type DomainErrorKind = 'invalid' | 'not_found' | 'conflict' | 'forbidden' | 'unauthenticated';

/**
 * Base class for every expected business failure. Pure TypeScript so `domain/` folders can throw it.
 * Subclasses declare a stable, dot-separated `code` such as `visit.already_completed`.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly kind: DomainErrorKind;

  constructor(
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}
