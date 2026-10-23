import { canReadVisit, type Permission, type VisitOwnership } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { RolesService } from '../../roles';
import { UsersService } from '../../users';

/**
 * May you do this (CLAUDE.md §6). Resolves the caller's permissions — roles and per-user grants —
 * and staff profile into the request context once per request (ADR-0010, ADR-0055) and evaluates
 * them. The plain permission check is `RequestContext.hasPermission`; the visit-scope rule is the
 * pure `canReadVisit` of `@dcm/contracts`, which modules apply through
 * `RequestContext.visitScope()` without depending on this module.
 */
@Injectable()
export class AuthorizationService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly roles: RolesService,
    private readonly users: UsersService,
  ) {}

  /**
   * Platform admins are decided by rule (ADR-0008), so nothing is loaded for them. Clinic users
   * get the union of their roles' permissions and their grants in the current tenant, and their
   * staff profile id there.
   */
  async resolveForRequest(): Promise<void> {
    const userId = this.context.userId;
    const clinicUser =
      userId !== undefined && this.context.tenantId !== undefined && !this.context.isPlatformAdmin;
    if (!clinicUser) {
      this.context.setPermissions([]);
      this.context.setStaffProfileId(null);
      return;
    }
    // One transaction for both reads: this runs on every request.
    await this.tenantDb.run(async () => {
      this.context.setPermissions(await this.roles.permissionsForUser(userId));
      this.context.setStaffProfileId(await this.users.profileIdOf(userId));
    });
  }

  /** A permission, and for `visit:read` on a visit the visit scope (ADR-0055). */
  can(permission: Permission, visit?: VisitOwnership): boolean {
    if (permission === 'visit:read' && visit !== undefined) {
      return canReadVisit(
        {
          permissions: this.context.grantedPermissions(),
          userId: this.context.userId ?? null,
          profileId: this.context.staffProfileId,
        },
        visit,
      );
    }
    return this.context.hasPermission(permission);
  }
}
