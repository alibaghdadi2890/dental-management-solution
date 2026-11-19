import { Injectable, Logger } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { OnDomainEvent, OnDomainEventInTransaction } from '../../../platform/events/event-bus';
import { TENANT_PROVISIONED, type TenantProvisioned } from '../../provisioning';
import { TENANT_CURRENCY_CHANGED, type TenantCurrencyChanged } from '../../tenancy';
import { InventoryCurrencyLockedError } from '../domain/inventory-errors';
import { ItemsService } from './items.service';
import { StockService } from './stock.service';
import { SuppliersService } from './suppliers.service';

/**
 * Every new clinic starts with the twelve categories (Part A). Consumes `provisioning`'s event
 * without depending on its services (ADR-0014), after the commit, as a system task inside the new
 * tenant. A failure is logged and never rethrown: the categories list adds missing ones itself.
 */
@Injectable()
export class InventoryCategorySeedingSubscriber {
  private readonly logger = new Logger(InventoryCategorySeedingSubscriber.name);

  constructor(
    private readonly context: RequestContext,
    private readonly items: ItemsService,
  ) {}

  @OnDomainEvent(TENANT_PROVISIONED)
  async onTenantProvisioned(event: TenantProvisioned): Promise<void> {
    const { tenantId } = event.payload;
    try {
      await this.context.run(
        { requestId: event.requestId ?? event.id, actorKind: 'system', tenantId },
        () => this.items.seedCategories(),
      );
    } catch (error) {
      this.logger.error({ err: error, tenantId }, 'seeding the inventory categories failed');
    }
  }
}

/**
 * The currency lock (ADR-0035) extended to inventory: once a batch is priced or a supplier has an
 * opening balance, a payment or an adjustment, `tenancy`'s currency change is refused in its
 * transaction.
 */
@Injectable()
export class InventoryCurrencyLockSubscriber {
  constructor(
    private readonly stock: StockService,
    private readonly suppliers: SuppliersService,
  ) {}

  @OnDomainEventInTransaction(TENANT_CURRENCY_CHANGED)
  async onCurrencyChanged(event: TenantCurrencyChanged): Promise<void> {
    if ((await this.stock.hasPricedStock()) || (await this.suppliers.hasMoney())) {
      throw new InventoryCurrencyLockedError(
        `This clinic has inventory money in ${event.payload.from}; its currency can't change`,
      );
    }
  }
}
