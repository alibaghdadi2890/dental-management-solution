import type { BranchRef, Session } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { type AuthenticatedSession, BranchResolver, idleTimeoutSeconds } from '../../auth';
import { TenancyService } from '../../tenancy';

/**
 * "Who am I here": the session the SPA renders from (`GET /session`, ADR-0009). Identity comes
 * from `auth`, the clinic and branches from `tenancy`, permissions from the request context.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly context: RequestContext,
    private readonly tenancy: TenancyService,
    private readonly branchResolver: BranchResolver,
  ) {}

  async current(session: AuthenticatedSession): Promise<Session> {
    const clinic =
      session.tenantId === undefined ? null : await this.clinic(session, session.tenantId);
    return {
      user: { id: session.userId, displayName: session.name, email: session.email },
      platformAdmin: session.platformAdmin,
      mustChangePassword: session.mustChangePassword,
      tenant: clinic?.tenant ?? null,
      branch: clinic?.branches.find((branch) => branch.id === session.branchId) ?? null,
      branches: clinic?.branches ?? [],
      roleNames: [],
      permissions: this.context.grantedPermissions(),
      idleTimeoutSeconds: idleTimeoutSeconds(session.trusted),
    };
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
