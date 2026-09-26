import { sql } from 'drizzle-orm';
import { pgPolicy, timestamp, uuid } from 'drizzle-orm/pg-core';
import { newId } from '../kernel/id';

/**
 * The tenant of the current transaction, as set by `TenantDb.run()`. NULL when unset, so a query
 * that "forgets" the tenant matches nothing instead of failing a cast or matching everything.
 */
export const CURRENT_TENANT_SQL = "nullif(current_setting('app.tenant_id', true), '')::uuid";

/** uuid v7 primary key generated in the application (CLAUDE.md §7). */
export const idColumn = () => uuid().primaryKey().$defaultFn(newId);

/**
 * `tenant_id` filled by the database from the transaction's tenant, so repositories never pass it
 * (CLAUDE.md §5). Pair it with `tenantIsolationPolicy()` and an index.
 */
export const tenantIdColumn = () => uuid().notNull().default(sql.raw(CURRENT_TENANT_SQL));

export const timestamps = () => ({
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** Soft delete for patient-facing records (CLAUDE.md §7). */
export const deletedAtColumn = () => timestamp({ withTimezone: true });

/** Row-level security for every tenant-owned table; drizzle-kit enables RLS when a policy exists. */
export const tenantIsolationPolicy = () =>
  pgPolicy('tenant_isolation', {
    as: 'permissive',
    for: 'all',
    using: sql.raw(`tenant_id = ${CURRENT_TENANT_SQL}`),
    withCheck: sql.raw(`tenant_id = ${CURRENT_TENANT_SQL}`),
  });
