import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { visitPlanShares } from './schema';

/**
 * `visit_plan_shares` (ADR-0051 A4, RLS-scoped through `TenantDb`): a charged visit's plan share,
 * a cache rewritten whenever the visit's charge changes.
 */
@Injectable()
export class PlanSharesRepository {
  constructor(private readonly db: TenantDb) {}

  async upsert(visitId: string, amount: string, currency: string): Promise<void> {
    await this.db.run((tx) =>
      tx
        .insert(visitPlanShares)
        .values({ visitId, amount, currency })
        .onConflictDoUpdate({
          target: [visitPlanShares.tenantId, visitPlanShares.visitId],
          set: { amount, currency, updatedAt: sql`now()` },
        }),
    );
  }
}
