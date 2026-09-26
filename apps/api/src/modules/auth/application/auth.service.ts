import { emailSchema, passwordSchema } from '@dcm/contracts';
import { Injectable, Logger } from '@nestjs/common';
import { hashPassword } from 'better-auth/crypto';
import { PlatformAdminDb } from '../../../platform/db/platform-admin-db';
import { EmailTakenError } from '../domain/auth-errors';
import { IdentityDb } from '../persistence/identity-db';
import { IdentityRepository } from '../persistence/identity.repository';
import { PLATFORM_ADMIN_ROLE } from './better-auth';

export interface NewStaffIdentity {
  name: string;
  email: string;
  temporaryPassword: string;
}

export type BootstrapOutcome = 'created' | 'promoted' | 'unchanged';

/**
 * The auth module's public service. Identity writes join the caller's open transaction
 * (`IdentityDb`), so a staff user's identity commits together with their profile and roles.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly identities: IdentityRepository,
    private readonly identityDb: IdentityDb,
    private readonly adminDb: PlatformAdminDb,
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

  /** A clinic user with a temporary password to change at first sign-in (D6). */
  async createIdentity(input: NewStaffIdentity): Promise<string> {
    const email = emailSchema.parse(input.email);
    if (await this.identities.findUserByEmail(email)) {
      throw new EmailTakenError('A user with this email already exists');
    }
    return this.identities.insertUser({
      name: input.name,
      email,
      role: 'user',
      mustChangePassword: true,
      passwordHash: await hashPassword(passwordSchema.parse(input.temporaryPassword)),
    });
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
