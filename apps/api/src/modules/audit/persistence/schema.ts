import { sql } from 'drizzle-orm';
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
    /**
     * What the change is about, for the Activity screen (feature 7, H7; ADR-0037): the patient
     * and the visit when there is one, and the area its action belongs to — null on the rows the
     * screen leaves out. No foreign keys: other modules own those tables.
     */
    patientId: uuid(),
    visitId: uuid(),
    area: text(),
    ...timestamps(),
  },
  (table) => [
    index('audit_log_tenant_occurred_idx').on(
      table.tenantId,
      table.occurredAt.desc(),
      table.id.desc(),
    ),
    index('audit_log_tenant_resource_idx').on(table.tenantId, table.resourceType, table.resourceId),
    // The Activity feed: rows with an area, newest first, optionally one area.
    index('audit_log_tenant_area_idx')
      .on(table.tenantId, table.area, table.occurredAt.desc(), table.id.desc())
      .where(sql`${table.area} is not null`),
    // "View all activity" of one patient.
    index('audit_log_tenant_patient_idx')
      .on(table.tenantId, table.patientId, table.occurredAt.desc())
      .where(sql`${table.patientId} is not null`),
    tenantIsolationPolicy(),
  ],
);
