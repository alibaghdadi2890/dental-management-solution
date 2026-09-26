import type { Permission } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';

/**
 * May you do this (CLAUDE.md §6). Resolves the caller's permissions into the request context once
 * per request (ADR-0010) and evaluates them. Resource-level rules (e.g. "own appointments only")
 * will live in `can()`; the plain permission check is `RequestContext.hasPermission`.
 */
@Injectable()
export class AuthorizationService {
  constructor(private readonly context: RequestContext) {}

  /**
   * Platform admins are decided by rule (ADR-0008), so nothing is loaded for them. Clinic users
   * get the union of their roles' permissions — until roles exist, nothing.
   */
  resolveForRequest(): Promise<void> {
    this.context.setPermissions([]);
    return Promise.resolve();
  }

  can(permission: Permission): boolean {
    return this.context.hasPermission(permission);
  }
}
