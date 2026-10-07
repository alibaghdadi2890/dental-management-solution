import { Injectable } from '@nestjs/common';
import { OnDomainEventInTransaction } from '../../../platform/events/event-bus';
import { TENANT_CURRENCY_CHANGED, type TenantCurrencyChanged } from '../../tenancy';
import { TenantCurrencyLockedError } from '../domain/ledger-errors';
import { LedgerEntriesRepository } from '../persistence/ledger-entries.repository';

/**
 * The currency lock (feature 7, H6, ADR-0035): `tenancy` cannot read the ledger, so it announces
 * a currency change inside its transaction and this handler refuses it once any ledger entry
 * exists. Entries are never deleted, so a locked tenant stays locked.
 */
@Injectable()
export class CurrencyLockSubscriber {
  constructor(private readonly entries: LedgerEntriesRepository) {}

  @OnDomainEventInTransaction(TENANT_CURRENCY_CHANGED)
  async onCurrencyChanged(event: TenantCurrencyChanged): Promise<void> {
    if (await this.entries.any()) {
      throw new TenantCurrencyLockedError(
        `This clinic has recorded balances in ${event.payload.from}; its currency can't change`,
      );
    }
  }
}
