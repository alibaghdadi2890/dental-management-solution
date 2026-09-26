import type { BranchRef, Session } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { type AuthenticatedSession, BranchResolver, idleTimeoutSeconds } from '../../auth';
import { RolesService } from '../../roles';
import { TenancyService } from '../../tenancy';
import { StaffRepository } from '../persistence/staff.repository';

/**
 * "Who am I here": the session the SPA renders from (`GET /session`, ADR-0009). Identity comes
 * from `auth`, the clinic and branches from `tenancy`, the staff profile from here, role names
 * from `roles` and permissions from the request context.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly tenancy: TenancyService,
    private readonly branchResolver: BranchResolver,
    private readonly roles: RolesService,
    private readonly staff: StaffRepository,
  ) {}

  async current(session: AuthenticatedSession): Promise<Session> {
    const tenantId = session.tenantId;
    const clinic = tenantId === undefined ? null : await this.clinic(session, tenantId);
    const member =
      tenantId === undefined || session.platformAdmin ? null : await this.member(session.userId);
    return {
      user: {
        id: session.userId,
        displayName: member?.displayName ?? session.name,
        email: session.email,
      },
      platformAdmin: session.platformAdmin,
      mustChangePassword: session.mustChangePassword,
      tenant: clinic?.tenant ?? null,
      branch: clinic?.branches.find((branch) => branch.id === session.branchId) ?? null,
      branches: clinic?.branches ?? [],
      roleNames: member?.roleNames ?? [],
      permissions: this.context.grantedPermissions(),
      idleTimeoutSeconds: idleTimeoutSeconds(session.trusted),
    };
  }

  private member(userId: string) {
    return this.tenantDb.run(async () => {
      const profile = await this.staff.byUserId(userId);
      const roles = (await this.roles.rolesFor([userId])).get(userId) ?? [];
      return { displayName: profile?.displayName, roleNames: roles.map((role) => role.name) };
    });
  }

  private async clinic(session: AuthenticatedSession, tenantId: string) {
    const tenant = await this.tenancy.currentTenant();
    const ids = await this.branchResolver.candidates(session, tenantId);
    const names = new Map(
      (await this.tenancy.activeBranches(ids)).map((branch) => [branch.id, branch.name]),
    );
    const branches: BranchRef[] = ids.flatMap((id) => {
      const name = names.get(id);
      return name === undefined ? [] : [{ id, name }];
    });
    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        timeZone: tenant.timeZone,
        currency: tenant.currency,
        locale: tenant.locale,
      },
      branches,
    };
  }
}
