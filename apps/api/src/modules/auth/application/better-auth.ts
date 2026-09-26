import { type BetterAuthOptions, betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin, organization } from 'better-auth/plugins';
import { adminAc, userAc } from 'better-auth/plugins/admin/access';
import type { AppConfig } from '../../../platform/config/config.schema';
import type { Database } from '../../../platform/db/database';
import type { Clock } from '../../../platform/kernel/clock';
import { newId } from '../../../platform/kernel/id';
import { betterAuthSchema } from '../persistence/schema';

export const BETTER_AUTH = Symbol('BETTER_AUTH');

/** Mount point of the better-auth handler (see `http/auth-http.controller.ts`). */
export const AUTH_BASE_PATH = '/api/v1/auth';

export const PLATFORM_ADMIN_ROLE = 'platform_admin';
export const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60;

/** Plugin and schema options, shared with the schema parity test. */
export const betterAuthSchemaOptions = {
  user: {
    modelName: 'auth_users',
    additionalFields: {
      mustChangePassword: { type: 'boolean', required: false, defaultValue: false, input: false },
    },
  },
  session: {
    modelName: 'auth_sessions',
    additionalFields: {
      trusted: { type: 'boolean', required: false, defaultValue: false, input: false },
      lastActiveAt: { type: 'date', required: false, input: false },
    },
  },
  account: { modelName: 'auth_accounts' },
  verification: { modelName: 'auth_verifications' },
  plugins: [
    organization({
      // Organizations (tenants) and teams (branches) are mirrored by the auth module; nobody
      // creates them over HTTP (ADR-0011).
      allowUserToCreateOrganization: false,
      teams: { enabled: true },
      schema: {
        organization: { modelName: 'auth_organizations' },
        member: { modelName: 'auth_members' },
        invitation: { modelName: 'auth_invitations' },
        team: { modelName: 'auth_teams' },
        teamMember: { modelName: 'auth_team_members' },
      },
    }),
    admin({
      adminRoles: [PLATFORM_ADMIN_ROLE],
      defaultRole: 'user',
      roles: { [PLATFORM_ADMIN_ROLE]: adminAc, user: userAc },
    }),
  ],
} satisfies BetterAuthOptions;

export interface BetterAuthDeps {
  db: Database;
  config: AppConfig;
  clock: Clock;
}

/**
 * The only better-auth instance (CLAUDE.md §6: nothing else talks to better-auth). It reads and
 * writes the identity-plane tables on the runtime role; its HTTP surface is narrowed to sign-in and
 * sign-out by `AuthHttpController`.
 */
export function createBetterAuth({ db, config, clock }: BetterAuthDeps) {
  return betterAuth({
    ...betterAuthSchemaOptions,
    appName: 'Dental Clinic',
    baseURL: config.AUTH_BASE_URL,
    basePath: AUTH_BASE_PATH,
    secret: config.AUTH_SECRET,
    trustedOrigins: [config.AUTH_BASE_URL, ...config.AUTH_TRUSTED_ORIGINS],
    database: drizzleAdapter(db, { provider: 'pg', schema: betterAuthSchema }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
    },
    session: {
      ...betterAuthSchemaOptions.session,
      // Trusted workstations get an absolute 30-day session (D11); untrusted ones a browser-session
      // cookie and the 15-minute idle timeout enforced by the session guard.
      expiresIn: SESSION_LIFETIME_SECONDS,
      disableSessionRefresh: true,
    },
    databaseHooks: {
      session: {
        create: {
          before: (session, ctx) => {
            const body: unknown = ctx?.body;
            const trusted =
              typeof body === 'object' &&
              body !== null &&
              'rememberMe' in body &&
              body.rememberMe === true;
            return Promise.resolve({
              data: { ...session, trusted, lastActiveAt: clock.now() },
            });
          },
        },
      },
    },
    advanced: {
      cookiePrefix: 'dcm',
      useSecureCookies: config.NODE_ENV === 'production',
      defaultCookieAttributes: { sameSite: 'lax', httpOnly: true },
      database: { generateId: () => newId() },
    },
    telemetry: { enabled: false },
  });
}

export type BetterAuth = ReturnType<typeof createBetterAuth>;
