import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from '../../../platform/db/columns';

/*
 * Identity plane (ADR-0011): better-auth's tables, renamed with an `auth_` prefix. They are global
 * (no tenant_id, no RLS) because sessions and memberships are resolved before a tenant is known.
 * Only the `auth` module touches them. JS keys are better-auth field names; a unit test keeps them
 * in step with `getAuthTables()` for our plugin set.
 */

const at = () => timestamp({ withTimezone: true });

export const authUsers = pgTable('auth_users', {
  id: idColumn(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  // admin plugin: `platform_admin` marks back-office operators (D9); ban = deactivate.
  role: text(),
  banned: boolean().default(false),
  banReason: text(),
  banExpires: at(),
  /** Set for temporary passwords (D6); the session guard blocks the app until it is changed. */
  mustChangePassword: boolean().notNull().default(false),
  ...timestamps(),
});

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: idColumn(),
    expiresAt: at().notNull(),
    token: text().notNull().unique(),
    ipAddress: text(),
    userAgent: text(),
    userId: uuid()
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    impersonatedBy: text(),
    /** Organization plugin: the active tenant (organization id = tenant id). */
    activeOrganizationId: uuid(),
    /** Organization plugin: the active branch (team id = branch id). */
    activeTeamId: uuid(),
    /** "Trust this workstation for 30 days" (D11): no idle timeout. */
    trusted: boolean().notNull().default(false),
    lastActiveAt: at().notNull().defaultNow(),
    ...timestamps(),
  },
  (table) => [index('auth_sessions_user_idx').on(table.userId)],
);

export const authAccounts = pgTable(
  'auth_accounts',
  {
    id: idColumn(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: uuid()
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: at(),
    refreshTokenExpiresAt: at(),
    scope: text(),
    password: text(),
    ...timestamps(),
  },
  (table) => [index('auth_accounts_user_idx').on(table.userId)],
);

export const authVerifications = pgTable('auth_verifications', {
  id: idColumn(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: at().notNull(),
  ...timestamps(),
});

/** Mirror of `tenancy.tenants`: id = tenant id. */
export const authOrganizations = pgTable('auth_organizations', {
  id: idColumn(),
  name: text().notNull(),
  slug: text().notNull().unique(),
  logo: text(),
  metadata: text(),
  ...timestamps(),
});

/** The global user → tenant index (D7): tenant resolution reads it before any tenant is known. */
export const authMembers = pgTable(
  'auth_members',
  {
    id: idColumn(),
    organizationId: uuid()
      .notNull()
      .references(() => authOrganizations.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    role: text().notNull(),
    ...timestamps(),
  },
  (table) => [
    unique('auth_members_org_user_unique').on(table.organizationId, table.userId),
    index('auth_members_user_idx').on(table.userId),
  ],
);

/** Created by the organization plugin; invitations are not used yet (D6). */
export const authInvitations = pgTable('auth_invitations', {
  id: idColumn(),
  organizationId: uuid()
    .notNull()
    .references(() => authOrganizations.id, { onDelete: 'cascade' }),
  email: text().notNull(),
  role: text(),
  teamId: uuid(),
  status: text().notNull(),
  expiresAt: at().notNull(),
  inviterId: uuid()
    .notNull()
    .references(() => authUsers.id, { onDelete: 'cascade' }),
  ...timestamps(),
});

/** Mirror of `tenancy.branches`: id = branch id. */
export const authTeams = pgTable('auth_teams', {
  id: idColumn(),
  name: text().notNull(),
  memberCount: integer().notNull().default(0),
  organizationId: uuid()
    .notNull()
    .references(() => authOrganizations.id, { onDelete: 'cascade' }),
  ...timestamps(),
});

export const authTeamMembers = pgTable(
  'auth_team_members',
  {
    id: idColumn(),
    teamId: uuid()
      .notNull()
      .references(() => authTeams.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    membershipKey: text().unique(),
    ...timestamps(),
  },
  (table) => [index('auth_team_members_user_idx').on(table.userId)],
);

/** Failed sign-ins per normalised email, known or not (ADR-0013). */
export const authSignInThrottle = pgTable('auth_sign_in_throttle', {
  email: text().primaryKey(),
  failedAttempts: integer().notNull().default(0),
  lockedUntil: at(),
  lastFailedAt: at(),
  ...timestamps(),
});

/** better-auth model name → Drizzle table, as the Drizzle adapter expects. */
export const betterAuthSchema = {
  auth_users: authUsers,
  auth_sessions: authSessions,
  auth_accounts: authAccounts,
  auth_verifications: authVerifications,
  auth_organizations: authOrganizations,
  auth_members: authMembers,
  auth_invitations: authInvitations,
  auth_teams: authTeams,
  auth_team_members: authTeamMembers,
};
