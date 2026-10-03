import { fromCents } from '@dcm/contracts';
import { Injectable } from '@nestjs/common';
import { TenantDb } from '../../../platform/db/tenant-db';
import { EventBus } from '../../../platform/events/event-bus';
import { type NewAllocation, settle } from '../domain/allocate';
import type { AccountSource, AccountTarget } from '../domain/payment';
import { CREDIT_APPLIED, type CreditApplied } from '../events/payment-events';
import { AllocationsRepository } from '../persistence/allocations.repository';
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
 * advisory locks are re-entrant). Not permission-gated: the write that triggers it was.
 */
@Injectable()
export class Settlement {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly events: EventBus,
    private readonly entries: LedgerEntriesRepository,
    private readonly allocations: AllocationsRepository,
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
   * `CreditApplied` when existing credit covered a charge. Returns the rows written.
   */
  settle(
    patientId: string,
    newSourceIds: ReadonlySet<string> = new Set(),
  ): Promise<NewAllocation[]> {
    return this.tenantDb.run(async () => {
      await this.entries.lockAccount(patientId);
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
    });
  }
}
