import type { ToothPresenceValue } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { toothStatus } from './schema';

type ToothStatusRow = typeof toothStatus.$inferSelect;

/** A `tooth_status` row as the application sees it (RLS supplies the tenant). */
export type StoredToothStatus = Omit<ToothStatusRow, 'tenantId'>;

export interface ToothStatusChange {
  patientId: string;
  position: string;
  present: ToothPresenceValue;
  changedInVisitId: string;
  changedBy: string;
}

/** A dropped patient's row that a merge deleted, for the audit's `before`. */
export type DroppedToothStatus = Pick<
  StoredToothStatus,
  'position' | 'present' | 'changedInVisitId'
>;

function toStored({ tenantId: _tenantId, ...status }: ToothStatusRow): StoredToothStatus {
  return status;
}

/** Which tooth is present per succession position of the tenant's patients (W5; RLS). */
@Injectable()
export class ToothStatusRepository {
  constructor(private readonly db: TenantDb) {}

  /** The patient's rows, by position. */
  listForPatient(patientId: string): Promise<StoredToothStatus[]> {
    return this.db.run(async (tx) =>
      (
        await tx
          .select()
          .from(toothStatus)
          .where(eq(toothStatus.patientId, patientId))
          .orderBy(asc(toothStatus.position))
      ).map(toStored),
    );
  }

  /** The patient's row at `position` `FOR UPDATE`, or undefined when the stage still decides. */
  lockAt(patientId: string, position: string): Promise<StoredToothStatus | undefined> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .select()
        .from(toothStatus)
        .where(and(eq(toothStatus.patientId, patientId), eq(toothStatus.position, position)))
        .for('update');
      return row && toStored(row);
    });
  }

  /**
   * The merge re-point (V10): the dropped patient's rows move to the kept patient, except at a
   * position the kept patient already has a row for, where the kept row wins and the dropped one
   * is deleted (a pure state row, not history). Returns how many rows moved and the deleted rows.
   */
  mergeInto(
    droppedId: string,
    keptId: string,
  ): Promise<{ moved: number; dropped: DroppedToothStatus[] }> {
    return this.db.run(async (tx) => {
      const keptPositions = tx
        .select({ position: toothStatus.position })
        .from(toothStatus)
        .where(eq(toothStatus.patientId, keptId));
      const dropped = await tx
        .delete(toothStatus)
        .where(
          and(eq(toothStatus.patientId, droppedId), inArray(toothStatus.position, keptPositions)),
        )
        .returning({
          position: toothStatus.position,
          present: toothStatus.present,
          changedInVisitId: toothStatus.changedInVisitId,
        });
      const moved = await tx
        .update(toothStatus)
        .set({ patientId: keptId })
        .where(eq(toothStatus.patientId, droppedId))
        .returning({ id: toothStatus.id });
      return { moved: moved.length, dropped };
    });
  }

  /** One row per patient and position (`tooth_status_position_unique`): insert or overwrite. */
  async upsert(change: ToothStatusChange): Promise<StoredToothStatus> {
    const [row] = await this.db.run((tx) =>
      tx
        .insert(toothStatus)
        .values(change)
        .onConflictDoUpdate({
          target: [toothStatus.tenantId, toothStatus.patientId, toothStatus.position],
          set: {
            present: change.present,
            changedInVisitId: change.changedInVisitId,
            changedBy: change.changedBy,
          },
        })
        .returning(),
    );
    if (!row) throw new Error('tooth status upsert returned no row');
    return toStored(row);
  }
}
