import { boolean, index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import {
  idColumn,
  tenantIdColumn,
  tenantIsolationPolicy,
  timestamps,
} from '../../../platform/db/columns';

export const actorKind = pgEnum('actor_kind', ['user', 'agent', 'system', 'job']);

/**
 * Append-only audit log (CLAUDE.md §10). The runtime roles may only INSERT and SELECT: the
 * migration revokes UPDATE and DELETE.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: idColumn(),
    tenantId: tenantIdColumn(),
    actorUserId: uuid(),
    actorKind: actorKind().notNull(),
    actorPlatformAdmin: boolean().notNull().default(false),
    action: text().notNull(),
    resourceType: text().notNull(),
    resourceId: text().notNull(),
    before: jsonb(),
    after: jsonb(),
    reason: text(),
    requestId: text(),
    occurredAt: timestamp({ withTimezone: true, precision: 3 }).notNull(),
    ...timestamps(),
  },
  (table) => [
    index('audit_log_tenant_occurred_idx').on(
      table.tenantId,
      table.occurredAt.desc(),
      table.id.desc(),
    ),
    index('audit_log_tenant_resource_idx').on(table.tenantId, table.resourceType, table.resourceId),
    tenantIsolationPolicy(),
  ],
);
