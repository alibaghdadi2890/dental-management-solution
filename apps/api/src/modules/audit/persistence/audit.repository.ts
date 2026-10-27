import {
  activityAreaSchema,
  type ActivityArea,
  type AuditEntry,
  COMPENSATION_EVENTS,
  type PlatformAuditEntry,
} from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, isNotNull, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
import type { Transaction } from '../../../platform/db/database';
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
  /** Only rows with an area: the Activity feed. */
  feed?: boolean | undefined;
  area?: ActivityArea | undefined;
  actorUserId?: string | undefined;
  platformAdmin?: boolean | undefined;
  from?: Date | undefined;
  patientId?: string | undefined;
  visitId?: string | undefined;
  /** The visit scope (ADR-0055): rows about another visit are left out; rows about no visit stay. */
  visitIdsIn?: readonly string[] | undefined;
  /** Without `finance:read` (ADR-0055): no payment or ledger rows, and no raw domain events
   * (they carry payment facts and are on no screen). */
  withoutMoney?: boolean | undefined;
  /** Without `compensation:manage`, and always across clinics (ADR-0060): no compensation rows,
   * nor their raw domain events. */
  withoutCompensation?: boolean | undefined;
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
    patientId: row.patientId,
    visitId: row.visitId,
    // Text in the database; anything outside the vocabulary reads as "no area".
    area: activityAreaSchema.safeParse(row.area).data ?? null,
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
    return (await this.db.run((tx) => this.select(tx, filter))).map(toEntry);
  }

  /**
   * Every clinic's rows (ADR-0057), in the `withoutTenant()` transaction of a platform admin:
   * RLS does not apply there, so `tenantId` is the only clinic filter.
   */
  async listAcrossTenants(
    tx: Transaction,
    filter: AuditFilter & { tenantId?: string | undefined },
  ): Promise<PlatformAuditEntry[]> {
    return (await this.select(tx, filter)).map((row) => ({
      ...toEntry(row),
      tenantId: row.tenantId,
    }));
  }

  private select(tx: Transaction, filter: AuditFilter & { tenantId?: string | undefined }) {
    const conditions: SQL[] = [];
    if (filter.tenantId) conditions.push(eq(auditLog.tenantId, filter.tenantId));
    if (filter.resourceType) conditions.push(eq(auditLog.resourceType, filter.resourceType));
    if (filter.resourceId) conditions.push(eq(auditLog.resourceId, filter.resourceId));
    if (filter.feed) conditions.push(isNotNull(auditLog.area));
    if (filter.area) conditions.push(eq(auditLog.area, filter.area));
    if (filter.actorUserId) conditions.push(eq(auditLog.actorUserId, filter.actorUserId));
    if (filter.platformAdmin !== undefined) {
      conditions.push(eq(auditLog.actorPlatformAdmin, filter.platformAdmin));
    }
    if (filter.from) conditions.push(gte(auditLog.occurredAt, filter.from));
    if (filter.patientId) conditions.push(eq(auditLog.patientId, filter.patientId));
    if (filter.visitId) conditions.push(eq(auditLog.visitId, filter.visitId));
    if (filter.visitIdsIn) {
      conditions.push(
        or(
          isNull(auditLog.visitId),
          sql`${auditLog.visitId} = any(${sql.param([...filter.visitIdsIn])}::uuid[])`,
        ) ?? sql`false`,
      );
    }
    if (filter.withoutMoney) {
      conditions.push(
        sql`not (${auditLog.action} like 'payment.%' or ${auditLog.action} like 'ledger\_entry.%' or ${auditLog.resourceType} = 'event')`,
      );
    }
    if (filter.withoutCompensation) {
      conditions.push(
        sql`not (${auditLog.resourceType} like 'compensation\_%' or (${auditLog.resourceType} = 'event' and ${auditLog.action} = any(${sql.param([...COMPENSATION_EVENTS])}::text[])))`,
      );
    }
    if (filter.after) {
      const { occurredAt, id } = filter.after;
      const older = or(
        lt(auditLog.occurredAt, occurredAt),
        and(eq(auditLog.occurredAt, occurredAt), lt(auditLog.id, id)),
      );
      if (older) conditions.push(older);
    }
    return tx
      .select()
      .from(auditLog)
      .where(and(...conditions))
      .orderBy(desc(auditLog.occurredAt), desc(auditLog.id))
      .limit(filter.limit);
  }
}
