import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import type { PeriodSnapshot } from '../domain/snapshot';
import { compensationPeriods } from './schema';

export interface StoredPeriod {
  id: string;
  profileId: string;
  month: string;
  status: 'closed' | 'reopened';
  snapshot: PeriodSnapshot;
  closedAt: Date;
  idempotencyKey: string | null;
  idempotencyHash: string | null;
}

function toStored(row: typeof compensationPeriods.$inferSelect): StoredPeriod {
  return {
    id: row.id,
    profileId: row.staffProfileId,
    month: row.month,
    status: row.status,
    snapshot: row.snapshot,
    closedAt: row.closedAt,
    idempotencyKey: row.idempotencyKey,
    idempotencyHash: row.idempotencyHash,
  };
}

/** Dentists' closed (and reopened) months (ADR-0059); never deleted. */
@Injectable()
export class PeriodsRepository {
  constructor(private readonly db: TenantDb) {}

  /**
   * The last closed month of each dentist among `profileIds` (every dentist when omitted). Closed
   * months are a prefix of a dentist's months, so the latest closed row is the last closed month.
   */
  lastClosed(profileIds?: readonly string[]): Promise<Map<string, StoredPeriod>> {
    if (profileIds?.length === 0) return Promise.resolve(new Map<string, StoredPeriod>());
    return this.db.run(async (tx) => {
      const rows = await tx
        .selectDistinctOn([compensationPeriods.staffProfileId])
        .from(compensationPeriods)
        .where(
          and(
            eq(compensationPeriods.status, 'closed'),
            profileIds === undefined
              ? undefined
              : inArray(compensationPeriods.staffProfileId, [...profileIds]),
          ),
        )
        .orderBy(compensationPeriods.staffProfileId, desc(compensationPeriods.month));
      return new Map(rows.map((row) => [row.staffProfileId, toStored(row)]));
    });
  }

  find(profileId: string, month: string): Promise<StoredPeriod | undefined> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .select()
        .from(compensationPeriods)
        .where(
          and(
            eq(compensationPeriods.staffProfileId, profileId),
            eq(compensationPeriods.month, month),
          ),
        );
      return row ? toStored(row) : undefined;
    });
  }

  /** The closed months among `months` for each dentist, with their snapshots (the report). */
  closedIn(months: readonly string[]): Promise<StoredPeriod[]> {
    if (months.length === 0) return Promise.resolve([]);
    return this.db.run(async (tx) =>
      (
        await tx
          .select()
          .from(compensationPeriods)
          .where(
            and(
              eq(compensationPeriods.status, 'closed'),
              inArray(compensationPeriods.month, [...months]),
            ),
          )
      ).map(toStored),
    );
  }

  findByIdempotencyKey(key: string): Promise<StoredPeriod | undefined> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .select()
        .from(compensationPeriods)
        .where(eq(compensationPeriods.idempotencyKey, key));
      return row ? toStored(row) : undefined;
    });
  }

  /** Which of `ids` a closed month of the dentist already counted (ADR-0059: late entries). */
  async includedAmong(profileId: string, ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const { rows } = await this.db.run((tx) =>
      tx.execute<{ id: string }>(sql`
        select distinct line_id as id
        from compensation_periods p, unnest(p.line_ids) as line_id
        where p.staff_profile_id = ${profileId}::uuid and p.status = 'closed'
          and line_id = any(${sql.param([...ids])}::text[])`),
    );
    return new Set(rows.map((row) => row.id));
  }

  async close(period: {
    profileId: string;
    month: string;
    snapshot: PeriodSnapshot;
    lineIds: readonly string[];
    at: Date;
    by: string;
    idempotency: { key: string; hash: string };
  }): Promise<void> {
    const values = {
      status: 'closed' as const,
      snapshot: period.snapshot,
      lineIds: [...period.lineIds],
      closedAt: period.at,
      closedBy: period.by,
      idempotencyKey: period.idempotency.key,
      idempotencyHash: period.idempotency.hash,
    };
    await this.db.run((tx) =>
      tx
        .insert(compensationPeriods)
        .values({ staffProfileId: period.profileId, month: period.month, ...values })
        .onConflictDoUpdate({
          target: [
            compensationPeriods.tenantId,
            compensationPeriods.staffProfileId,
            compensationPeriods.month,
          ],
          set: values,
        }),
    );
  }

  async reopen(
    id: string,
    reopen: { at: Date; by: string; reason: string; idempotency: { key: string; hash: string } },
  ): Promise<void> {
    await this.db.run((tx) =>
      tx
        .update(compensationPeriods)
        .set({
          status: 'reopened',
          reopenedAt: reopen.at,
          reopenedBy: reopen.by,
          reopenReason: reopen.reason,
          idempotencyKey: reopen.idempotency.key,
          idempotencyHash: reopen.idempotency.hash,
        })
        .where(eq(compensationPeriods.id, id)),
    );
  }
}
