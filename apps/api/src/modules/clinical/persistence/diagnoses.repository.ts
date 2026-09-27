import type { DiagnosisItem } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { type CatalogStore, rethrowCodeRace, swappingCode } from './catalog-store';
import { diagnoses } from './schema';

type DiagnosisRow = typeof diagnoses.$inferSelect;

function toDiagnosis(row: DiagnosisRow): DiagnosisItem {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    category: row.category,
    frequent: row.frequent,
    active: row.active,
  };
}

function toRow(item: DiagnosisItem) {
  return {
    code: item.code,
    name: item.name,
    category: item.category,
    frequent: item.frequent,
    active: item.active,
  };
}

const live = isNull(diagnoses.deletedAt);

/** The diagnosis catalog of the current tenant (RLS). */
@Injectable()
export class DiagnosesRepository implements CatalogStore<DiagnosisItem> {
  constructor(private readonly db: TenantDb) {}

  list(): Promise<DiagnosisItem[]> {
    return this.db.run(async (tx) =>
      (
        await tx
          .select()
          .from(diagnoses)
          .where(live)
          .orderBy(asc(diagnoses.createdAt), asc(diagnoses.id))
      ).map(toDiagnosis),
    );
  }

  byId(id: string): Promise<DiagnosisItem | undefined> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .select()
        .from(diagnoses)
        .where(and(eq(diagnoses.id, id), live));
      return row && toDiagnosis(row);
    });
  }

  async save(items: readonly DiagnosisItem[], existingIds: ReadonlySet<string>): Promise<void> {
    const updates = items.filter((item) => existingIds.has(item.id));
    const inserts = items.filter((item) => !existingIds.has(item.id));
    try {
      await this.db.run(async (tx) => {
        for (const item of updates) {
          await tx
            .update(diagnoses)
            .set({ code: swappingCode(item.id) })
            .where(eq(diagnoses.id, item.id));
        }
        for (const item of updates) {
          await tx.update(diagnoses).set(toRow(item)).where(eq(diagnoses.id, item.id));
        }
        if (inserts.length > 0) {
          await tx
            .insert(diagnoses)
            .values(inserts.map((item) => ({ id: item.id, ...toRow(item) })));
        }
      });
    } catch (error) {
      rethrowCodeRace(error, 'diagnoses_code_unique');
    }
  }

  insertIfAbsent(items: readonly DiagnosisItem[]): Promise<DiagnosisItem[]> {
    if (items.length === 0) return Promise.resolve([]);
    return this.db.run(async (tx) =>
      (
        await tx
          .insert(diagnoses)
          .values(items.map((item) => ({ id: item.id, ...toRow(item) })))
          .onConflictDoNothing()
          .returning()
      ).map(toDiagnosis),
    );
  }

  async softDelete(id: string): Promise<void> {
    await this.db.run((tx) =>
      tx
        .update(diagnoses)
        .set({ deletedAt: sql`now()` })
        .where(and(eq(diagnoses.id, id), live)),
    );
  }

  deactivate(id: string): Promise<DiagnosisItem> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .update(diagnoses)
        .set({ active: false })
        .where(and(eq(diagnoses.id, id), live))
        .returning();
      if (!row) throw new Error(`diagnosis ${id} vanished inside its transaction`);
      return toDiagnosis(row);
    });
  }

  async countLive(): Promise<number> {
    const [row] = await this.db.run((tx) => tx.select({ n: count() }).from(diagnoses).where(live));
    return row?.n ?? 0;
  }
}
