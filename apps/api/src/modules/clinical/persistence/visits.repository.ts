import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { isUniqueViolation } from '../../../platform/db/unique-violation';
import type { DiscardFacts } from '../domain/discard-rule';
import { isLive, LIVE_VISIT_STATUSES } from '../domain/visit-lifecycle';
import { RoomBusyError, VisitNotFoundError, VisitNotLiveError } from '../domain/visit-errors';
import { patientDiagnoses, toothStatus, treatmentPlans, visits, visitServices } from './schema';

type VisitRow = typeof visits.$inferSelect;

/** A `visits` row as the application sees it (RLS supplies the tenant). */
export type StoredVisit = Omit<VisitRow, 'tenantId'>;

export type NewVisit = Pick<
  StoredVisit,
  | 'patientId'
  | 'branchId'
  | 'roomId'
  | 'dentistId'
  | 'startedBy'
  | 'localDate'
  | 'startedAt'
  | 'currency'
>;

/** The fields the lifecycle, notes and discount change (`complete`'s arrive in E2). */
export type VisitPatch = Partial<
  Pick<
    StoredVisit,
    | 'status'
    | 'pausedAt'
    | 'pausedSeconds'
    | 'notes'
    | 'discountMode'
    | 'discountValue'
    | 'discardedAt'
    | 'discardedBy'
  >
>;

/** `mine` (W18): the caller is the visit's dentist (by staff profile, when they have one) or
 * started it (auth user id). */
export interface LiveVisitFilter {
  patientId?: string | undefined;
  mine?: { userId: string; profileId: string | null } | undefined;
}

function toStored({ tenantId: _tenantId, ...visit }: VisitRow): StoredVisit {
  return visit;
}

const live = inArray(visits.status, [...LIVE_VISIT_STATUSES]);

/**
 * The tenant's `visits` (RLS through `TenantDb`; `tenant_id` is never passed — CLAUDE.md §5). The
 * live-visit invariants live on this table (W1, ADR-0023): one live visit per room is the partial
 * unique index `visits_room_live_unique`, and one live visit per patient is `start`'s advisory
 * lock (`lockPatientStarts`) followed by `findLiveForPatient`.
 */
@Injectable()
export class VisitsRepository {
  constructor(private readonly db: TenantDb) {}

