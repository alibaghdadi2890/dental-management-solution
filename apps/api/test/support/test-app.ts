import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { CORE_PLATFORM_MODULES, DOMAIN_MODULES } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { CLOCK } from '../../src/platform/clock/clock.module';
import { APP_CONFIG } from '../../src/platform/config/config.module';
import { loadConfig } from '../../src/platform/config/config.schema';
import { FixedClock } from '../../src/platform/kernel/clock';
import type { TestDatabase } from './postgres';

export const TEST_ORIGIN = 'http://localhost:5173';

export interface TestApp {
  app: INestApplication;
  clock: FixedClock;
  close(): Promise<void>;
}

/**
 * The real HTTP app (guards, pipes, filters, better-auth) on the run's Postgres, without Redis,
 * queues or storage, and with a clock tests can move.
 */
export async function createTestApp(database: TestDatabase): Promise<TestApp> {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: database.urls.app,
    DATABASE_ADMIN_URL: database.urls.admin,
    DATABASE_POOL_MAX: '4',
    REDIS_URL: 'redis://127.0.0.1:1',
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'unused',
    S3_ACCESS_KEY_ID: 'unused',
    S3_SECRET_ACCESS_KEY: 'unused',
    AUTH_SECRET: 'test-secret-that-is-at-least-32-characters-long',
    AUTH_BASE_URL: TEST_ORIGIN,
  });
  const clock = new FixedClock(new Date());

  const moduleRef = await Test.createTestingModule({
    imports: [...CORE_PLATFORM_MODULES, ...DOMAIN_MODULES],
  })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(CLOCK)
    .useValue(clock)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  await app.init();
  return { app, clock, close: () => app.close() };
}
