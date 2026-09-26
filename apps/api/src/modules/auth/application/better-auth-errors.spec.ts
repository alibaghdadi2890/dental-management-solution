import { describe, expect, it } from 'vitest';
import { toProblemDetails } from '../../../platform/errors/problem-details';
import { readBetterAuthError, toAuthDomainError } from './better-auth-errors';

describe('better-auth error mapping', () => {
  it('reports deactivated (banned) accounts with a stable code', () => {
    const problem = toProblemDetails(
      toAuthDomainError(403, { code: 'BANNED_USER', message: 'You have been banned' }),
    );
    expect(problem).toMatchObject({ status: 403, code: 'auth.account_deactivated' });
  });

  it.each([
    [400, 'VALIDATION_ERROR', 422, 'auth.validation_error'],
    [401, 'INVALID_TOKEN', 401, 'auth.invalid_token'],
    [403, 'INVALID_ORIGIN', 403, 'auth.invalid_origin'],
    [429, 'TOO_MANY_REQUESTS', 429, 'auth.too_many_requests'],
  ])('maps %i %s to %i %s', (status, code, expectedStatus, expectedCode) => {
    expect(toProblemDetails(toAuthDomainError(status, { code, message: 'x' }))).toMatchObject({
      status: expectedStatus,
      code: expectedCode,
    });
  });

  it('keeps server failures opaque', () => {
    expect(
      toProblemDetails(toAuthDomainError(500, { code: 'FAILED', message: 'db exploded' })),
    ).toMatchObject({ status: 500, code: 'internal_error' });
  });

  it('reads error bodies defensively', async () => {
    await expect(
      readBetterAuthError(new Response('not json', { status: 502, statusText: 'Bad Gateway' })),
    ).resolves.toEqual({ code: 'UNKNOWN', message: 'Bad Gateway' });
  });
});
