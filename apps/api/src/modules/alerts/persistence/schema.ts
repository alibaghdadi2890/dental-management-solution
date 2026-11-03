import { index, pgTable, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import {
  idColumn,
  tenantIdColumn,
  tenantIsolationPolicy,
  timestamps,
} from '../../../platform/db/columns';

/**
 * Who follows which dentist (feature 15, D3): the follower is alerted when that dentist's patient
 * arrives or their visit starts. A dentist is always alerted for their own, without a row. The
 * dentist is a staff profile id (ADR-0020) and the follower an auth user id; neither has a foreign
 * key, `users` owns both tables (CLAUDE.md §4 rule 1). Junction: unfollowing hard-deletes.
 */
export const alertFollows = pgTable(
  'alert_follows',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    userId: uuid().notNull(),
    dentistId: uuid().notNull(),
    ...timestamps(),
  },
  (table) => [
    index('alert_follows_tenant_idx').on(table.tenantId),
    uniqueIndex('alert_follows_user_dentist_key').on(table.tenantId, table.userId, table.dentistId),
    tenantIsolationPolicy(),
  ],
);
