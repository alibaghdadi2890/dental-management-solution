import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { FollowUpNotFoundError } from '../domain/scheduling-errors';
import { followUps } from './schema';

type FollowUpRow = typeof followUps.$inferSelect;

/** A `follow_ups` row as the application sees it (RLS supplies the tenant). */
export type StoredFollowUp = Omit<FollowUpRow, 'tenantId'>;

export type NewFollowUp = Omit<
  typeof followUps.$inferInsert,
  'tenantId' | 'createdAt' | 'updatedAt'
>;

export type FollowUpPatch = Partial<
  Pick<
    FollowUpRow,
    | 'status'
    | 'patientId'
    | 'windowFrom'
    | 'willCallBy'
    | 'willCallAt'
    | 'declinedBy'
    | 'declinedAt'
    | 'declinedReason'
  >
>;

@Injectable()
export class FollowUpsRepository {
  constructor(private readonly db: TenantDb) {}

  async insert(row: NewFollowUp): Promise<StoredFollowUp> {
    const [created] = await this.db.run((tx) => tx.insert(followUps).values(row).returning());
    if (!created) throw new Error('follow-up insert returned no row');
    return created;
  }

  async update(id: string, patch: FollowUpPatch): Promise<StoredFollowUp> {
    const [updated] = await this.db.run((tx) =>
      tx.update(followUps).set(patch).where(eq(followUps.id, id)).returning(),
    );
    if (!updated) throw new FollowUpNotFoundError(id);
    return updated;
  }

  async lock(id: string): Promise<StoredFollowUp> {
    const [row] = await this.db.run((tx) =>
      tx.select().from(followUps).where(eq(followUps.id, id)).for('update'),
    );
    if (!row) throw new FollowUpNotFoundError(id);
    return row;
  }

  byIds(ids: readonly string[]): Promise<StoredFollowUp[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select()
        .from(followUps)
        .where(inArray(followUps.id, [...new Set(ids)])),
    );
  }

  awaitingInBranch(branchId: string): Promise<StoredFollowUp[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(followUps)
        .where(and(eq(followUps.branchId, branchId), eq(followUps.status, 'awaiting'))),
    );
  }

  awaitingForPatient(patientId: string): Promise<StoredFollowUp[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(followUps)
        .where(and(eq(followUps.patientId, patientId), eq(followUps.status, 'awaiting'))),
    );
  }

  forPatient(patientId: string): Promise<StoredFollowUp[]> {
    return this.db.run((tx) =>
      tx
        .select()
        .from(followUps)
        .where(eq(followUps.patientId, patientId))
        .orderBy(desc(followUps.createdAt), desc(followUps.id)),
    );
  }

  async repointPatient(droppedId: string, keptId: string): Promise<void> {
    await this.db.run((tx) =>
      tx.update(followUps).set({ patientId: keptId }).where(eq(followUps.patientId, droppedId)),
    );
  }
}
