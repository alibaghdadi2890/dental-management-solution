import '../load-env';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/**
 * Applies the committed migrations as the schema owner (`DATABASE_MIGRATION_URL`), the way
 * `drizzle-kit migrate` does, without drizzle-kit: the deployed image carries production
 * dependencies only (apps/api/Dockerfile). Same journal, same `drizzle.__drizzle_migrations`
 * table, so the two can be used interchangeably. Forward-only: a failure rolls the pending
 * migrations back and leaves the schema as it was.
 */
async function main(): Promise<void> {
  const url = process.env['DATABASE_MIGRATION_URL'];
  if (!url) {
    console.error('DATABASE_MIGRATION_URL is not set');
    process.exitCode = 1;
    return;
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: resolve(__dirname, '../../migrations') });
    console.log('migrations applied');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
