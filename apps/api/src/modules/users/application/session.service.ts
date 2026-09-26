import type { Session } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { type AuthenticatedSession, idleTimeoutSeconds } from '../../auth';

/**
 * "Who am I here": the session the SPA renders from (`GET /session`, ADR-0009). Identity comes
 * from `auth`, permissions from the request context; tenant, branches and roles are added as the
 * owning modules land.
 */
@Injectable()
export class SessionService {
  constructor(private readonly context: RequestContext) {}

  current(session: AuthenticatedSession): Promise<Session> {
    return Promise.resolve({
      user: { id: session.userId, displayName: session.name, email: session.email },
      platformAdmin: session.platformAdmin,
      mustChangePassword: session.mustChangePassword,
      tenant: null,
      branch: null,
      branches: [],
      roleNames: [],
      permissions: this.context.grantedPermissions(),
      idleTimeoutSeconds: idleTimeoutSeconds(session.trusted),
    });
  }
}
