import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthenticatedSession } from '../application/session-resolver';

const ALLOW_PENDING_PASSWORD_CHANGE = 'dcm:allow-pending-password-change';
const SESSION = Symbol('dcm:session');

type RequestWithSession = Request & { [SESSION]?: AuthenticatedSession };

/**
 * Reachable while a temporary password is still pending (D6): reading the session, changing the
 * password, the idle heartbeat. Every other route answers 403 `auth.password_change_required`.
 */
export const AllowPendingPasswordChange = (): MethodDecorator =>
  SetMetadata(ALLOW_PENDING_PASSWORD_CHANGE, true);

export function allowsPendingPasswordChange(
  reflector: Reflector,
  context: ExecutionContext,
): boolean {
  return (
    reflector.get<boolean | undefined>(ALLOW_PENDING_PASSWORD_CHANGE, context.getHandler()) === true
  );
}

export function attachSession(request: Request, session: AuthenticatedSession): void {
  (request as RequestWithSession)[SESSION] = session;
}

/** The caller's session, for `@Authenticated()` routes (the guard has already resolved it). */
export const CurrentSession = createParamDecorator(
  (_: unknown, context: ExecutionContext): AuthenticatedSession => {
    const session = context.switchToHttp().getRequest<RequestWithSession>()[SESSION];
    if (!session) {
      throw new Error('CurrentSession used on a route without an authenticated session');
    }
    return session;
  },
);
