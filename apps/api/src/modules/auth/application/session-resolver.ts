import { idSchema } from '@dcm/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../../../platform/clock/clock.module';
import { RequestContext } from '../../../platform/cls/request-context';
import type { Clock } from '../../../platform/kernel/clock';
import { TenancyService, TenantNotFoundError, TenantSuspendedError } from '../../tenancy';
import { NoTenantError, SessionExpiredError, UnauthenticatedError } from '../domain/auth-errors';
import { sessionActivity } from '../domain/session-activity';
import { IdentityRepository } from '../persistence/identity.repository';
import { BETTER_AUTH, type BetterAuth, PLATFORM_ADMIN_ROLE } from './better-auth';
import { BranchResolver } from './branch-resolver';

/** Who is calling, resolved once per request by the session guard. */
export interface AuthenticatedSession {
  sessionId: string;
  userId: string;
  email: string;
  name: string;
  platformAdmin: boolean;
  mustChangePassword: boolean;
  trusted: boolean;
  tenantId: string | undefined;
  branchId: string | undefined;
}

/** Header a platform admin uses to act inside a tenant (D2, ADR-0008). Ignored for everyone else. */
export const TENANT_HEADER = 'x-tenant-id';

/**
 * The edge that authenticates (CLAUDE.md §5–6): resolves the cookie session, enforces the idle
 * timeout, resolves tenant and branch, and fills the request context.
 */
@Injectable()
export class SessionResolver {
  constructor(
    @Inject(BETTER_AUTH) private readonly auth: BetterAuth,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly identities: IdentityRepository,
    private readonly branches: BranchResolver,
    private readonly tenancy: TenancyService,
    private readonly context: RequestContext,
  ) {}

  async authenticate(
    headers: Headers,
    requestedTenantId: string | undefined,
  ): Promise<AuthenticatedSession> {
    const result = await this.auth.api.getSession({ headers });
    if (!result) {
      throw new UnauthenticatedError('Sign in to continue');
    }
    const { session, user } = result;
    const trusted = session.trusted === true;

    const now = this.clock.now();
    const activity = sessionActivity(
      { trusted, lastActiveAt: session.lastActiveAt ?? session.createdAt },
      now,
    );
    if (activity === 'expired') {
      await this.identities.deleteSession(session.id);
      throw new SessionExpiredError('Your session expired after 15 minutes of inactivity');
    }
    if (activity === 'touch') {
      await this.identities.updateSession(session.id, { lastActiveAt: now });
    }

    const platformAdmin = user.role === PLATFORM_ADMIN_ROLE;
    const tenantId = platformAdmin
      ? this.requestedTenant(requestedTenantId)
      : await this.memberTenant(user.id, session.id, session.activeOrganizationId);
    this.context.establish({ userId: user.id, tenantId, branchId: undefined, platformAdmin });

    let branchId: string | undefined;
    if (tenantId !== undefined) {
      await this.assertTenantUsable(platformAdmin);
      branchId = await this.branches.resolve(
        { userId: user.id, platformAdmin },
        tenantId,
        session.id,
        session.activeTeamId,
      );
      this.context.establish({ userId: user.id, tenantId, branchId, platformAdmin });
    }

    return {
      sessionId: session.id,
      userId: user.id,
      email: user.email,
      name: user.name,
      platformAdmin,
      mustChangePassword: user.mustChangePassword === true,
      trusted,
      tenantId,
      branchId,
    };
  }

  /** Platform admins choose the tenant per request; nothing is stored on their session. */
  private requestedTenant(header: string | undefined): string | undefined {
    if (header === undefined) {
      return undefined;
    }
    const parsed = idSchema.safeParse(header);
    if (!parsed.success) {
      throw new TenantNotFoundError('Tenant not found');
    }
    return parsed.data;
  }

  /**
   * Tenant resolution for clinic users — the extension point for users of several tenants (D7).
   * Today a user belongs to one tenant; with several, this is where a tenant picker plugs in
   * (`auth.tenant_selection_required`) instead of defaulting to the oldest membership.
   */
  private async memberTenant(
    userId: string,
    sessionId: string,
    active: string | null | undefined,
  ): Promise<string> {
    const tenants = await this.identities.organizationIdsOf(userId);
    if (active && tenants.includes(active)) {
      return active;
    }
    const [first] = tenants;
    if (first === undefined) {
      throw new NoTenantError('This account is not a member of any clinic');
    }
    await this.identities.updateSession(sessionId, {
      activeOrganizationId: first,
      activeTeamId: null,
    });
    return first;
  }

  /** Runs with the tenant in context: RLS shows the tenant row only if it exists. */
  private async assertTenantUsable(platformAdmin: boolean): Promise<void> {
    const status = await this.tenancy.currentTenantStatus();
    if (status === null) {
      throw platformAdmin
        ? new TenantNotFoundError('Tenant not found')
        : new NoTenantError('This account is not a member of any clinic');
    }
    if (status === 'suspended' && !platformAdmin) {
      throw new TenantSuspendedError('This clinic is suspended; contact support');
    }
  }
}
