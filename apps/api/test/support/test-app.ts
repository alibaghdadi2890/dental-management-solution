import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  CORE_PLATFORM_MODULES,
  DOMAIN_MODULES,
  QUEUE_PLATFORM_MODULES,
} from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { CLOCK } from '../../src/platform/clock/clock.module';
import { APP_CONFIG } from '../../src/platform/config/config.module';
import { FixedClock } from '../../src/platform/kernel/clock';
import { newId } from '../../src/platform/kernel/id';
import { FakeStorageModule } from './fake-storage';
import type { TestDatabase } from './postgres';
import { testConfig } from './test-config';

export interface TestApp {
  app: INestApplication;
  clock: FixedClock;
  close(): Promise<void>;
}

/**
 * The real HTTP app (guards, pipes, filters, better-auth) on the run's Postgres and Redis, with
 * queues wired up (their own BullMQ key prefix, so parallel `createTestApp` calls never share
 * jobs), with object storage faked (`FakeObjectStorage`), and with a clock tests can move.
 */
export async function createTestApp(database: TestDatabase): Promise<TestApp> {
  const config = testConfig({
    DATABASE_URL: database.urls.app,
    DATABASE_ADMIN_URL: database.urls.admin,
    DATABASE_POOL_MAX: '4',
    QUEUE_PREFIX: `test-${newId()}`,
  });
  const clock = new FixedClock(new Date());

  const moduleRef = await Test.createTestingModule({
    imports: [
      ...CORE_PLATFORM_MODULES,
      ...QUEUE_PLATFORM_MODULES,
      FakeStorageModule,
      ...DOMAIN_MODULES,
    ],
  })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(CLOCK)
    .useValue(clock)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app);
  // Listening once up front (loopback, a free port): supertest otherwise calls `listen(0)` on the
  // same server for every request, and more than 10 concurrent ones trip MaxListenersExceeded.
  await app.listen(0, '127.0.0.1');
  return { app, clock, close: () => app.close() };
}
