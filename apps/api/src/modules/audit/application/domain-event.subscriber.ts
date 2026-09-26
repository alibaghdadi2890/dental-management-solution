import { Injectable } from '@nestjs/common';
import { RequestContext } from '../../../platform/cls/request-context';
import type { DomainEvent } from '../../../platform/events/domain-event';
import { ANY_DOMAIN_EVENT, OnDomainEvent } from '../../../platform/events/event-bus';
import { AuditService } from './audit.service';

/**
 * The single generic subscriber that persists every domain event (CLAUDE.md §9). It runs in a
 * context rebuilt from the event, so the entry carries the event's tenant and actor even though
 * delivery happens after the originating transaction committed.
 */
@Injectable()
export class DomainEventAuditSubscriber {
  constructor(
    private readonly audit: AuditService,
    private readonly context: RequestContext,
  ) {}

  @OnDomainEvent(ANY_DOMAIN_EVENT)
  async onEvent(event: DomainEvent): Promise<void> {
    const tenantId = event.tenantId;
    if (tenantId === null) {
      return;
    }
    await this.context.run(
      {
        requestId: event.requestId ?? event.id,
        actorKind: event.actor.kind,
        tenantId,
        ...(event.actor.userId === null ? {} : { userId: event.actor.userId }),
        platformAdmin: event.actor.platformAdmin,
      },
      () =>
        this.audit.record({
          action: event.name,
          resourceType: 'event',
          resourceId: event.id,
          after: event.payload,
        }),
    );
  }
}
