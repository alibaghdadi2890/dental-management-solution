import type { Permission } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { RolesService } from '../../roles';

/**
 * May you do this (CLAUDE.md §6). Resolves the caller's permissions into the request context once
 * per request (ADR-0010) and evaluates them. Resource-level rules (e.g. "own appointments only")
 * will live in `can()`; the plain permission check is `RequestContext.hasPermission`.
 */
@Injectable()
export class AuthorizationService {
  constructor(
    private readonly context: RequestContext,
    private readonly roles: RolesService,
  ) {}

  /**
   * Platform admins are decided by rule (ADR-0008), so nothing is loaded for them. Clinic users
   * get the union of their roles' permissions in the current tenant.
   */
  async resolveForRequest(): Promise<void> {
    const userId = this.context.userId;
    const clinicUser =
      userId !== undefined && this.context.tenantId !== undefined && !this.context.isPlatformAdmin;
    this.context.setPermissions(clinicUser ? await this.roles.permissionsForUser(userId) : []);
  }

  can(permission: Permission): boolean {
    return this.context.hasPermission(permission);
  }
}
