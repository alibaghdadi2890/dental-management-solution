import type { ToothCode, ToothPresenceState } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { toothPresences, visits, visitServices } from './schema';

type ToothPresenceRow = typeof toothPresences.$inferSelect;

/** A `tooth_presences` row as the application sees it (RLS supplies the tenant). */
export type StoredToothPresence = Omit<ToothPresenceRow, 'tenantId'>;

export type NewToothPresence = Pick<
  StoredToothPresence,
  | 'patientId'
  | 'toothCode'
  | 'presence'
  | 'occurredOn'
  | 'reason'
  | 'dentistId'
  | 'recordedInVisitId'
  | 'serviceId'
  | 'recordedBy'
>;

/** A row with what the chart shows beside it: its visit's number and its service's snapshot. */
export interface ToothPresenceLine {
  row: StoredToothPresence;
  visitNumber: number | null;
  serviceCode: string | null;
  serviceName: string | null;
}

function toStored({ tenantId: _tenantId, ...row }: ToothPresenceRow): StoredToothPresence {
  return row;
}

const live = isNull(toothPresences.deletedAt);

/**
 * What is at each tooth position of the tenant's patients (feature 7, H1; ADR-0034; RLS). A row
 * is written each time a person or a service sets a tooth's presence, and never overwritten:
 * the tooth's presence is its latest live row (by `seq`), and soft-deleting that row — an Undo,
 * the removal of the service that caused it — brings the one before it back.
 */
@Injectable()
export class ToothPresenceRepository {
  constructor(private readonly db: TenantDb) {}

  async insert(presence: NewToothPresence): Promise<StoredToothPresence> {
    const [row] = await this.db.run((tx) => tx.insert(toothPresences).values(presence).returning());
    if (!row) throw new Error('tooth presence insert returned no row');
    return toStored(row);
  }

  /** The tooth's presence now: its latest live row's, or `present` without one. */
  async currentFor(patientId: string, toothCode: string): Promise<ToothPresenceState> {
    const [row] = await this.db.run((tx) =>
      tx
        .select({ presence: toothPresences.presence })
        .from(toothPresences)
        .where(
          and(
            eq(toothPresences.patientId, patientId),
            eq(toothPresences.toothCode, toothCode),
            live,
          ),
        )
        .orderBy(desc(toothPresences.seq))
        .limit(1),
    );
    return row?.presence ?? 'present';
  }

  /** The patient's live rows (one tooth's when `toothCode` is given), in the order recorded. */
  listForPatient(patientId: string, toothCode?: ToothCode): Promise<ToothPresenceLine[]> {
    return this.db.run(async (tx) => {
      const rows = await tx
        .select({
          row: toothPresences,
          visitNumber: visits.displayNumber,
          serviceCode: visitServices.code,
          serviceName: visitServices.name,
        })
        .from(toothPresences)
        .leftJoin(visits, eq(visits.id, toothPresences.recordedInVisitId))
        .leftJoin(visitServices, eq(visitServices.id, toothPresences.serviceId))
        .where(
          and(
            eq(toothPresences.patientId, patientId),
            toothCode === undefined ? undefined : eq(toothPresences.toothCode, toothCode),
            live,
          ),
        )
        .orderBy(asc(toothPresences.seq));
      return rows.map(({ row, ...rest }) => ({ row: toStored(row), ...rest }));
    });
  }

  /** The patient's live rows among `ids`, for a removal that must own every one of them. */
  findLive(patientId: string, ids: readonly string[]): Promise<StoredToothPresence[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.run(async (tx) =>
      (
        await tx
          .select()
          .from(toothPresences)
          .where(
            and(
              eq(toothPresences.patientId, patientId),
              inArray(toothPresences.id, [...ids]),
              live,
            ),
          )
          .orderBy(asc(toothPresences.seq))
      ).map(toStored),
    );
  }

  /** The live row a visit service caused, if it changed the tooth (H2). */
  async liveForService(serviceId: string): Promise<StoredToothPresence | undefined> {
    const [row] = await this.db.run((tx) =>
      tx
        .select()
        .from(toothPresences)
        .where(and(eq(toothPresences.serviceId, serviceId), live)),
    );
    return row && toStored(row);
  }

  /** The live rows the services of a visit caused: what a void restores. */
  liveByServicesOf(visitId: string): Promise<StoredToothPresence[]> {
    return this.db.run(async (tx) =>
      (
        await tx
          .select()
          .from(toothPresences)
          .where(
            and(
              eq(toothPresences.recordedInVisitId, visitId),
              isNotNull(toothPresences.serviceId),
              live,
            ),
          )
          .orderBy(asc(toothPresences.seq))
      ).map(toStored),
    );
  }

  /** Soft-deletes rows; the presence before each of them is the tooth's presence again. */
  async remove(ids: readonly string[], at: Date): Promise<void> {
    if (ids.length === 0) return;
    await this.db.run((tx) =>
      tx
        .update(toothPresences)
        .set({ deletedAt: at })
        .where(inArray(toothPresences.id, [...ids])),
    );
  }

  /** The merge re-point: every row of the dropped patient, removed ones too, follows the kept. */
  async repointPatient(fromPatientId: string, toPatientId: string): Promise<number> {
    const rows = await this.db.run((tx) =>
      tx
        .update(toothPresences)
        .set({ patientId: toPatientId })
        .where(eq(toothPresences.patientId, fromPatientId))
        .returning({ id: toothPresences.id }),
    );
    return rows.length;
  }
}
