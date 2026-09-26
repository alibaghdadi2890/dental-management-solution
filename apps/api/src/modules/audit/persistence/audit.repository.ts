import type { AuditEntry } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { and, desc, eq, lt, or, type SQL } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import type { AuditCursorPosition } from '../domain/audit-cursor';
import { auditLog } from './schema';

export type NewAuditRow = Omit<
  typeof auditLog.$inferInsert,
  'id' | 'tenantId' | 'createdAt' | 'updatedAt'
>;

export interface AuditFilter {
  resourceType?: string | undefined;
  resourceId?: string | undefined;
  after?: AuditCursorPosition | undefined;
  limit: number;
}

type AuditRow = typeof auditLog.$inferSelect;

function toEntry(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    actorUserId: row.actorUserId,
    actorKind: row.actorKind,
    actorPlatformAdmin: row.actorPlatformAdmin,
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    before: row.before,
    after: row.after,
    reason: row.reason,
    requestId: row.requestId,
    occurredAt: row.occurredAt.toISOString(),
  };
}

@Injectable()
export class AuditRepository {
  constructor(private readonly db: TenantDb) {}

  async insert(row: NewAuditRow): Promise<void> {
    await this.db.run((tx) => tx.insert(auditLog).values(row));
  }

  /** Newest first; RLS limits rows to the current tenant. */
  async list(filter: AuditFilter): Promise<AuditEntry[]> {
    const conditions: SQL[] = [];
    if (filter.resourceType) conditions.push(eq(auditLog.resourceType, filter.resourceType));
    if (filter.resourceId) conditions.push(eq(auditLog.resourceId, filter.resourceId));
    if (filter.after) {
      const { occurredAt, id } = filter.after;
      const older = or(
        lt(auditLog.occurredAt, occurredAt),
        and(eq(auditLog.occurredAt, occurredAt), lt(auditLog.id, id)),
      );
      if (older) conditions.push(older);
    }
    const rows = await this.db.run((tx) =>
      tx
        .select()
        .from(auditLog)
        .where(and(...conditions))
        .orderBy(desc(auditLog.occurredAt), desc(auditLog.id))
        .limit(filter.limit),
    );
    return rows.map(toEntry);
  }
}
