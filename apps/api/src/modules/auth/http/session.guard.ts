import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import { routeAccess } from '../../../platform/http/route-access';
import { SessionResolver, TENANT_HEADER } from '../application/session-resolver';
import { PasswordChangeRequiredError } from '../domain/auth-errors';
import { allowsPendingPasswordChange, attachSession } from './session-access';

/**
 * First global guard (registered with the permission guard in `AuthorizationModule`, so the order
 * is fixed): resolves the cookie session and fills CLS with who is calling, for which tenant and
 * branch (CLAUDE.md §5–6). No session → 401 `unauthenticated`.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionResolver,
  ) {}

  async canActivate(execution: ExecutionContext): Promise<boolean> {
    if (routeAccess(this.reflector, execution) === 'public') {
      return true;
    }
    const request = execution.switchToHttp().getRequest<Request>();
    const tenantHeader = request.headers[TENANT_HEADER];
    const session = await this.sessions.authenticate(
      fromNodeHeaders(request.headers),
      typeof tenantHeader === 'string' ? tenantHeader : undefined,
    );
    attachSession(request, session);

    if (session.mustChangePassword && !allowsPendingPasswordChange(this.reflector, execution)) {
      throw new PasswordChangeRequiredError('Set a new password to continue');
    }
    return true;
  }
}
