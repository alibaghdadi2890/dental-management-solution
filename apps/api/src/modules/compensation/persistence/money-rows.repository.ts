import type { AdjustmentKind, PaymentMethod } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, between, eq, inArray, sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { compensationAdjustments, compensationPayouts } from './schema';

interface Voided {
  voidedAt: Date | null;
  voidReason: string | null;
}

export interface StoredAdjustment extends Voided {
  id: string;
  profileId: string;
  kind: AdjustmentKind;
  amount: string;
  currency: string;
  date: string;
  note: string | null;
  createdAt: Date;
  idempotencyHash: string | null;
}

export interface StoredPayout extends Voided {
  id: string;
  profileId: string;
  amount: string;
  currency: string;
  date: string;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  createdAt: Date;
  idempotencyHash: string | null;
}

export interface Idempotency {
  key: string;
  hash: string;
}

export interface VoidMark {
  at: Date;
  by: string;
  reason: string;
}

/** Requests sharing an `Idempotency-Key` run one at a time, to the end of the transaction. */
async function lockKey(db: TenantDb, key: string): Promise<void> {
  await db.run((tx) =>
    tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`compensation-key:${key}`}, 0))`,
    ),
  );
}

function toAdjustment(row: typeof compensationAdjustments.$inferSelect): StoredAdjustment {
  return {
    id: row.id,
    profileId: row.staffProfileId,
    kind: row.kind,
    amount: row.amount,
    currency: row.currency,
    date: row.effectiveDate,
    note: row.note,
    createdAt: row.createdAt,
    idempotencyHash: row.idempotencyHash,
    voidedAt: row.voidedAt,
    voidReason: row.voidReason,
  };
}

function toPayout(row: typeof compensationPayouts.$inferSelect): StoredPayout {
  return {
    id: row.id,
    profileId: row.staffProfileId,
    amount: row.amount,
    currency: row.currency,
    date: row.paidOn,
    method: row.method,
    reference: row.reference,
    note: row.note,
    createdAt: row.createdAt,
    idempotencyHash: row.idempotencyHash,
    voidedAt: row.voidedAt,
    voidReason: row.voidReason,
  };
}

/** The owner's adjustments to dentists' statements; append-only, voided with a reason. */
@Injectable()
export class AdjustmentsRepository {
  constructor(private readonly db: TenantDb) {}

  lockIdempotencyKey(key: string): Promise<void> {
    return lockKey(this.db, key);
  }

  findByIdempotencyKey(key: string): Promise<StoredAdjustment | undefined> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .select()
        .from(compensationAdjustments)
        .where(eq(compensationAdjustments.idempotencyKey, key));
      return row ? toAdjustment(row) : undefined;
    });
  }

  /** The adjustments of `profileIds` (every dentist when omitted) dated in [from, to], oldest first. */
  list(
    range: { from: string; to: string },
    profileIds?: readonly string[],
  ): Promise<StoredAdjustment[]> {
    if (profileIds?.length === 0) return Promise.resolve([]);
    return this.db.run(async (tx) =>
      (
        await tx
          .select()
          .from(compensationAdjustments)
          .where(
            and(
              between(compensationAdjustments.effectiveDate, range.from, range.to),
              profileIds === undefined
                ? undefined
                : inArray(compensationAdjustments.staffProfileId, [...profileIds]),
            ),
          )
          .orderBy(
            asc(compensationAdjustments.effectiveDate),
            asc(compensationAdjustments.createdAt),
          )
      ).map(toAdjustment),
    );
  }

  /** The earliest date of a non-voided adjustment per dentist (the first month). */
  firstDates(profileIds?: readonly string[]): Promise<Map<string, string>> {
    return firstDates(this.db, 'compensation_adjustments', 'effective_date', profileIds);
  }

  find(profileId: string, id: string): Promise<StoredAdjustment | undefined> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .select()
        .from(compensationAdjustments)
        .where(
          and(
            eq(compensationAdjustments.id, id),
            eq(compensationAdjustments.staffProfileId, profileId),
          ),
        );
      return row ? toAdjustment(row) : undefined;
    });
  }

  insert(row: {
    profileId: string;
    kind: AdjustmentKind;
    amount: string;
    currency: string;
    date: string;
    note: string | null;
    createdBy: string;
    idempotency: Idempotency;
  }): Promise<StoredAdjustment> {
    return this.db.run(async (tx) => {
      const [inserted] = await tx
        .insert(compensationAdjustments)
        .values({
          staffProfileId: row.profileId,
          kind: row.kind,
          amount: row.amount,
          currency: row.currency,
          effectiveDate: row.date,
          note: row.note,
          createdBy: row.createdBy,
          idempotencyKey: row.idempotency.key,
          idempotencyHash: row.idempotency.hash,
        })
        .returning();
      if (!inserted) throw new Error('compensation_adjustments insert returned no row');
      return toAdjustment(inserted);
    });
  }

  async void(id: string, mark: VoidMark): Promise<void> {
    await this.db.run((tx) =>
      tx
        .update(compensationAdjustments)
        .set({ voidedAt: mark.at, voidedBy: mark.by, voidReason: mark.reason })
        .where(eq(compensationAdjustments.id, id)),
    );
  }
}

/** Money paid to dentists; append-only, voided with a reason. */
@Injectable()
export class PayoutsRepository {
  constructor(private readonly db: TenantDb) {}

  lockIdempotencyKey(key: string): Promise<void> {
    return lockKey(this.db, key);
  }

  findByIdempotencyKey(key: string): Promise<StoredPayout | undefined> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .select()
        .from(compensationPayouts)
        .where(eq(compensationPayouts.idempotencyKey, key));
      return row ? toPayout(row) : undefined;
    });
  }

  list(
    range: { from: string; to: string },
    profileIds?: readonly string[],
  ): Promise<StoredPayout[]> {
    if (profileIds?.length === 0) return Promise.resolve([]);
    return this.db.run(async (tx) =>
      (
        await tx
          .select()
          .from(compensationPayouts)
          .where(
            and(
              between(compensationPayouts.paidOn, range.from, range.to),
              profileIds === undefined
                ? undefined
                : inArray(compensationPayouts.staffProfileId, [...profileIds]),
            ),
          )
          .orderBy(asc(compensationPayouts.paidOn), asc(compensationPayouts.createdAt))
      ).map(toPayout),
    );
  }

  firstDates(profileIds?: readonly string[]): Promise<Map<string, string>> {
    return firstDates(this.db, 'compensation_payouts', 'paid_on', profileIds);
  }

  find(profileId: string, id: string): Promise<StoredPayout | undefined> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .select()
        .from(compensationPayouts)
        .where(
          and(eq(compensationPayouts.id, id), eq(compensationPayouts.staffProfileId, profileId)),
        );
      return row ? toPayout(row) : undefined;
    });
  }

  insert(row: {
    profileId: string;
    amount: string;
    currency: string;
    date: string;
    method: PaymentMethod;
    reference: string | null;
    note: string | null;
    createdBy: string;
    idempotency: Idempotency;
  }): Promise<StoredPayout> {
    return this.db.run(async (tx) => {
      const [inserted] = await tx
        .insert(compensationPayouts)
        .values({
          staffProfileId: row.profileId,
          amount: row.amount,
          currency: row.currency,
          paidOn: row.date,
          method: row.method,
          reference: row.reference,
          note: row.note,
          createdBy: row.createdBy,
          idempotencyKey: row.idempotency.key,
          idempotencyHash: row.idempotency.hash,
        })
        .returning();
      if (!inserted) throw new Error('compensation_payouts insert returned no row');
      return toPayout(inserted);
    });
  }

  async void(id: string, mark: VoidMark): Promise<void> {
    await this.db.run((tx) =>
      tx
        .update(compensationPayouts)
        .set({ voidedAt: mark.at, voidedBy: mark.by, voidReason: mark.reason })
        .where(eq(compensationPayouts.id, id)),
    );
  }
}

async function firstDates(
  db: TenantDb,
  table: 'compensation_adjustments' | 'compensation_payouts',
  column: 'effective_date' | 'paid_on',
  profileIds?: readonly string[],
): Promise<Map<string, string>> {
  if (profileIds?.length === 0) return new Map();
  const filter =
    profileIds === undefined
      ? sql``
      : sql`and staff_profile_id = any(${sql.param([...profileIds])}::uuid[])`;
  const { rows } = await db.run((tx) =>
    tx.execute<{ staff_profile_id: string; first: string }>(sql`
      select staff_profile_id, min(${sql.raw(column)})::text as first
      from ${sql.raw(table)}
      where voided_at is null ${filter}
      group by staff_profile_id`),
  );
  return new Map(rows.map((row) => [row.staff_profile_id, row.first]));
}
