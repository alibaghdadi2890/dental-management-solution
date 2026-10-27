import {
  canReadStatement,
  canReadVisit,
  type Permission,
  type VisitOwnership,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { RolesService } from '../../roles';
import { UsersService } from '../../users';

/**
 * May you do this (CLAUDE.md §6). Resolves the caller's permissions — roles and per-user grants —
 * and staff profile into the request context once per request (ADR-0010, ADR-0055) and evaluates
 * them. The plain permission check is `RequestContext.hasPermission`; the resource rules are pure
 * functions of `@dcm/contracts` that modules apply without depending on this module: the visit
 * scope (`canReadVisit`, through `RequestContext.visitScope()`) and a dentist's own statement
 * (`canReadStatement`, ADR-0060).
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

  /**
   * A permission; for `visit:read` on a visit the visit scope (ADR-0055), for
   * `compensation:read` on a dentist's statement their own only (ADR-0060).
   */
  can(permission: Permission, resource?: VisitOwnership | { profileId: string }): boolean {
    if (permission === 'compensation:read' && resource !== undefined && 'profileId' in resource) {
      return canReadStatement(
        {
          permissions: this.context.grantedPermissions(),
          profileId: this.context.staffProfileId,
        },
        resource.profileId,
      );
    }
    if (permission === 'visit:read' && resource !== undefined && 'dentistId' in resource) {
      return canReadVisit(
        {
          permissions: this.context.grantedPermissions(),
          userId: this.context.userId ?? null,
          profileId: this.context.staffProfileId,
        },
        resource,
      );
    }
    return this.context.hasPermission(permission);
  }
}
