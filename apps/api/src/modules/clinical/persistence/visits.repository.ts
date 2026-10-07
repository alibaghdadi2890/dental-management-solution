import { COUNTED_VISIT_STATUSES, type ClinicalSummary } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { isUniqueViolation } from '../../../platform/db/unique-violation';
import type { DiscardFacts } from '../domain/discard-rule';
import type { VisitCursorPosition } from '../domain/visit-cursor';
import { isLive, LIVE_VISIT_STATUSES } from '../domain/visit-lifecycle';
import { RoomBusyError, VisitNotFoundError, VisitNotLiveError } from '../domain/visit-errors';
import {
  patientDiagnoses,
  toothPresences,
  treatmentPlans,
  treatmentPlanSessions,
  visits,
  visitServices,
} from './schema';
import { scopeCondition, type VisitCriteria, whereFor } from './visit-search.sql';

type VisitRow = typeof visits.$inferSelect;

/** A `visits` row as the application sees it (RLS supplies the tenant). */
export type StoredVisit = Omit<VisitRow, 'tenantId'>;

export type NewVisit = Pick<
  StoredVisit,
  | 'displayNumber'
  | 'patientId'
  | 'branchId'
  | 'roomId'
  | 'dentistId'
  | 'startedBy'
  | 'localDate'
  | 'startedAt'
  | 'currency'
>;

/** The fields the lifecycle, notes and discount change. */
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
    | 'voidedAt'
    | 'voidedBy'
    | 'voidReason'
    | 'completedAt'
    | 'completedBy'
    | 'unfinishedAnsweredAt'
    | 'checkedOutAt'
    | 'checkedOutBy'
    | 'durationMinutes'
    | 'subtotal'
    | 'discountAmount'
    | 'total'
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
const counted = inArray(visits.status, [...COUNTED_VISIT_STATUSES]);
const COUNTED_STATUS_LIST = sql.raw(
  `(${COUNTED_VISIT_STATUSES.map((status) => `'${status}'`).join(', ')})`,
);

/** The counts of the treatment summary that one query over visits and records answers. */
export type ClinicalCounts = Omit<ClinicalSummary, 'missingTeeth' | 'implants'>;

/**
 * The tenant's `visits` (RLS through `TenantDb`; `tenant_id` is never passed — CLAUDE.md §5). The
 * live-visit invariants live on this table (W1, ADR-0023): one live visit per room is the partial
 * unique index `visits_room_live_unique`, and one live visit per patient is `start`'s advisory
 * lock (`lockPatientStarts`) followed by `findLiveForPatient`.
 */
@Injectable()
export class VisitsRepository {
  constructor(private readonly db: TenantDb) {}

