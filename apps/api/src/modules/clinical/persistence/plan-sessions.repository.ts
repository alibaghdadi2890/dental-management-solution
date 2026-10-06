import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { treatmentPlanSessions, visits } from './schema';

type SessionRow = typeof treatmentPlanSessions.$inferSelect;

/** A `treatment_plan_sessions` row as the application sees it (RLS supplies the tenant). */
export type StoredPlanSession = Omit<SessionRow, 'tenantId'>;

/** A session with its visit's tenant-local date, for display. */
export interface DatedPlanSession {
  planId: string;
  visitId: string;
  date: string;
  note: string | null;
}

function toStored({ tenantId: _tenantId, ...session }: SessionRow): StoredPlanSession {
  return session;
}

/**
 * The visits that worked on plans in progress (ADR-0032; RLS through `TenantDb`): at most one live
 * row per plan and visit (`treatment_plan_sessions_unique`). Callers hold the plan row
 * `FOR UPDATE`, so two writes of one plan's sessions never interleave.
 */
@Injectable()
export class PlanSessionsRepository {
  constructor(private readonly db: TenantDb) {}

  /** This visit's session on the plan, if it has one that isn't removed. */
  find(planId: string, visitId: string): Promise<StoredPlanSession | null> {
    return this.db.run(async (tx) => {
      const [row] = await tx
        .select()
        .from(treatmentPlanSessions)
        .where(
          and(
            eq(treatmentPlanSessions.planId, planId),
            eq(treatmentPlanSessions.visitId, visitId),
            isNull(treatmentPlanSessions.deletedAt),
          ),
        );
      return row ? toStored(row) : null;
    });
  }

  async insert(session: {
    planId: string;
    visitId: string;
    note: string | null;
    recordedBy: string;
  }): Promise<StoredPlanSession> {
    const [row] = await this.db.run((tx) =>
      tx.insert(treatmentPlanSessions).values(session).returning(),
    );
    if (!row) throw new Error('plan session insert returned no row');
    return toStored(row);
  }

  /** A new note, or the soft delete. */
  async update(
    id: string,
    patch: Partial<Pick<StoredPlanSession, 'note' | 'deletedAt'>>,
  ): Promise<StoredPlanSession> {
    const [row] = await this.db.run((tx) =>
      tx
        .update(treatmentPlanSessions)
        .set(patch)
        .where(eq(treatmentPlanSessions.id, id))
        .returning(),
    );
    if (!row) throw new Error(`plan session ${id} not found`);
    return toStored(row);
  }

  /** How many sessions of the plan aren't removed. */
  async countForPlan(planId: string): Promise<number> {
    const [row] = await this.db.run((tx) =>
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(treatmentPlanSessions)
        .where(
          and(eq(treatmentPlanSessions.planId, planId), isNull(treatmentPlanSessions.deletedAt)),
        ),
    );
    return row?.count ?? 0;
  }

  /** The plan's oldest session that isn't removed: the visit that now counts as its start. */
  async oldestForPlan(planId: string): Promise<StoredPlanSession | null> {
    const [row] = await this.db.run((tx) =>
      tx
        .select()
        .from(treatmentPlanSessions)
        .where(
          and(eq(treatmentPlanSessions.planId, planId), isNull(treatmentPlanSessions.deletedAt)),
        )
        .orderBy(asc(treatmentPlanSessions.createdAt), asc(treatmentPlanSessions.id))
        .limit(1),
    );
    return row ? toStored(row) : null;
  }

  /** The sessions of these plans that aren't removed, each plan's oldest first, with the visit's
   * local date. */
  listForPlans(planIds: readonly string[]): Promise<DatedPlanSession[]> {
    if (planIds.length === 0) return Promise.resolve([]);
    return this.db.run((tx) =>
      tx
        .select({
          planId: treatmentPlanSessions.planId,
          visitId: treatmentPlanSessions.visitId,
          date: visits.localDate,
          note: treatmentPlanSessions.note,
        })
        .from(treatmentPlanSessions)
        .innerJoin(visits, eq(visits.id, treatmentPlanSessions.visitId))
        .where(
          and(
            inArray(treatmentPlanSessions.planId, [...planIds]),
            isNull(treatmentPlanSessions.deletedAt),
          ),
        )
        .orderBy(asc(visits.startedAt), asc(treatmentPlanSessions.id)),
    );
  }
}
