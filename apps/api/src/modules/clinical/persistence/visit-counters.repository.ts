import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { visitCounters } from './schema';

/**
 * The tenant's `visit_counters` row (4b, D9), created on first use; `tenant_id` is the primary
 * key and comes from the transaction (CLAUDE.md §5). Same mint as `patients`'
 * `PatientCountersRepository`.
 */
@Injectable()
export class VisitCountersRepository {
  constructor(private readonly db: TenantDb) {}

  /**
   * Atomically increments and returns the counter, starting at 1. The upsert's row lock
   * serialises concurrent starts; called inside `start`'s transaction, a rolled-back start frees
   * its number.
   */
  async nextValue(): Promise<number> {
    const [row] = await this.db.run((tx) =>
      tx
        .insert(visitCounters)
        .values({ lastValue: 1 })
        .onConflictDoUpdate({
          target: visitCounters.tenantId,
          set: { lastValue: sql`${visitCounters.lastValue} + 1`, updatedAt: sql`now()` },
        })
        .returning({ lastValue: visitCounters.lastValue }),
    );
    if (!row) throw new Error('visit counter upsert returned no row');
    return row.lastValue;
  }
}
