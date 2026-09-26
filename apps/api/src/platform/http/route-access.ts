import type { Permission } from '@dcm/contracts';
import { type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

/**
 * How a route is reached (CLAUDE.md §6). Every handler declares `@Public()`, `@Authenticated()`
 * or `@RequirePermission()`; undeclared routes are denied by the `authorization` guard. The
 * decorators are plain metadata, so any module can use them without depending on `authorization`
 * (ADR-0010).
 */
export type RouteAccess = 'public' | 'authenticated' | { permission: Permission };

const ROUTE_ACCESS = 'dcm:route-access';

/** No session required: health probes and the sign-in endpoints only. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(ROUTE_ACCESS, 'public');

/** Any signed-in user, no specific permission: reading your own session, changing your password. */
export const Authenticated = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ROUTE_ACCESS, 'authenticated');

/** The route requires this permission from the catalog in `@dcm/contracts`. */
export const RequirePermission = (permission: Permission): MethodDecorator & ClassDecorator =>
  SetMetadata(ROUTE_ACCESS, { permission });

export function routeAccess(
  reflector: Reflector,
  target: Pick<ExecutionContext, 'getHandler' | 'getClass'>,
): RouteAccess | undefined {
  return reflector.getAllAndOverride<RouteAccess | undefined>(ROUTE_ACCESS, [
    target.getHandler(),
    target.getClass(),
  ]);
}
