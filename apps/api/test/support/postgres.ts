import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';

const ROLES_SQL = resolve(__dirname, '../../../../docker/postgres/init/01-roles.sql');
const MIGRATIONS = resolve(__dirname, '../../migrations');

export interface TestDatabase {
  /** Schema owner, like the migration runner. Use only to arrange fixtures. */
  ownerPool: Pool;
  /** Runtime role, subject to RLS. */
  appPool: Pool;
  /** BYPASSRLS role used by withoutTenant(). */
  adminPool: Pool;
  stop(): Promise<void>;
}

/** Postgres with the same roles and migrations as Docker Compose (CLAUDE.md §14). */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('dcm')
    .withUsername('dcm_owner')
    .withPassword('dcm_owner')
    .start();
  const ownerUrl = container.getConnectionUri();

  const setup = new Client({ connectionString: ownerUrl });
  await setup.connect();
  await setup.query(readFileSync(ROLES_SQL, 'utf8'));
  await setup.end();

  const ownerPool = new Pool({ connectionString: ownerUrl });
  await migrate(drizzle({ client: ownerPool }), { migrationsFolder: MIGRATIONS });

  const poolFor = (role: string) => {
    const url = new URL(ownerUrl);
    url.username = role;
    url.password = role;
    return new Pool({ connectionString: url.toString() });
  };
  const appPool = poolFor('dcm_app');
  const adminPool = poolFor('dcm_admin');

  return {
    ownerPool,
    appPool,
    adminPool,
    async stop() {
      await Promise.all([ownerPool.end(), appPool.end(), adminPool.end()]);
      await container.stop();
    },
  };
}
