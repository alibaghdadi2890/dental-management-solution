import type { HoldReleaseKind } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { TenantDb } from '../../../platform/db/tenant-db';
import { paymentHolds, payments } from './schema';

/** A payment's hold for the plan, as the views read it. */
export interface StoredHold {
  paymentId: string;
  releasedAt: Date | null;
  releasedKind: HoldReleaseKind | null;
}

/**
 * `payment_holds` (ADR-0051, RLS-scoped through `TenantDb`): one row per payment held for the
 * plan. Written with the payment; the only change is the release, once.
 */
@Injectable()
export class HoldsRepository {
  constructor(private readonly db: TenantDb) {}

  async insert(paymentId: string): Promise<void> {
    await this.db.run((tx) => tx.insert(paymentHolds).values({ paymentId }));
  }

  /** The holds of `paymentIds`, ended ones included; payments never held are absent. */
  async forPayments(paymentIds: readonly string[]): Promise<Map<string, StoredHold>> {
    if (paymentIds.length === 0) return new Map();
    const rows = await this.db.run((tx) =>
      tx
        .select({
          paymentId: paymentHolds.paymentId,
          releasedAt: paymentHolds.releasedAt,
          releasedKind: paymentHolds.releasedKind,
        })
        .from(paymentHolds)
        .where(inArray(paymentHolds.paymentId, [...paymentIds])),
    );
    return new Map(rows.map((row) => [row.paymentId, row]));
  }

  /**
   * The payments of `patientId` whose hold has not ended and that still have money (not voided,
   * not fully refunded), with their ledger entries.
   */
  activeFor(patientId: string): Promise<{ paymentId: string; ledgerEntryId: string }[]> {
    return this.db.run((tx) =>
      tx
        .select({ paymentId: paymentHolds.paymentId, ledgerEntryId: payments.ledgerEntryId })
        .from(paymentHolds)
        .innerJoin(payments, eq(payments.id, paymentHolds.paymentId))
        .where(
          and(
            eq(payments.patientId, patientId),
            isNull(paymentHolds.releasedAt),
            sql`${payments.amount} > coalesce((
              select sum(r.amount) from payments r where r.reverses_payment_id = ${payments.id}
            ), 0)`,
          ),
        ),
    );
  }

  /**
   * Ends the holds of `paymentIds` that have not ended yet; returns the payments released. The
   * reason is the manual release's (null for `plan_closed`).
   */
  async release(
    paymentIds: readonly string[],
    release: { kind: HoldReleaseKind; by: string; reason: string | null },
  ): Promise<string[]> {
    if (paymentIds.length === 0) return [];
    const rows = await this.db.run((tx) =>
      tx
        .update(paymentHolds)
        .set({
          releasedAt: sql`now()`,
          releasedKind: release.kind,
          releasedBy: release.by,
          releaseReason: release.reason,
        })
        .where(
          and(inArray(paymentHolds.paymentId, [...paymentIds]), isNull(paymentHolds.releasedAt)),
        )
        .returning({ paymentId: paymentHolds.paymentId }),
    );
    return rows.map((row) => row.paymentId);
  }
}
