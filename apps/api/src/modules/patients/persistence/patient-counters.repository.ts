import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { patientCounters } from './schema';

/**
 * The tenant's `patient_counters` row (`tenant_id` is both the primary key and the RLS-scoped
 * tenant column, so it's never passed explicitly — CLAUDE.md §5). One row per tenant, created on
 * first use.
 */
@Injectable()
export class PatientCountersRepository {
  constructor(private readonly db: TenantDb) {}

  /**
   * Atomically increments and returns the tenant's counter, starting at 1. The upsert's row lock
   * serialises concurrent creates the way `SELECT ... FOR UPDATE` would, and a rolled-back create
   * still burns the number (acceptable: numbers are unique, not gap-free).
   */
  async nextValue(): Promise<number> {
    const [row] = await this.db.run((tx) =>
      tx
        .insert(patientCounters)
        .values({ lastValue: 1 })
        .onConflictDoUpdate({
          target: patientCounters.tenantId,
          set: { lastValue: sql`${patientCounters.lastValue} + 1`, updatedAt: sql`now()` },
        })
        .returning({ lastValue: patientCounters.lastValue }),
    );
    if (!row) throw new Error('patient counter upsert returned no row');
    return row.lastValue;
  }
}
