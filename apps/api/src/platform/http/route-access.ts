import { type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

/**
 * How a route is reached (CLAUDE.md §6). Every handler declares `@Public()`, `@Authenticated()`
 * or a permission (`@RequirePermission()` in `authorization`); undeclared routes are denied.
 */
export type RouteAccess = 'public' | 'authenticated';

const ROUTE_ACCESS = 'dcm:route-access';

/** No session required: health probes and the sign-in endpoints only. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(ROUTE_ACCESS, 'public');

/** Any signed-in user, no specific permission: reading your own session, changing your password. */
export const Authenticated = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ROUTE_ACCESS, 'authenticated');

export function routeAccess(
  reflector: Reflector,
  target: Pick<ExecutionContext, 'getHandler' | 'getClass'>,
): RouteAccess | undefined {
  return reflector.getAllAndOverride<RouteAccess | undefined>(ROUTE_ACCESS, [
    target.getHandler(),
    target.getClass(),
  ]);
}
