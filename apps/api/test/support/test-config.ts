import { inject } from 'vitest';
import { loadConfig } from '../../src/platform/config/config.schema';
import type { AppConfig } from '../../src/platform/config/config.schema';

export const TEST_ORIGIN = 'http://localhost:5173';

/**
 * Config defaults shared by every integration test that needs a full `AppConfig` (a real Nest app
 * or a bare testing module wired to `RedisModule`/`QueueModule`). Callers override what their
 * scenario needs — in particular `QUEUE_PREFIX`, which must be unique per app/module instance so
 * parallel tests sharing the run's Redis never see each other's jobs (CLAUDE.md §5, §9).
 */
export function testConfig(overrides: Partial<Record<keyof AppConfig, string>> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgres://unused/unused',
    DATABASE_ADMIN_URL: 'postgres://unused/unused',
    REDIS_URL: inject('redisUrl'),
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'unused',
    S3_ACCESS_KEY_ID: 'unused',
    S3_SECRET_ACCESS_KEY: 'unused',
    AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    AUTH_BASE_URL: TEST_ORIGIN,
    ...overrides,
  });
}
