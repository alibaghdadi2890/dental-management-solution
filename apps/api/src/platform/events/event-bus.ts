import { Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { RequestContext } from '../cls/request-context';
import { TenantDb } from '../db/tenant-db';
import { newId } from '../kernel/id';
import type { DomainEvent } from './domain-event';

/** Channel that receives every domain event, for generic subscribers such as the audit log. */
export const ANY_DOMAIN_EVENT = 'domain-event:any';

/** Subscribes a handler to a domain event by name. */
export const OnDomainEvent = (name: string): MethodDecorator => OnEvent(name);

/**
 * In-process event bus (phase 1). Events published inside a tenant transaction are dispatched
 * only after it commits, so handlers never react to rolled-back changes. Handlers that are slow or
 * must survive a crash enqueue a job instead of doing the work inline.
 */
@Injectable()
export class EventBus {
  constructor(
    private readonly emitter: EventEmitter2,
    private readonly context: RequestContext,
    private readonly tenantDb: TenantDb,
  ) {}

  create<TName extends string, TPayload extends object>(
    name: TName,
    payload: TPayload,
  ): DomainEvent<TName, TPayload> {
    return {
      id: newId(),
      name,
      occurredAt: new Date().toISOString(),
      tenantId: this.context.tenantId ?? null,
      actor: {
        userId: this.context.userId ?? null,
        kind: this.context.actorKind ?? 'system',
        platformAdmin: this.context.isPlatformAdmin,
      },
      requestId: this.context.requestId ?? null,
      payload,
    };
  }

  async publish(event: DomainEvent): Promise<void> {
    if (this.tenantDb.afterCommit(() => this.dispatch(event))) {
      return;
    }
    await this.dispatch(event);
  }

  private async dispatch(event: DomainEvent): Promise<void> {
    await this.emitter.emitAsync(event.name, event);
    await this.emitter.emitAsync(ANY_DOMAIN_EVENT, event);
  }
}
