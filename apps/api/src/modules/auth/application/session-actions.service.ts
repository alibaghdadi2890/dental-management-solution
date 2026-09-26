import type { ChangePasswordRequest } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { TenantDb } from '../../../platform/db/tenant-db';
import { AuditService } from '../../audit';
import {
  BranchNotAssignedError,
  InvalidCurrentPasswordError,
  PasswordUnchangedError,
} from '../domain/auth-errors';
import { IdentityDb } from '../persistence/identity-db';
import { IdentityRepository } from '../persistence/identity.repository';
import { BranchResolver } from './branch-resolver';
import type { AuthenticatedSession } from './session-resolver';

/** What signed-in users do to their own session: pick a branch, change their password. */
@Injectable()
export class SessionActionsService {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly identityDb: IdentityDb,
    private readonly identities: IdentityRepository,
    private readonly branches: BranchResolver,
    private readonly audit: AuditService,
  ) {}

  /** The branch must be one the caller may work in inside the current tenant (D7). */
  async switchBranch(session: AuthenticatedSession, branchId: string): Promise<void> {
    const allowed =
      session.tenantId !== undefined &&
      (await this.branches.candidates(session, session.tenantId)).includes(branchId);
    if (!allowed) {
      throw new BranchNotAssignedError('You are not assigned to this branch');
    }
    await this.identities.updateSession(session.sessionId, { activeTeamId: branchId });
  }

  /**
   * Replaces the caller's password after checking the current one, completes a pending
   * first-sign-in change (D6) and signs out every other session of the user.
   */
  async changePassword(
    session: AuthenticatedSession,
    request: ChangePasswordRequest,
  ): Promise<void> {
    const hash = await this.identities.credentialHash(session.userId);
    if (!hash || !(await verifyPassword({ hash, password: request.currentPassword }))) {
      throw new InvalidCurrentPasswordError('The current password is incorrect');
    }
    if (request.newPassword === request.currentPassword) {
      throw new PasswordUnchangedError('Choose a password different from the current one');
    }
    const newHash = await hashPassword(request.newPassword);

    const work = async () => {
      await this.identities.setCredentialHash(session.userId, newHash);
      await this.identities.updateUser(session.userId, { mustChangePassword: false });
      await this.identities.deleteSessionsOf(session.userId, session.sessionId);
      if (session.tenantId !== undefined) {
        await this.audit.record({
          action: 'user.password_change',
          resourceType: 'user',
          resourceId: session.userId,
        });
      }
    };
    // Outside a tenant (platform admins) there is no tenant audit log: pino only (spec § audit).
    await (session.tenantId === undefined ? this.identityDb.atomic(work) : this.tenantDb.run(work));
  }
}
