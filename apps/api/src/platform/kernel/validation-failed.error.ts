import { DomainError } from './domain-error';

/** One failed rule, addressed like a Zod issue path (`items.3.code`). */
export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

/**
 * A request that is well-formed but breaks a rule only the domain can check (e.g. a duplicate code
 * against stored rows). Rendered as 422 `validation_failed` with the issues as `errors`, the same
 * shape request validation uses, so clients can point at the offending rows.
 */
export class ValidationFailedError extends DomainError {
  readonly code = 'validation_failed';
  readonly kind = 'invalid';

  constructor(
    message: string,
    readonly issues: readonly ValidationIssue[],
  ) {
    super(message);
  }
}
