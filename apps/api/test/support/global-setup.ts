import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import type { TestProject } from 'vitest/node';

const ROLES_SQL = resolve(__dirname, '../../../../docker/postgres/init/01-roles.sql');
const MIGRATIONS = resolve(__dirname, '../../migrations');

declare module 'vitest' {
  export interface ProvidedContext {
    /** Schema-owner URL of the run's Postgres; roles and migrations already applied. */
    ownerDatabaseUrl: string;
  }
}

/**
 * One Postgres per integration run, with the same roles and migrations as Docker Compose
 * (CLAUDE.md §14). Test files isolate themselves by creating their own tenants and users.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const container = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('dcm')
    .withUsername('dcm_owner')
    .withPassword('dcm_owner')
    .start();
  const ownerUrl = container.getConnectionUri();

  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  await client.query(readFileSync(ROLES_SQL, 'utf8'));
  await client.end();

  const pool = new Pool({ connectionString: ownerUrl });
  await migrate(drizzle({ client: pool }), { migrationsFolder: MIGRATIONS });
  await pool.end();

  project.provide('ownerDatabaseUrl', ownerUrl);
  return async () => {
    await container.stop();
  };
}
