import { Injectable } from '@nestjs/common';
import { count, eq, inArray, max } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import type { AmendmentSnapshot } from '../domain/visit-amendment';
import { visitAmendments } from './schema';

export interface NewVisitAmendment {
  visitId: string;
  reason: string;
  before: AmendmentSnapshot;
  after: AmendmentSnapshot;
  delta: string;
  currency: string;
  amendedBy: string;
}

/**
 * `visit_amendments` (4b, ADR-0025): append-only — the runtime role has no UPDATE or DELETE
 * (migration 0020), so this repository only inserts and reads.
 */
@Injectable()
export class VisitAmendmentsRepository {
  constructor(private readonly db: TenantDb) {}

  /**
   * Appends the visit's next amendment (sequence = previous + 1). The caller holds the visit
   * `FOR UPDATE`, so two amendments of one visit can't race for a sequence; the unique index is
   * the backstop. Returns the new row's id.
   */
  async append(amendment: NewVisitAmendment): Promise<string> {
    return this.db.run(async (tx) => {
      const [last] = await tx
        .select({ sequence: max(visitAmendments.sequence) })
        .from(visitAmendments)
        .where(eq(visitAmendments.visitId, amendment.visitId));
      const [row] = await tx
        .insert(visitAmendments)
        .values({ ...amendment, sequence: (last?.sequence ?? 0) + 1 })
        .returning({ id: visitAmendments.id });
      if (!row) throw new Error('visit amendment insert returned no row');
      return row.id;
    });
  }

  /** How many times each visit was amended; visits never amended are absent. */
  async countsFor(visitIds: readonly string[]): Promise<Map<string, number>> {
    if (visitIds.length === 0) return new Map();
    const rows = await this.db.run((tx) =>
      tx
        .select({ visitId: visitAmendments.visitId, amendments: count() })
        .from(visitAmendments)
        .where(inArray(visitAmendments.visitId, [...visitIds]))
        .groupBy(visitAmendments.visitId),
    );
    return new Map(rows.map((row) => [row.visitId, row.amendments]));
  }
}
