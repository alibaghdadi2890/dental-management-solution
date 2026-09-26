import type { DomainError, DomainErrorKind } from '../../../platform/kernel/domain-error';
import { AccountDeactivatedError, AuthEndpointError } from '../domain/auth-errors';

/** The error body better-auth returns: `{ code: 'INVALID_EMAIL_OR_PASSWORD', message: '…' }`. */
export interface BetterAuthErrorBody {
  code: string;
  message: string;
}

export async function readBetterAuthError(response: Response): Promise<BetterAuthErrorBody> {
  const body: unknown = await response.json().catch(() => null);
  if (body && typeof body === 'object') {
    const { code, message } = body as Record<string, unknown>;
    return {
      code: typeof code === 'string' ? code : 'UNKNOWN',
      message: typeof message === 'string' ? message : response.statusText,
    };
  }
  return { code: 'UNKNOWN', message: response.statusText };
}

const KIND_BY_STATUS: Readonly<Record<number, DomainErrorKind>> = {
  400: 'invalid',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'invalid',
  429: 'rate_limited',
};

/**
 * Maps a better-auth failure to a domain error so it renders as problem+json with a stable
 * `auth.*` code (CLAUDE.md §12). Server errors stay opaque.
 */
export function toAuthDomainError(status: number, body: BetterAuthErrorBody): DomainError | Error {
  if (body.code === 'BANNED_USER') {
    return new AccountDeactivatedError('This account has been deactivated');
  }
  const kind = KIND_BY_STATUS[status];
  if (kind === undefined) {
    return new Error(`better-auth failed with ${status} ${body.code}`);
  }
  return new AuthEndpointError(`auth.${body.code.toLowerCase()}`, kind, body.message);
}
