import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, ne } from 'drizzle-orm';
import { newId } from '../../../platform/kernel/id';
import { IdentityDb } from './identity-db';
import {
  authAccounts,
  authMembers,
  authOrganizations,
  authSessions,
  authTeamMembers,
  authTeams,
  authUsers,
} from './schema';

export type IdentityUser = typeof authUsers.$inferSelect;

export interface NewIdentity {
  name: string;
  email: string;
  role: string;
  mustChangePassword: boolean;
  passwordHash: string;
}

export type SessionPatch = Partial<
  Pick<typeof authSessions.$inferInsert, 'lastActiveAt' | 'activeOrganizationId' | 'activeTeamId'>
>;

/** better-auth's credential provider id: the account row that holds the password hash. */
const CREDENTIAL_PROVIDER = 'credential';

@Injectable()
export class IdentityRepository {
  constructor(private readonly db: IdentityDb) {}

  async findUserByEmail(email: string): Promise<IdentityUser | undefined> {
    const [user] = await this.db.run((tx) =>
      tx.select().from(authUsers).where(eq(authUsers.email, email)),
    );
    return user;
  }

  async findUserById(id: string): Promise<IdentityUser | undefined> {
    const [user] = await this.db.run((tx) =>
      tx.select().from(authUsers).where(eq(authUsers.id, id)),
    );
    return user;
  }

  async findUsersByIds(ids: readonly string[]): Promise<IdentityUser[]> {
    if (ids.length === 0) return [];
    return this.db.run((tx) =>
      tx
        .select()
        .from(authUsers)
        .where(inArray(authUsers.id, [...ids])),
    );
  }

  /** A user plus the credential account better-auth verifies passwords against. */
  async insertUser(identity: NewIdentity): Promise<string> {
    const id = newId();
    await this.db.run(async (tx) => {
      await tx.insert(authUsers).values({
        id,
        name: identity.name,
        email: identity.email,
        emailVerified: true,
        role: identity.role,
        mustChangePassword: identity.mustChangePassword,
      });
      await tx.insert(authAccounts).values({
        accountId: id,
        providerId: CREDENTIAL_PROVIDER,
        userId: id,
        password: identity.passwordHash,
      });
    });
    return id;
  }

  async updateUser(
    id: string,
    patch: Partial<
      Pick<IdentityUser, 'name' | 'role' | 'banned' | 'banReason' | 'mustChangePassword'>
    >,
  ): Promise<void> {
    await this.db.run((tx) => tx.update(authUsers).set(patch).where(eq(authUsers.id, id)));
  }

  async credentialHash(userId: string): Promise<string | null> {
    const [account] = await this.db.run((tx) =>
      tx
        .select({ password: authAccounts.password })
        .from(authAccounts)
        .where(
          and(eq(authAccounts.userId, userId), eq(authAccounts.providerId, CREDENTIAL_PROVIDER)),
        ),
    );
    return account?.password ?? null;
  }

  async setCredentialHash(userId: string, passwordHash: string): Promise<void> {
    await this.db.run((tx) =>
      tx
        .update(authAccounts)
        .set({ password: passwordHash })
        .where(
          and(eq(authAccounts.userId, userId), eq(authAccounts.providerId, CREDENTIAL_PROVIDER)),
        ),
    );
  }

  async updateSession(sessionId: string, patch: SessionPatch): Promise<void> {
    await this.db.run((tx) =>
      tx.update(authSessions).set(patch).where(eq(authSessions.id, sessionId)),
    );
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.db.run((tx) => tx.delete(authSessions).where(eq(authSessions.id, sessionId)));
  }

  /** Revokes every session of a user, optionally keeping the one making the request. */
  async deleteSessionsOf(userId: string, keepSessionId?: string): Promise<void> {
    await this.db.run((tx) =>
      tx
        .delete(authSessions)
        .where(
          keepSessionId === undefined
            ? eq(authSessions.userId, userId)
            : and(eq(authSessions.userId, userId), ne(authSessions.id, keepSessionId)),
        ),
    );
  }

  /** Tenants (organization ids) the user belongs to, oldest membership first. */
  async organizationIdsOf(userId: string): Promise<string[]> {
    const rows = await this.db.run((tx) =>
      tx
        .select({ organizationId: authMembers.organizationId })
        .from(authMembers)
        .where(eq(authMembers.userId, userId))
        .orderBy(asc(authMembers.createdAt), asc(authMembers.id)),
    );
    return rows.map((row) => row.organizationId);
  }

  /** Branches (team ids) the user is assigned to inside a tenant, oldest assignment first. */
  async teamIdsOf(userId: string, organizationId: string): Promise<string[]> {
    const rows = await this.db.run((tx) =>
      tx
        .select({ teamId: authTeamMembers.teamId })
        .from(authTeamMembers)
        .innerJoin(authTeams, eq(authTeams.id, authTeamMembers.teamId))
        .where(
          and(eq(authTeamMembers.userId, userId), eq(authTeams.organizationId, organizationId)),
        )
        .orderBy(asc(authTeamMembers.createdAt), asc(authTeamMembers.id)),
    );
    return rows.map((row) => row.teamId);
  }

  /** Mirror of a tenant (organization id = tenant id, ADR-0011). */
  async upsertOrganization({
    id,
    name,
    slug,
  }: {
    id: string;
    name: string;
    slug: string;
  }): Promise<void> {
    await this.db.run((tx) =>
      tx
        .insert(authOrganizations)
        .values({ id, name, slug })
        .onConflictDoUpdate({ target: authOrganizations.id, set: { name, slug } }),
    );
  }

  async memberCountsByOrganization(): Promise<Map<string, number>> {
    const rows = await this.db.run((tx) =>
      tx
        .select({ organizationId: authMembers.organizationId, members: count() })
        .from(authMembers)
        .groupBy(authMembers.organizationId),
    );
    return new Map(rows.map((row) => [row.organizationId, row.members]));
  }
}