  /** A visit that isn't discarded: a discarded visit reads as not found everywhere (W4). */
  findById(id: string): Promise<StoredVisit | undefined> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .select()
        .from(visits)
        .where(and(eq(visits.id, id), ne(visits.status, 'discarded')));
      return row && toStored(row);
    });
  }

  /**
   * The visit `FOR UPDATE` in the caller's transaction, for a mutation: unknown → 404
   * `visit.not_found`; completed or discarded → 409 `visit.not_live`.
   */
  lockLive(id: string): Promise<StoredVisit> {
    return this.db.run(async (tx) => {
      const [row] = await tx.select().from(visits).where(eq(visits.id, id)).for('update');
      if (!row) throw new VisitNotFoundError('Visit not found');
      if (!isLive(row.status)) {
        throw new VisitNotLiveError(`Visit is ${row.status}; it can no longer change`);
      }
      return toStored(row);
    });
  }

  /**
   * Serialises visit starts for one patient until the caller's transaction ends (W1): a
   * transaction-level advisory lock on a key derived from the patient id, so a second start waits
   * and then finds the first one's live visit. Patient ids are uuids, unique across tenants, so
   * the key needs no tenant part; the `visit-start:` prefix keeps it apart from any other use of
   * advisory locks.
   */
  async lockPatientStarts(patientId: string): Promise<void> {
    await this.db.run((tx) =>
      tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`visit-start:${patientId}`}, 0))`,
      ),
    );
  }

  /**
   * The patient's oldest live visit, `FOR SHARE` in the caller's transaction so it can't be
   * discarded or completed before `start` answers with it. After a merge the kept patient may
   * have two (W1).
   */
  findLiveForPatient(patientId: string): Promise<StoredVisit | undefined> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .select()
        .from(visits)
        .where(and(eq(visits.patientId, patientId), live))
        .orderBy(asc(visits.startedAt), asc(visits.id))
        .limit(1)
        .for('share');
      return row && toStored(row);
    });
  }

  /** A room another live visit holds → 409 `visit.room_busy` (`visits_room_live_unique`). */
  async insert(visit: NewVisit): Promise<StoredVisit> {
    try {
      const [row] = await this.db.run((tx) => tx.insert(visits).values(visit).returning());
      if (!row) throw new Error('visit insert returned no row');
      return toStored(row);
    } catch (error) {
      if (isUniqueViolation(error, 'visits_room_live_unique')) {
        throw new RoomBusyError('Another live visit is using this room');
      }
      throw error;
    }
  }

  async update(id: string, patch: VisitPatch): Promise<StoredVisit> {
    const [row] = await this.db.run((tx) =>
      tx.update(visits).set(patch).where(eq(visits.id, id)).returning(),
    );
    if (!row) throw new VisitNotFoundError('Visit not found');
    return toStored(row);
  }

  /**
   * The room of the most recent visit `userId` started on `localDate` (discarded ones included: a
   * visit discarded because it was opened on the wrong patient was still in the right room), or
   * null. The start popover's default room (V3).
   */
  async lastRoomToday(userId: string, localDate: string): Promise<string | null> {
    const [row] = await this.db.run((tx) =>
      tx
        .select({ roomId: visits.roomId })
        .from(visits)
        .where(
          and(
            eq(visits.startedBy, userId),
            eq(visits.localDate, localDate),
            isNotNull(visits.roomId),
          ),
        )
        .orderBy(desc(visits.startedAt), desc(visits.id))
        .limit(1),
    );
    return row?.roomId ?? null;
  }

  /** A live visit holds the room (the `visits_room_live_unique` index answers it). */
  async isRoomTaken(roomId: string): Promise<boolean> {
    const [row] = await this.db.run((tx) =>
      tx
        .select({ id: visits.id })
        .from(visits)
        .where(and(eq(visits.roomId, roomId), live))
        .limit(1),
    );
    return row !== undefined;
  }

  /** Live visits matching `filter`, oldest first. */
  liveRefs(filter: LiveVisitFilter): Promise<StoredVisit[]> {
    const conditions: (SQL | undefined)[] = [live];
    if (filter.patientId !== undefined) conditions.push(eq(visits.patientId, filter.patientId));
    if (filter.mine) {
      const { userId, profileId } = filter.mine;
      const startedByCaller = eq(visits.startedBy, userId);
      conditions.push(
        profileId === null ? startedByCaller : or(eq(visits.dentistId, profileId), startedByCaller),
      );
    }
    return this.db.run(async (tx) =>
      (
        await tx
          .select()
          .from(visits)
          .where(and(...conditions))
          .orderBy(asc(visits.startedAt), asc(visits.id))
      ).map(toStored),
    );
  }

  /**
   * What the visit has put on the record (`isDiscardable`), in one query of `exists` subqueries.
   * The record tables are filtered on the visit's patient too, so each subquery uses its
   * `(tenant_id, patient_id, …)` index — the `*_in_visit_id` columns are not indexed. A merge
   * re-points a visit and its records together, so the patient always matches. Each fact is 0
   * or 1: the rule only asks whether there is any.
   */
  async discardFacts(id: string): Promise<DiscardFacts> {
    const fact = (subquery: SQL) => sql<number>`(exists (${subquery}))::int`;
    const [row] = await this.db.run((tx) =>
      tx
        .select({
          notes: visits.notes,
          services: fact(
            sql`select 1 from ${visitServices} where ${visitServices.visitId} = ${visits.id} and ${isNull(visitServices.deletedAt)}`,
          ),
          diagnosesRecorded: fact(
            sql`select 1 from ${patientDiagnoses} where ${patientDiagnoses.patientId} = ${visits.patientId} and ${patientDiagnoses.recordedInVisitId} = ${visits.id} and ${isNull(patientDiagnoses.deletedAt)}`,
          ),
          diagnosesResolved: fact(
            sql`select 1 from ${patientDiagnoses} where ${patientDiagnoses.patientId} = ${visits.patientId} and ${patientDiagnoses.resolvedInVisitId} = ${visits.id} and ${isNull(patientDiagnoses.deletedAt)}`,
          ),
          plansRecorded: fact(
            sql`select 1 from ${treatmentPlans} where ${treatmentPlans.patientId} = ${visits.patientId} and ${treatmentPlans.recordedInVisitId} = ${visits.id} and ${isNull(treatmentPlans.deletedAt)}`,
          ),
          plansPerformed: fact(
            sql`select 1 from ${treatmentPlans} where ${treatmentPlans.patientId} = ${visits.patientId} and ${treatmentPlans.performedInVisitId} = ${visits.id} and ${isNull(treatmentPlans.deletedAt)}`,
          ),
          plansCancelled: fact(
            sql`select 1 from ${treatmentPlans} where ${treatmentPlans.patientId} = ${visits.patientId} and ${treatmentPlans.cancelledInVisitId} = ${visits.id} and ${isNull(treatmentPlans.deletedAt)}`,
          ),
          toothChanges: fact(
            sql`select 1 from ${toothStatus} where ${toothStatus.patientId} = ${visits.patientId} and ${toothStatus.changedInVisitId} = ${visits.id}`,
          ),
        })
        .from(visits)
        .where(eq(visits.id, id)),
    );
    if (!row) throw new VisitNotFoundError('Visit not found');
    return row;
  }
}
