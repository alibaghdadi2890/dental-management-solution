import { DomainError } from './domain-error';

/** Cross-tenant work attempted by someone who is neither a platform admin nor a system task. */
export class PlatformAccessDeniedError extends DomainError {
  readonly code = 'platform.access_denied';
  readonly kind = 'forbidden';
}
