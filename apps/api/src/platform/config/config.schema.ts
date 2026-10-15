import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from '@dcm/contracts';
import { z } from 'zod';

export const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),

    /** Runtime role (`dcm_app`): subject to row-level security. */
    DATABASE_URL: z.url(),
    /** BYPASSRLS role (`dcm_admin`): only reachable through `withoutTenant()`. */
    DATABASE_ADMIN_URL: z.url(),
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

    REDIS_URL: z.url(),
    /** BullMQ key prefix; isolates queues sharing one Redis (e.g. one per parallel test run). */
    QUEUE_PREFIX: z.string().min(1).default('bull'),

    S3_ENDPOINT: z.url().optional(),
    /**
     * Where the browser reaches the store, when that differs from S3_ENDPOINT: the API talks to the
     * store on its own network, and the upload and download URLs it signs must name the public
     * address instead (a deployment proxies the bucket's path on the app's origin). Unset, the URLs
     * use S3_ENDPOINT.
     */
    S3_PUBLIC_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: z.stringbool().default(false),

    /** Signs session cookies (better-auth). At least 32 random characters; never commit it. */
    AUTH_SECRET: z.string().min(32),
    /** Public origin of the SPA, which proxies /api on the same origin (CLAUDE.md §6). */
    AUTH_BASE_URL: z.url(),
    /**
     * `Secure` on the session cookies. Unset, it follows NODE_ENV (on in production). Browsers drop
     * a Secure cookie set over plain HTTP, so a deployment served on a bare address with no TLS in
     * front turns it off explicitly, and turns it back on the day a domain fronts it.
     */
    AUTH_COOKIE_SECURE: z.stringbool().optional(),
    /** Extra origins allowed to call the auth endpoints, comma-separated. */
    AUTH_TRUSTED_ORIGINS: z
      .string()
      .optional()
      .transform((value) =>
        (value ?? '')
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),

    /**
     * Optional: when both are set, the API creates this platform admin at startup, or promotes an
     * existing account (idempotent; never changes an existing password). Same as `admin:bootstrap`.
     */
    BOOTSTRAP_ADMIN_EMAIL: z.email().optional(),
    BOOTSTRAP_ADMIN_PASSWORD: z
      .string()
      .min(PASSWORD_MIN_LENGTH)
      .max(PASSWORD_MAX_LENGTH)
      .optional(),
    BOOTSTRAP_ADMIN_NAME: z.string().min(1).default('Platform admin'),
  })
  .refine((config) => !config.BOOTSTRAP_ADMIN_EMAIL === !config.BOOTSTRAP_ADMIN_PASSWORD, {
    message: 'Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD together, or neither',
    path: ['BOOTSTRAP_ADMIN_PASSWORD'],
  });

export type AppConfig = z.infer<typeof configSchema>;

export class InvalidConfigError extends Error {
  constructor(error: z.ZodError) {
    super(`Invalid environment configuration:\n${z.prettifyError(error)}`);
    this.name = 'InvalidConfigError';
  }
}

/** Validates the environment once at boot; the app refuses to start on invalid config. */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    throw new InvalidConfigError(result.error);
  }
  return result.data;
}
