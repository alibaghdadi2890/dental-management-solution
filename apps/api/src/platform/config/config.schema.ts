import { z } from 'zod';

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** Runtime role (`dcm_app`): subject to row-level security. */
  DATABASE_URL: z.url(),
  /** BYPASSRLS role (`dcm_admin`): only reachable through `withoutTenant()`. */
  DATABASE_ADMIN_URL: z.url(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  REDIS_URL: z.url(),

  S3_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),

  /** Signs session cookies (better-auth). At least 32 random characters; never commit it. */
  AUTH_SECRET: z.string().min(32),
  /** Public origin of the SPA, which proxies /api on the same origin (CLAUDE.md §6). */
  AUTH_BASE_URL: z.url(),
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
