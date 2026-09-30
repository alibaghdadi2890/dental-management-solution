import { Injectable } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { RequestContext } from '../cls/request-context';
import { TenantDb } from '../db/tenant-db';
import { newId } from '../kernel/id';
import type { DomainEvent } from './domain-event';

/** Channel that receives every domain event, for generic subscribers such as the audit log. */
export const ANY_DOMAIN_EVENT = 'domain-event:any';

/** Prefix of the channels in-transaction handlers listen on, apart from the after-commit ones. */
const IN_TRANSACTION = 'in-transaction:';

/** Subscribes a handler to a domain event by name; it runs after the publisher's commit. */
export const OnDomainEvent = (name: string): MethodDecorator => OnEvent(name);

/**
 * Subscribes a handler that runs inside the publisher's open `TenantDb` transaction, before commit;
 * a throw rolls the whole transaction back (CLAUDE.md §9). Handlers of one event run sequentially,
 * in registration order, and the first throw stops the rest. Database work through `TenantDb`
 * only, on the handler's own module's tables, and fast: it holds the publisher's locks. Events
 * published outside a `TenantDb` transaction (including `withoutTenant` work) can't have such
 * handlers. `@OnEvent` swallows handler errors unless `suppressErrors` is false.
 */
export const OnDomainEventInTransaction = (name: string): MethodDecorator =>
  OnEvent(`${IN_TRANSACTION}${name}`, { suppressErrors: false });

/**
 * In-process event bus (phase 1). Events published inside a tenant transaction are dispatched
 * only after it commits, so handlers never react to rolled-back changes. In-transaction handlers
 * run first, during `publish`, in the publisher's async context (its CLS and its transaction).
 * Handlers that are slow or must survive a crash enqueue a job instead of doing the work inline.
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

  /**
   * Runs the event's in-transaction handlers now and dispatches it after the commit (at once
   * outside a transaction). Dispatch follows the commit, not the handlers' outcome: a publisher that
   * catches an in-transaction handler's error and still commits dispatches the event anyway.
   */
  async publish(event: DomainEvent): Promise<void> {
    // Registered first, so events that in-transaction handlers publish dispatch after this one.
    const deferred = this.tenantDb.afterCommit(() => this.dispatch(event));
    // EventEmitter2 types listeners as returning void; Nest's wrappers return the handler's promise.
    // A copy: a handler that (un)subscribes must not change this loop.
    const handlers: readonly ((event: DomainEvent) => unknown)[] = [
      ...this.emitter.listeners(`${IN_TRANSACTION}${event.name}`),
    ];
    if (handlers.length > 0) {
      if (!deferred) {
        throw new Error(`${event.name} has in-transaction handlers and needs an open transaction`);
      }
      // One at a time: they share the transaction's single connection, and a handler still running
      // after another's failure could query after the rollback. A throw rolls the transaction back.
      for (const handler of handlers) {
        await handler.call(this.emitter, event);
      }
    }
    if (!deferred) {
      await this.dispatch(event);
    }
  }

  private async dispatch(event: DomainEvent): Promise<void> {
    await this.emitter.emitAsync(event.name, event);
    await this.emitter.emitAsync(ANY_DOMAIN_EVENT, event);
  }
}
