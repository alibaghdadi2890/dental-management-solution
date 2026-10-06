import { Injectable } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { RecordNotFoundError } from '../domain/visit-errors';
import { planGroups } from './schema';

type PlanGroupRow = typeof planGroups.$inferSelect;

/** A `plan_groups` row as the application sees it (RLS supplies the tenant). */
export type StoredPlanGroup = Omit<PlanGroupRow, 'tenantId'>;

export type NewPlanGroup = Pick<StoredPlanGroup, 'patientId' | 'title' | 'note' | 'createdBy'>;

/** A rename, a new note, or the soft delete. */
export type PlanGroupPatch = Partial<Pick<StoredPlanGroup, 'title' | 'note' | 'deletedAt'>>;

function toStored({ tenantId: _tenantId, ...group }: PlanGroupRow): StoredPlanGroup {
  return group;
}

/** The named plans of the tenant's patients (RLS through `TenantDb`). Every lookup names the
 * patient too, so another patient's group reads as not found. */
@Injectable()
export class PlanGroupsRepository {
  constructor(private readonly db: TenantDb) {}

  async insert(group: NewPlanGroup): Promise<StoredPlanGroup> {
    const [row] = await this.db.run((tx) => tx.insert(planGroups).values(group).returning());
    if (!row) throw new Error('plan group insert returned no row');
    return toStored(row);
  }

  /** The patient's named plan (not removed) `FOR UPDATE`; else 404 `record.not_found`. */
  lockForPatient(id: string, patientId: string): Promise<StoredPlanGroup> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .select()
        .from(planGroups)
        .where(
          and(
            eq(planGroups.id, id),
            eq(planGroups.patientId, patientId),
            isNull(planGroups.deletedAt),
          ),
        )
        .for('update');
      if (!row) throw new RecordNotFoundError('Named plan not found for this patient');
      return toStored(row);
    });
  }

  /** The patient's named plans that aren't removed, oldest first. */
  listForPatient(patientId: string): Promise<StoredPlanGroup[]> {
    return this.db.run(async (tx) =>
      (
        await tx
          .select()
          .from(planGroups)
          .where(and(eq(planGroups.patientId, patientId), isNull(planGroups.deletedAt)))
          .orderBy(asc(planGroups.createdAt), asc(planGroups.id))
      ).map(toStored),
    );
  }

  async update(id: string, patch: PlanGroupPatch): Promise<StoredPlanGroup> {
    const [row] = await this.db.run((tx) =>
      tx.update(planGroups).set(patch).where(eq(planGroups.id, id)).returning(),
    );
    if (!row) throw new RecordNotFoundError('Named plan not found');
    return toStored(row);
  }

  /** The merge re-point: every named plan of `droppedId`, removed ones included, moves to
   * `keptId`. Returns how many moved. */
  async repointPatient(droppedId: string, keptId: string): Promise<number> {
    const rows = await this.db.run((tx) =>
      tx
        .update(planGroups)
        .set({ patientId: keptId })
        .where(eq(planGroups.patientId, droppedId))
        .returning({ id: planGroups.id }),
    );
    return rows.length;
  }
}
