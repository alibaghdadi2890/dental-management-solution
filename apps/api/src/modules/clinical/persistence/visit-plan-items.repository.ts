import { Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { visitPlanItems } from './schema';

/** One planned item on a visit's list for today. */
export interface WorklistRow {
  planId: string;
}

/**
 * A visit's worklist (`visit_plan_items`, ADR-0048; RLS through `TenantDb`): the planned items
 * the visit means to work on, in the order they were put on the list — at start, then as they
 * are ticked on Today's work. Callers hold the visit row `FOR UPDATE`, so two changes of one
 * visit's list never interleave.
 */
@Injectable()
export class VisitPlanItemsRepository {
  constructor(private readonly db: TenantDb) {}

  /** Puts `planIds` on a new visit's worklist, in that order. */
  async insert(visitId: string, planIds: readonly string[], addedBy: string): Promise<void> {
    if (planIds.length === 0) return;
    await this.db.run((tx) =>
      tx
        .insert(visitPlanItems)
        .values(planIds.map((planId, position) => ({ visitId, planId, position, addedBy }))),
    );
  }

  /** Puts one more plan at the end of the visit's list. */
  async add(visitId: string, planId: string, addedBy: string): Promise<void> {
    await this.db.run((tx) =>
      tx.insert(visitPlanItems).values({
        visitId,
        planId,
        addedBy,
        position: sql<number>`(select coalesce(max(${visitPlanItems.position}), -1) + 1 from ${visitPlanItems} where ${visitPlanItems.visitId} = ${visitId})`,
      }),
    );
  }

  /** Takes a plan off the visit's list; nothing when it is not on it. */
  async remove(visitId: string, planId: string): Promise<void> {
    await this.db.run((tx) =>
      tx
        .delete(visitPlanItems)
        .where(and(eq(visitPlanItems.visitId, visitId), eq(visitPlanItems.planId, planId))),
    );
  }

  listForVisit(visitId: string): Promise<WorklistRow[]> {
    return this.db.run((tx) =>
      tx
        .select({ planId: visitPlanItems.planId })
        .from(visitPlanItems)
        .where(eq(visitPlanItems.visitId, visitId))
        .orderBy(asc(visitPlanItems.position), asc(visitPlanItems.planId)),
    );
  }
}