  /** Display numbers and local dates of `ids` (any status), in no particular order. */
  numbersFor(
    ids: readonly string[],
  ): Promise<{ visitId: string; displayNumber: number; localDate: string }[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select({
          visitId: visits.id,
          displayNumber: visits.displayNumber,
          localDate: visits.localDate,
        })
        .from(visits)
        .where(inArray(visits.id, [...ids])),
    );
  }

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
   * The visit `FOR UPDATE` in the caller's transaction, whatever its status, for amend and void
   * (4b): the status rule is `correct`'s. Unknown or discarded → 404 `visit.not_found`.
   */
  lockForCorrection(id: string): Promise<StoredVisit> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .select()
        .from(visits)
        .where(and(eq(visits.id, id), ne(visits.status, 'discarded')))
        .for('update');
      if (!row) throw new VisitNotFoundError('Visit not found');
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
   * The merge re-point's first step (V10, W24), in the merge transaction: every visit of
   * `droppedId` moves to `keptId`; returns how many moved. The rows are locked by the update, so
   * it waits for a charting change in flight (which holds its visit `FOR UPDATE`), and later
   * changes read the new patient. The kept patient's live visits are locked `FOR UPDATE` first
   * for the same reason: the records moved next (tooth status above all, one row per position)
   * then meet no uncommitted write on the kept patient. No deadlock (ADR-0023): charting locks
   * its visit before any record and never a patient, and `complete` and `start` lock the patient
   * first, so they wait for the merge (or it for them) before holding any visit.
   */
  async repointPatient(droppedId: string, keptId: string): Promise<number> {
    return this.db.run(async (tx) => {
      await tx
        .select({ id: visits.id })
        .from(visits)
        .where(and(eq(visits.patientId, keptId), live))
        .orderBy(asc(visits.id))
        .for('update');
      const rows = await tx
        .update(visits)
        .set({ patientId: keptId })
        .where(eq(visits.patientId, droppedId))
        .returning({ id: visits.id });
      return rows.length;
    });
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

  /** The patient's most recently completed visit (amended since or not, D18), or undefined. */
  async latestCompleted(patientId: string): Promise<StoredVisit | undefined> {
    const [row] = await this.db.run((tx) =>
      tx
        .select()
        .from(visits)
        .where(and(eq(visits.patientId, patientId), counted))
        .orderBy(desc(visits.completedAt), desc(visits.id))
        .limit(1),
    );
    return row && toStored(row);
  }

  /**
   * The Record overview's treatment counts (W8) in one query of scalar subqueries: counted
   * visits (completed or amended, never voided — D18); active diagnoses and `planned` plans that aren't removed; and, over the services of
   * counted visits that aren't removed, the distinct teeth and the number of services. The
   * missing teeth and implants come from the presence rows (`ChartService.summary`).
   */
  async clinicalSummary(patientId: string): Promise<ClinicalCounts> {
    const completedServices = sql`from ${visitServices} join ${visits} on ${visits.id} = ${visitServices.visitId} where ${visits.patientId} = ${patientId} and ${visits.status} in ${COUNTED_STATUS_LIST} and ${isNull(visitServices.deletedAt)}`;
    const counts = {
      visits: sql`select count(*) from ${visits} where ${visits.patientId} = ${patientId} and ${visits.status} in ${COUNTED_STATUS_LIST}`,
      activeDiagnoses: sql`select count(*) from ${patientDiagnoses} where ${patientDiagnoses.patientId} = ${patientId} and ${patientDiagnoses.status} = 'active' and ${isNull(patientDiagnoses.deletedAt)}`,
      plannedProcedures: sql`select count(*) from ${treatmentPlans} where ${treatmentPlans.patientId} = ${patientId} and ${treatmentPlans.status}::text in ('planned', 'in_progress') and ${isNull(treatmentPlans.deletedAt)}`,
      // count(distinct …) skips null tooth codes: jaw-level services treat no tooth.
      teethTreated: sql`select count(distinct ${visitServices.toothCode}) ${completedServices}`,
      servicesPerformed: sql`select count(*) ${completedServices}`,
    } satisfies Record<keyof ClinicalCounts, SQL>;
    const columns = sql.join(
      Object.entries(counts).map(
        ([name, subquery]) => sql`(${subquery})::int as ${sql.identifier(name)}`,
      ),
      sql`, `,
    );
    const {
      rows: [row],
    } = await this.db.run((tx) => tx.execute<ClinicalCounts>(sql`select ${columns}`));
    if (!row) throw new Error('clinical summary returned no row');
    return row;
  }

  /**
   * One page of the visits list (4b): matching `criteria`, newest first by `(started_at, id)`,
   * after `after` when given; `limit` rows at most.
   */
  async page(
    criteria: VisitCriteria,
    after: VisitCursorPosition | undefined,
    limit: number,
  ): Promise<StoredVisit[]> {
    if (criteria.idsIn?.length === 0) return [];
    const conditions = [whereFor(criteria)];
    if (after) {
      conditions.push(
        sql`(${visits.startedAt}, ${visits.id}) < (${after.startedAt.toISOString()}::timestamptz, ${after.id}::uuid)`,
      );
    }
    const rows = await this.db.run((tx) =>
      tx
        .select()
        .from(visits)
        .where(and(...conditions))
        .orderBy(desc(visits.startedAt), desc(visits.id))
        .limit(limit),
    );
    return rows.map(toStored);
  }

  /** How many visits match, and Σ total of the counted ones among them per currency (D12). */
  async aggregate(
    criteria: VisitCriteria,
  ): Promise<{ count: number; billed: { currency: string; amount: string }[] }> {
    if (criteria.idsIn?.length === 0) return { count: 0, billed: [] };
    return this.db.run(async (tx) => {
      const where = whereFor(criteria);
      const [row] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(visits)
        .where(where);
      const billed = await tx
        .select({
          currency: visits.currency,
          amount: sql<string>`sum(${visits.total})::numeric(14, 2)::text`,
        })
        .from(visits)
        .where(and(where, counted))
        .groupBy(visits.currency)
        .orderBy(visits.currency);
      return { count: row?.count ?? 0, billed };
    });
  }

  /** The list's tab chips (D12): every filter ignored but the scope; `today` = today's visits. */
  async tabCounts(
    scope: VisitCriteria['scope'],
    today: string,
  ): Promise<{ all: number; inProgress: number; voidedAmended: number; today: number }> {
    const [row] = await this.db.run((tx) =>
      tx
        .select({
          all: sql<number>`count(*)::int`,
          inProgress: sql<number>`(count(*) filter (where ${live}))::int`,
          voidedAmended: sql<number>`(count(*) filter (where ${inArray(visits.status, ['amended', 'voided'])}))::int`,
          today: sql<number>`(count(*) filter (where ${eq(visits.localDate, today)}))::int`,
        })
        .from(visits)
        .where(and(scopeCondition(scope), ne(visits.status, 'discarded'))),
    );
    return row ?? { all: 0, inProgress: 0, voidedAmended: 0, today: 0 };
  }

  /** Per patient among `patientIds`: the last counted visit's local date and how many (D18). */
  async statsFor(
    patientIds: readonly string[],
  ): Promise<{ patientId: string; lastVisitDate: string; visitCount: number }[]> {
    if (patientIds.length === 0) return [];
    return this.db.run((tx) =>
      tx
        .select({
          patientId: visits.patientId,
          lastVisitDate: sql<string>`max(${visits.localDate})::text`,
          visitCount: sql<number>`count(*)::int`,
        })
        .from(visits)
        .where(and(inArray(visits.patientId, [...patientIds]), counted))
        .groupBy(visits.patientId),
    );
  }

  /** Patients with a counted visit on or after `fromDate` (any date when null), any branch. */
  async patientIdsSeenSince(fromDate: string | null): Promise<string[]> {
    const rows = await this.db.run((tx) =>
      tx
        .selectDistinct({ patientId: visits.patientId })
        .from(visits)
        .where(and(counted, fromDate === null ? undefined : gte(visits.localDate, fromDate))),
    );
    return rows.map((row) => row.patientId);
  }

  /** The patient's voided visits (D6): their records stay, marked as from a voided visit. */
  async voidedIdsForPatient(patientId: string): Promise<string[]> {
    const rows = await this.db.run((tx) =>
      tx
        .select({ id: visits.id })
        .from(visits)
        .where(and(eq(visits.patientId, patientId), eq(visits.status, 'voided')))
        .orderBy(asc(visits.id)),
    );
    return rows.map((row) => row.id);
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
          planSessions: fact(
            sql`select 1 from ${treatmentPlanSessions} where ${treatmentPlanSessions.visitId} = ${visits.id} and ${isNull(treatmentPlanSessions.deletedAt)}`,
          ),
          toothChanges: fact(
            sql`select 1 from ${toothPresences} where ${toothPresences.patientId} = ${visits.patientId} and ${toothPresences.recordedInVisitId} = ${visits.id} and ${isNull(toothPresences.deletedAt)}`,
          ),
        })
        .from(visits)
        .where(eq(visits.id, id)),
    );
    if (!row) throw new VisitNotFoundError('Visit not found');
    return row;
  }
}
