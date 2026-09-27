import { Injectable, Logger } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { OnDomainEvent } from '../../../platform/events/event-bus';
import { TENANT_PROVISIONED, type TenantProvisioned } from '../../provisioning';
import { CatalogService } from './catalog.service';

/**
 * Every new clinic starts with the default catalog (C3). Consumes `provisioning`'s event without
 * depending on its services (ADR-0014). Runs after the provisioning commit as a system task
 * inside the new tenant. A failure is logged, never rethrown, so the event still reaches the
 * audit log; the admin's "Seed default catalog" button recovers.
 */
@Injectable()
export class CatalogSeedingSubscriber {
  private readonly logger = new Logger(CatalogSeedingSubscriber.name);

  constructor(
    private readonly context: RequestContext,
    private readonly catalog: CatalogService,
  ) {}

  @OnDomainEvent(TENANT_PROVISIONED)
  async onTenantProvisioned(event: TenantProvisioned): Promise<void> {
    const { tenantId } = event.payload;
    try {
      await this.context.run(
        { requestId: event.requestId ?? event.id, actorKind: 'system', tenantId },
        () => this.catalog.seedDefaultCatalog(),
      );
    } catch (error) {
      this.logger.error({ err: error, tenantId }, 'seeding the default catalog failed');
    }
  }
}
