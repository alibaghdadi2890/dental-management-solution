import { Pool } from 'pg';
import { inject } from 'vitest';

export interface TestDatabase {
  /** Schema owner, like the migration runner. Use only to arrange fixtures and inspect rows. */
  ownerPool: Pool;
  /** Runtime role, subject to RLS. */
  appPool: Pool;
  /** BYPASSRLS role used by withoutTenant(). */
  adminPool: Pool;
  urls: { owner: string; app: string; admin: string };
  close(): Promise<void>;
}

function urlFor(ownerUrl: string, role: string): string {
  const url = new URL(ownerUrl);
  url.username = role;
  url.password = role;
  return url.toString();
}

/** Pools on the run's shared Postgres (started once in `global-setup.ts`). */
export function connectTestDatabase(): TestDatabase {
  const owner = inject('ownerDatabaseUrl');
  const urls = { owner, app: urlFor(owner, 'dcm_app'), admin: urlFor(owner, 'dcm_admin') };
  const ownerPool = new Pool({ connectionString: urls.owner, max: 2 });
  const appPool = new Pool({ connectionString: urls.app, max: 4 });
  const adminPool = new Pool({ connectionString: urls.admin, max: 2 });
  return {
    ownerPool,
    appPool,
    adminPool,
    urls,
    async close() {
      await Promise.all([ownerPool.end(), appPool.end(), adminPool.end()]);
    },
  };
}
