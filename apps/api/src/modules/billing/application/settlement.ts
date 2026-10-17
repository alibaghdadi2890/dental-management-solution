import { fromCents, type HoldReleaseKind } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { TenantDb } from '../../../platform/db/tenant-db';
import { EventBus } from '../../../platform/events/event-bus';
import { AuditService } from '../../audit';
import { VisitFactsService } from '../../clinical';
import { TenancyService } from '../../tenancy';
import { type NewAllocation, settle, unallocatedBySource } from '../domain/allocate';
import type { AccountSource, AccountTarget } from '../domain/payment';
import {
  ADVANCE_RELEASED,
  type AdvanceReleased,
  CREDIT_APPLIED,
  type CreditApplied,
} from '../events/payment-events';
import { AllocationsRepository } from '../persistence/allocations.repository';
import { HoldsRepository } from '../persistence/holds.repository';
import { LedgerEntriesRepository } from '../persistence/ledger-entries.repository';

/** One account's state in one currency, as settle and the payment panel read it. */
export interface AccountState {
  targets: AccountTarget[];
  sources: AccountSource[];
  pairs: Awaited<ReturnType<AllocationsRepository['pairsOf']>>;
}

export const toFact = (row: Pick<NewAllocation, 'sourceId' | 'targetId' | 'amount'>) => ({
  sourceEntryId: row.sourceId,
  targetEntryId: row.targetId,
  amount: fromCents(row.amount),
});

/**
 * Keeps an account's allocations true after every ledger write (P4, ADR-0027/0029): internal to
 * `billing`, joined by every writer — opening balances, adjustments, visit charges and their
 * corrections, payments, refunds, voids, the merge re-point. It runs in the caller's
 * transaction, under the account lock (`LedgerEntriesRepository.lockAccount`, taken here too:
 * advisory locks are re-entrant). Not permission-gated: the write that triggers it was; the plan
 * read needs `visit:read`, which every system role holds.
 *
 * Money held for the plan (ADR-0051) covers only plan charges; when the patient has no plan work
 * left to charge, settle ends every hold (`plan_closed`) and settles again, so what is left
 * covers other charges or stays as free credit.
 */
@Injectable()
export class Settlement {
  constructor(
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly tenancy: TenancyService,
    private readonly visits: VisitFactsService,
    private readonly entries: LedgerEntriesRepository,
    private readonly allocations: AllocationsRepository,
    private readonly holds: HoldsRepository,
  ) {}

  /** Locks the accounts of `patientIds`, in id order (no deadlock between two multi-locks). */
  async lock(patientIds: readonly string[]): Promise<void> {
    for (const patientId of [...new Set(patientIds)].sort()) {
      await this.entries.lockAccount(patientId);
    }
  }

  /** Each account's targets, sources and pairs in `currency`. */
  async state(patientIds: readonly string[], currency: string): Promise<AccountState> {
    // One after the other: the queries share the caller's transaction (one connection).
    const targets = await this.allocations.targetsOf(patientIds);
    const sources = await this.allocations.sourcesOf(patientIds);
    const pairs = await this.allocations.pairsOf(patientIds);
    const inCurrency = <T extends { currency: string }>(rows: T[]) =>
      rows.filter((row) => row.currency === currency);
    return { targets: inCurrency(targets), sources: inCurrency(sources), pairs };
  }

  /**
   * Settles `patientId` in every currency it has entries in. `newSourceIds` are sources written in
   * this operation (a write-off): their cover is an `allocation`, not applied credit. Publishes
   * `CreditApplied` when existing credit covered a charge. Returns the rows written. With
   * `closeHolds: false` a plan without work leaves the holds as they are: the merge re-point, which
   * may run before `clinical` has moved the dropped patient's plans.
   */
  settle(
    patientId: string,
    newSourceIds: ReadonlySet<string> = new Set(),
    { closeHolds = true }: { closeHolds?: boolean } = {},
  ): Promise<NewAllocation[]> {
    return this.tenantDb.run(async () => {
      await this.entries.lockAccount(patientId);
      const written = await this.pass(patientId, newSourceIds);
      if (closeHolds && (await this.closeHoldsIfPlanDone(patientId))) {
        written.push(...(await this.pass(patientId, new Set())));
      }
      return written;
    });
  }

  /**
   * Ends the holds of `held` (payments of `patientId`, under its account lock) that have not
   * ended: audited `payment.release` and `AdvanceReleased`, each with what it still held. The
   * caller settles afterwards. Returns the payments released.
   */
  async releaseHolds(
    patientId: string,
    held: readonly { paymentId: string; ledgerEntryId: string }[],
    release: { kind: HoldReleaseKind; reason: string | null },
  ): Promise<string[]> {
    const sources = await this.allocations.sourcesOf([patientId]);
    const unspent = unallocatedBySource(sources, await this.allocations.pairsOf([patientId]));
    const released = new Set(
      await this.holds.release(
        held.map((row) => row.paymentId),
        { ...release, by: this.context.requireUserId() },
      ),
    );
    for (const row of held.filter((candidate) => released.has(candidate.paymentId))) {
      const source = sources.find((candidate) => candidate.entryId === row.ledgerEntryId);
      const amount = fromCents(unspent.get(row.ledgerEntryId) ?? 0n);
      await this.audit.record({
        action: 'payment.release',
        resourceType: 'payment',
        resourceId: row.paymentId,
        patientId,
        after: { kind: release.kind, released: amount },
        reason: release.reason ?? undefined,
      });
      const event: AdvanceReleased = this.events.create(ADVANCE_RELEASED, {
        paymentId: row.paymentId,
        patientId,
        currency: source?.currency ?? (await this.tenancy.currentTenant()).currency,
        amount,
        kind: release.kind,
      });
      await this.events.publish(event);
    }
    return [...released];
  }

  /**
   * A7: the patient holds money for a plan that has no work left to charge → end the holds. The
   * plan read (`planWork`) checks no permission: settle runs inside whatever write triggered it.
   */
  private async closeHoldsIfPlanDone(patientId: string): Promise<boolean> {
    const held = await this.holds.activeFor(patientId);
    if (held.length === 0) return false;
    const { currency } = await this.tenancy.currentTenant();
    if ((await this.visits.planWork(patientId, currency)).open) return false;
    await this.releaseHolds(patientId, held, { kind: 'plan_closed', reason: null });
    return true;
  }

  /** One settle of every currency of `patientId`; the caller holds the account lock. */
  private async pass(
    patientId: string,
    newSourceIds: ReadonlySet<string>,
  ): Promise<NewAllocation[]> {
    const targets = await this.allocations.targetsOf([patientId]);
    const sources = await this.allocations.sourcesOf([patientId]);
    const pairs = await this.allocations.pairsOf([patientId]);
    const currencies = new Set([...targets, ...sources].map((row) => row.currency));
    const written: NewAllocation[] = [];
    for (const currency of currencies) {
      const rows = settle({
        targets: targets.filter((target) => target.currency === currency),
        sources: sources.filter((source) => source.currency === currency),
        pairs,
        newSourceIds,
      });
      if (rows.length === 0) continue;
      await this.allocations.insert(rows);
      written.push(...rows);
      if (rows.some((row) => row.kind === 'credit_applied')) {
        const event: CreditApplied = this.events.create(CREDIT_APPLIED, {
          patientId,
          currency,
          allocations: rows.map(toFact),
        });
        await this.events.publish(event);
      }
    }
    return written;
  }
}
