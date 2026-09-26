import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { http } from '../../../test/support/http';
import { APP_DB } from '../db/database';
import { REDIS } from '../redis/redis.module';
import { HealthModule } from './health.module';

async function start(options: { databaseUp: boolean; redisUp: boolean }) {
  const moduleRef = await Test.createTestingModule({ imports: [HealthModule] })
    .useMocker((token) => {
      if (token === APP_DB) {
        return {
          execute: () =>
            options.databaseUp ? Promise.resolve() : Promise.reject(new Error('db down')),
        };
      }
      if (token === REDIS) {
        return {
          ping: () =>
            options.redisUp ? Promise.resolve('PONG') : Promise.reject(new Error('down')),
        };
      }
      return undefined;
    })
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return app;
}

describe('health endpoints', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it('reports liveness without touching dependencies', async () => {
    app = await start({ databaseUp: false, redisUp: false });
    const response = await http(app).get('/health/live');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('is ready when the database and Redis respond', async () => {
    app = await start({ databaseUp: true, redisUp: true });
    const response = await http(app).get('/health/ready');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });

  it('returns 503 naming the failing dependency', async () => {
    app = await start({ databaseUp: true, redisUp: false });
    const response = await http(app).get('/health/ready');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      status: 'unavailable',
      checks: { database: 'up', redis: 'down' },
    });
  });
});
