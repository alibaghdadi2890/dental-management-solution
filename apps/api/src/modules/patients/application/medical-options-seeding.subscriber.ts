import { Injectable, Logger } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import { OnDomainEvent } from '../../../platform/events/event-bus';
import { TENANT_PROVISIONED, type TenantProvisioned } from '../../provisioning';
import { MedicalOptionsService } from './medical-options.service';

/**
 * Every new clinic starts with the default allergy and condition lists (feature 10, ADR-0046).
 * Consumes `provisioning`'s event without depending on its services (ADR-0014), after the
 * provisioning commit, as a system task inside the new tenant. A failure is logged, never
 * rethrown, so the event still reaches the audit log; the Catalog's "Add the default lists"
 * recovers.
 */
@Injectable()
export class MedicalOptionsSeedingSubscriber {
  private readonly logger = new Logger(MedicalOptionsSeedingSubscriber.name);

  constructor(
    private readonly context: RequestContext,
    private readonly options: MedicalOptionsService,
  ) {}

  @OnDomainEvent(TENANT_PROVISIONED)
  async onTenantProvisioned(event: TenantProvisioned): Promise<void> {
    const { tenantId } = event.payload;
    try {
      await this.context.run(
        { requestId: event.requestId ?? event.id, actorKind: 'system', tenantId },
        () => this.options.seedDefaults(),
      );
    } catch (error) {
      this.logger.error({ err: error, tenantId }, 'seeding the medical-history lists failed');
    }
  }
}
