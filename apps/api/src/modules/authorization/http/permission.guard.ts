import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionDeniedError } from '../../../platform/cls/permission-denied.error';
import { RequestContext } from '../../../platform/cls/request-context';
import { routeAccess } from '../../../platform/http/route-access';
import { AuthorizationService } from '../application/authorization.service';

/**
 * Second global guard, after the session guard: resolves permissions into CLS, then enforces the
 * route's declaration. A route that declares nothing is denied (CLAUDE.md §6: deny by default).
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
    private readonly context: RequestContext,
  ) {}

  async canActivate(execution: ExecutionContext): Promise<boolean> {
    const access = routeAccess(this.reflector, execution);
    if (access === 'public') {
      return true;
    }
    await this.authorization.resolveForRequest();
    if (access === 'authenticated') {
      return true;
    }
    if (access === undefined) {
      throw new PermissionDeniedError('route declares no access');
    }
    this.context.requirePermission(access.permission);
    return true;
  }
}
