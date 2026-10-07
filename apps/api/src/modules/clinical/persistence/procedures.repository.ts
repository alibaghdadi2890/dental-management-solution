import type { ServiceItem, ToothEffect } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import {
  type CatalogRowLock,
  type CatalogStore,
  rethrowCodeRace,
  swappingCode,
} from './catalog-store';
import { procedures, treatmentPlans, visitServices } from './schema';

type ProcedureRow = typeof procedures.$inferSelect;

function toService(row: ProcedureRow): ServiceItem {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category,
    chargeUnit: row.chargeUnit,
    price: { amount: row.priceAmount, currency: row.priceCurrency },
    frequent: row.frequent,
    active: row.active,
    toothEffect: row.toothEffect,
  };
}

function toRow(item: ServiceItem) {
  return {
    code: item.code,
    name: item.name,
    category: item.category,
    chargeUnit: item.chargeUnit,
    priceAmount: item.price.amount,
    priceCurrency: item.price.currency,
    frequent: item.frequent,
    active: item.active,
    toothEffect: item.toothEffect,
  };
}

const live = isNull(procedures.deletedAt);

/** The service catalog of the current tenant (RLS). */
@Injectable()
export class ProceduresRepository implements CatalogStore<ServiceItem> {
  constructor(private readonly db: TenantDb) {}

  list(): Promise<ServiceItem[]> {
    return this.db.run(async (tx) =>
      (
        await tx
          .select()
          .from(procedures)
          .where(live)
          .orderBy(asc(procedures.createdAt), asc(procedures.id))
      ).map(toService),
    );
  }

  /**
   * What performing the service does to a tooth (H2), read for a visit service that is being
   * recorded or performed from a plan. A service removed from the catalog since still answers:
   * the record keeps pointing at its row.
   */
  async toothEffectOf(id: string): Promise<ToothEffect> {
    const [row] = await this.db.run((tx) =>
      tx.select({ effect: procedures.toothEffect }).from(procedures).where(eq(procedures.id, id)),
    );
    return row?.effect ?? 'none';
  }

  byId(id: string, lock?: CatalogRowLock): Promise<ServiceItem | undefined> {
    return this.db.run(async (tx) => {
      const query = tx
        .select()
        .from(procedures)
        .where(and(eq(procedures.id, id), live));
      const [row] = await (lock === undefined ? query : query.for(lock));
      return row && toService(row);
    });
  }

  async save(items: readonly ServiceItem[], existingIds: ReadonlySet<string>): Promise<void> {
    const updates = items.filter((item) => existingIds.has(item.id));
    const inserts = items.filter((item) => !existingIds.has(item.id));
    try {
      await this.db.run(async (tx) => {
        for (const item of updates) {
          await tx
            .update(procedures)
            .set({ code: swappingCode(item.id) })
            .where(eq(procedures.id, item.id));
        }
        for (const item of updates) {
          await tx.update(procedures).set(toRow(item)).where(eq(procedures.id, item.id));
        }
        if (inserts.length > 0) {
          await tx
            .insert(procedures)
            .values(inserts.map((item) => ({ id: item.id, ...toRow(item) })));
        }
      });
    } catch (error) {
      rethrowCodeRace(error, 'procedures_code_unique');
    }
  }

  insertIfAbsent(items: readonly ServiceItem[]): Promise<ServiceItem[]> {
    if (items.length === 0) return Promise.resolve([]);
    return this.db.run(async (tx) =>
      (
        await tx
          .insert(procedures)
          .values(items.map((item) => ({ id: item.id, ...toRow(item) })))
          .onConflictDoNothing()
          .returning()
      ).map(toService),
    );
  }

  async softDelete(id: string): Promise<void> {
    await this.db.run((tx) =>
      tx
        .update(procedures)
        .set({ deletedAt: sql`now()` })
        .where(and(eq(procedures.id, id), live)),
    );
  }

  deactivate(id: string): Promise<ServiceItem> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .update(procedures)
        .set({ active: false })
        .where(and(eq(procedures.id, id), live))
        .returning();
      if (!row) throw new Error(`procedure ${id} vanished inside its transaction`);
      return toService(row);
    });
  }

  async countLive(): Promise<number> {
    const [row] = await this.db.run((tx) => tx.select({ n: count() }).from(procedures).where(live));
    return row?.n ?? 0;
  }

  /** A service or a plan that isn't removed names the procedure; one query of two `exists`. */
  async isInUse(id: string): Promise<boolean> {
    const {
      rows: [row],
    } = await this.db.run((tx) =>
      tx.execute<{ used: boolean }>(
        sql`select exists (select 1 from ${visitServices} where ${visitServices.procedureId} = ${id} and ${isNull(visitServices.deletedAt)})
             or exists (select 1 from ${treatmentPlans} where ${treatmentPlans.procedureId} = ${id} and ${isNull(treatmentPlans.deletedAt)}) as used`,
      ),
    );
    return row?.used ?? false;
  }
}
