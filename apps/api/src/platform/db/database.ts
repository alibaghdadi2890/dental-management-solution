import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

export type Database = NodePgDatabase;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Runtime connection (`dcm_app`): subject to row-level security. */
export const APP_DB = Symbol('APP_DB');
/** RLS-bypassing connection (`dcm_admin`): only `PlatformAdminDb.withoutTenant()` may use it. */
export const ADMIN_DB = Symbol('ADMIN_DB');

export function createDatabase(pool: Pool): Database {
  return drizzle({ client: pool, casing: 'snake_case' });
}
