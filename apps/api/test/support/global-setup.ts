import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import { GenericContainer, Wait } from 'testcontainers';
import type { TestProject } from 'vitest/node';

const ROLES_SQL = resolve(__dirname, '../../../../docker/postgres/init/01-roles.sql');
const MIGRATIONS = resolve(__dirname, '../../migrations');
const REDIS_PORT = 6379;

declare module 'vitest' {
  export interface ProvidedContext {
    /** Schema-owner URL of the run's Postgres; roles and migrations already applied. */
    ownerDatabaseUrl: string;
    /** URL of the run's Redis, for `RedisModule`/`QueueModule` (BullMQ). */
    redisUrl: string;
  }
}

/**
 * One Postgres and one Redis per integration run, with the same roles and migrations as Docker
 * Compose (CLAUDE.md §14). Test files isolate themselves by creating their own tenants, users and
 * queue/tenant ids.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const [pgContainer, redisContainer] = await Promise.all([
    new PostgreSqlContainer('postgres:17-alpine')
      .withDatabase('dcm')
      .withUsername('dcm_owner')
      .withPassword('dcm_owner')
      .start(),
    new GenericContainer('redis:7-alpine')
      .withExposedPorts(REDIS_PORT)
      .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
      .start(),
  ]);
  const ownerUrl = pgContainer.getConnectionUri();
  const redisUrl = `redis://${redisContainer.getHost()}:${redisContainer.getMappedPort(REDIS_PORT)}`;

  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  await client.query(readFileSync(ROLES_SQL, 'utf8'));
  await client.end();

  const pool = new Pool({ connectionString: ownerUrl });
  await migrate(drizzle({ client: pool }), { migrationsFolder: MIGRATIONS });
  await pool.end();

  project.provide('ownerDatabaseUrl', ownerUrl);
  project.provide('redisUrl', redisUrl);
  return async () => {
    await Promise.all([pgContainer.stop(), redisContainer.stop()]);
  };
}
