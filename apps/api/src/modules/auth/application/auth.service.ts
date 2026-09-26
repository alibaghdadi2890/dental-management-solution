import { emailSchema, passwordSchema } from '@dcm/contracts';
import { Injectable, Logger } from '@nestjs/common';
import { hashPassword } from 'better-auth/crypto';
import { RequestContext } from '../../../platform/cls/request-context';
import { PlatformAdminDb } from '../../../platform/db/platform-admin-db';
import { isUniqueViolation } from '../../../platform/db/unique-violation';
import { EventBus } from '../../../platform/events/event-bus';
import { TenancyService } from '../../tenancy';
import { EmailTakenError } from '../domain/auth-errors';
import { MEMBER_JOINED, type MemberJoined } from '../events/member-joined';
import { MEMBER_REMOVED, type MemberRemoved } from '../events/member-removed';
import { IdentityDb } from '../persistence/identity-db';
import { IdentityRepository } from '../persistence/identity.repository';
import { PLATFORM_ADMIN_ROLE } from './better-auth';

export interface NewStaffIdentity {
  name: string;
  email: string;
  temporaryPassword: string;
}

/** The identity facts other modules may show: never credentials. */
export interface IdentitySummary {
  id: string;
  email: string;
  name: string;
}

export type BootstrapOutcome = 'created' | 'promoted' | 'unchanged';

/**
 * The auth module's public service. Identity writes join the caller's open transaction
 * (`IdentityDb`), so a staff user's identity commits together with their profile and roles.
 * Membership methods mirror the tenant in context (organization) and its branches (teams).
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly context: RequestContext,
    private readonly events: EventBus,
    private readonly identities: IdentityRepository,
    private readonly identityDb: IdentityDb,
    private readonly adminDb: PlatformAdminDb,
    private readonly tenancy: TenancyService,
  ) {}

  /** Mirrors a tenant as a better-auth organization inside the caller's transaction. */
  async syncOrganization(tenant: { id: string; name: string; slug: string }): Promise<void> {
    await this.identities.upsertOrganization(tenant);
  }

  /** Clinic members per tenant, for the platform tenants list. */
  memberCountsByTenant(): Promise<Map<string, number>> {
    return this.identities.memberCountsByOrganization();
  }

  async isEmailTaken(email: string): Promise<boolean> {
    return (await this.identities.findUserByEmail(emailSchema.parse(email))) !== undefined;
  }

  async identitiesOf(userIds: readonly string[]): Promise<Map<string, IdentitySummary>> {
    const users = await this.identities.findUsersByIds(userIds);
    return new Map(
      users.map((user) => [user.id, { id: user.id, email: user.email, name: user.name }]),
    );
  }

  /** A clinic user with a temporary password to change at first sign-in (D6). */
  async createIdentity(input: NewStaffIdentity): Promise<string> {
    this.context.requirePermission('user:write');
    const email = emailSchema.parse(input.email);
    if (await this.identities.findUserByEmail(email)) {
      throw new EmailTakenError('A user with this email already exists');
    }
    try {
      return await this.identities.insertUser({
        name: input.name,
        email,
        role: 'user',
        mustChangePassword: true,
        passwordHash: await hashPassword(passwordSchema.parse(input.temporaryPassword)),
      });
    } catch (error) {
      if (isUniqueViolation(error, 'auth_users_email_unique')) {
        throw new EmailTakenError('A user with this email already exists');
      }
      throw error;
    }
  }

  /**
   * Makes the user a member of the tenant in context working in exactly `branchIds` (in that
   * order; the first is their default branch). Emits `MemberJoined` for a new membership.
   */
  async syncMembership(input: { userId: string; branchIds: readonly string[] }): Promise<void> {
    this.context.requirePermission('user:write');
    const tenant = await this.tenancy.currentTenant();
    const known = new Map(
      (await this.tenancy.branchesByIds(input.branchIds)).map((branch) => [branch.id, branch]),
    );
    const branches = input.branchIds.flatMap((id) => known.get(id) ?? []);

    await this.identities.upsertOrganization(tenant);
    await this.identities.upsertTeams(tenant.id, branches);
    const joined = await this.identities.ensureMember(tenant.id, input.userId);
    await this.identities.replaceTeamMemberships(
      input.userId,
      tenant.id,
      branches.map((branch) => branch.id),
    );
    if (joined) {
      const event: MemberJoined = this.events.create(MEMBER_JOINED, { userId: input.userId });
      await this.events.publish(event);
    }
  }

  /** Ends the user's membership of the tenant in context. Emits `MemberRemoved`. */
  async removeMembership(userId: string): Promise<void> {
    this.context.requirePermission('user:write');
    if (await this.identities.removeMember(this.context.requireTenantId(), userId)) {
      const event: MemberRemoved = this.events.create(MEMBER_REMOVED, { userId });
      await this.events.publish(event);
    }
  }

  /** An admin sets a new temporary password (D6): to be changed at next sign-in. */
  async resetPassword(userId: string, temporaryPassword: string): Promise<void> {
    this.context.requirePermission('user:write');
    const hash = await hashPassword(passwordSchema.parse(temporaryPassword));
    await this.identities.setCredentialHash(userId, hash);
    await this.identities.updateUser(userId, { mustChangePassword: true });
    await this.identities.deleteSessionsOf(userId);
  }

  /** Deactivation = better-auth ban: sign-in is refused and every session ends now. */
  async deactivate(userId: string, reason: string): Promise<void> {
    this.context.requirePermission('user:write');
    await this.identities.updateUser(userId, { banned: true, banReason: reason, banExpires: null });
    await this.identities.deleteSessionsOf(userId);
  }

  async reactivate(userId: string): Promise<void> {
    this.context.requirePermission('user:write');
    await this.identities.updateUser(userId, { banned: false, banReason: null, banExpires: null });
  }

  /**
   * Creates the first platform admin, or promotes an existing user (D10). Idempotent; never
   * changes the password of an existing account. Runs as a system task outside any tenant.
   */
  async bootstrapPlatformAdmin(input: {
    email: string;
    password: string;
    name: string;
  }): Promise<BootstrapOutcome> {
    const email = emailSchema.parse(input.email);
    const password = passwordSchema.parse(input.password);
    const outcome = await this.adminDb.withoutTenant('bootstrap platform admin', (tx) =>
      this.identityDb.within(tx, async (): Promise<BootstrapOutcome> => {
        const existing = await this.identities.findUserByEmail(email);
        if (existing?.role === PLATFORM_ADMIN_ROLE) {
          return 'unchanged';
        }
        if (existing) {
          await this.identities.updateUser(existing.id, { role: PLATFORM_ADMIN_ROLE });
          return 'promoted';
        }
        await this.identities.insertUser({
          name: input.name,
          email,
          role: PLATFORM_ADMIN_ROLE,
          mustChangePassword: false,
          passwordHash: await hashPassword(password),
        });
        return 'created';
      }),
    );
    this.logger.log({ outcome }, 'platform admin bootstrap');
    return outcome;
  }
}
