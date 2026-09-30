import { Injectable } from '@nestjs/common';
import { EventEmitter2, EventEmitterModule, OnEvent } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { ClsServiceManager } from 'nestjs-cls';
import { describe, expect, it } from 'vitest';
import type { AppClsStore } from '../cls/app-cls-store';
import { RequestContext } from '../cls/request-context';
import type { TenantDb } from '../db/tenant-db';
import { DomainError } from '../kernel/domain-error';
import type { DomainEvent } from './domain-event';
import { ANY_DOMAIN_EVENT, EventBus, OnDomainEventInTransaction } from './event-bus';

type Hook = () => void | Promise<void>;

class ChargeFailed extends DomainError {
  readonly code = 'visit.charge_failed';
  readonly kind = 'conflict';
}

/**
 * A `TenantDb` stand-in: with `inTransaction`, after-commit hooks queue up until `commit()`; a
 * rollback is simply never calling it.
 */
function fakeTenantDb(options: { inTransaction: boolean }) {
  const pending: Hook[] = [];
  const tenantDb = {
    afterCommit: (hook: Hook) => {
      if (options.inTransaction) pending.push(hook);
      return options.inTransaction;
    },
  } as unknown as TenantDb;
  const commit = async () => {
    for (const hook of pending.splice(0)) await hook();
  };
  return { tenantDb, pending, commit };
}

function setup(options: { inTransaction: boolean }) {
  const emitter = new EventEmitter2();
  const context = new RequestContext(ClsServiceManager.getClsService<AppClsStore>());
  const { tenantDb, pending, commit } = fakeTenantDb(options);
  const received: DomainEvent[] = [];
  emitter.on('PatientCreated', (event: DomainEvent) => received.push(event));
  return {
    bus: new EventBus(emitter, context, tenantDb),
    emitter,
    context,
    pending,
    commit,
    received,
  };
}

describe('EventBus', () => {
  it('stamps events with tenant, actor and request from the context', async () => {
    const { bus, context } = setup({ inTransaction: false });

    const event = await context.run(
      { requestId: 'req-00000001', actorKind: 'user', tenantId: 't1', userId: 'u1' },
      () => Promise.resolve(bus.create('PatientCreated', { patientId: 'p1' })),
    );

    expect(event).toMatchObject({
      name: 'PatientCreated',
      tenantId: 't1',
      actor: { userId: 'u1', kind: 'user', platformAdmin: false },
      requestId: 'req-00000001',
      payload: { patientId: 'p1' },
    });
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('dispatches immediately outside a transaction', async () => {
    const { bus, received } = setup({ inTransaction: false });
    await bus.publish(bus.create('PatientCreated', { patientId: 'p1' }));
    expect(received).toHaveLength(1);
  });

  it('holds events until the surrounding transaction commits', async () => {
    const { bus, pending, received } = setup({ inTransaction: true });

    await bus.publish(bus.create('PatientCreated', { patientId: 'p1' }));
    expect(received).toHaveLength(0);

    for (const hook of pending) await hook();
    expect(received).toHaveLength(1);
  });
});

describe('in-transaction handlers', () => {
  const IN_TRANSACTION_VISIT_COMPLETED = 'in-transaction:VisitCompleted';

  it('run during publish, before the after-commit dispatch', async () => {
    const { bus, emitter, commit } = setup({ inTransaction: true });
    const order: string[] = [];
    emitter.on(IN_TRANSACTION_VISIT_COMPLETED, () => order.push('in-transaction'));
    emitter.on('VisitCompleted', () => order.push('after-commit'));

    await bus.publish(bus.create('VisitCompleted', { visitId: 'v1' }));
    expect(order).toEqual(['in-transaction']);

    await commit();
    expect(order).toEqual(['in-transaction', 'after-commit']);
  });

  it('reject publish when they throw, and nothing is dispatched', async () => {
    const { bus, emitter, received } = setup({ inTransaction: true });
    const failure = new ChargeFailed('ledger failed');
    // Decorated handlers reject asynchronously; the Nest wiring tests below cover that path.
    emitter.on('in-transaction:PatientCreated', () => {
      throw failure;
    });

    await expect(bus.publish(bus.create('PatientCreated', { patientId: 'p1' }))).rejects.toBe(
      failure,
    );
    expect(received).toHaveLength(0);
  });

  it('dispatch the events they publish after the event that caused them', async () => {
    const { bus, emitter, commit } = setup({ inTransaction: true });
    const dispatched: string[] = [];
    emitter.on(IN_TRANSACTION_VISIT_COMPLETED, () => {
      void bus.publish(bus.create('LedgerEntryRecorded', { entryId: 'e1' }));
    });
    emitter.on('VisitCompleted', () => dispatched.push('VisitCompleted'));
    emitter.on('LedgerEntryRecorded', () => dispatched.push('LedgerEntryRecorded'));

    await bus.publish(bus.create('VisitCompleted', { visitId: 'v1' }));
    await commit();

    expect(dispatched).toEqual(['VisitCompleted', 'LedgerEntryRecorded']);
  });

  it('need an open transaction', async () => {
    const { bus, emitter } = setup({ inTransaction: false });
    let ran = false;
    emitter.on(IN_TRANSACTION_VISIT_COMPLETED, () => {
      ran = true;
    });

    await expect(bus.publish(bus.create('VisitCompleted', { visitId: 'v1' }))).rejects.toThrow(
      /VisitCompleted has in-transaction handlers and needs an open transaction/,
    );
    expect(ran).toBe(false);
  });

  it('leave events without in-transaction listeners dispatching as before', async () => {
    const { bus, emitter, commit, received } = setup({ inTransaction: true });
    emitter.on(IN_TRANSACTION_VISIT_COMPLETED, () => undefined);

    await bus.publish(bus.create('PatientCreated', { patientId: 'p1' }));
    expect(received).toHaveLength(0);

    await commit();
    expect(received).toHaveLength(1);
  });
});

describe('decorated handlers (Nest wiring)', () => {
  @Injectable()
  class ChargeHandlers {
    readonly log: string[] = [];
    failFirst = false;

    @OnDomainEventInTransaction('VisitCompleted')
    async postCharge(): Promise<void> {
      this.log.push('first:start');
      await new Promise((resolve) => setTimeout(resolve, 10));
      this.log.push('first:end');
      if (this.failFirst) {
        throw new ChargeFailed('ledger write failed');
      }
    }

    @OnDomainEventInTransaction('VisitCompleted')
    recordFollowUp(): Promise<void> {
      this.log.push('second');
      return Promise.resolve();
    }

    // Plain `@OnEvent` is here only to pin the library default that makes `suppressErrors: false`
    // necessary on the in-transaction decorator.
    @OnEvent('SwallowedByDefault')
    swallowed(): Promise<void> {
      return Promise.reject(new Error('never surfaces'));
    }
  }

  async function wire() {
    const moduleRef = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [ChargeHandlers],
    }).compile();
    moduleRef.useLogger(false);
    await moduleRef.init();
    const emitter = moduleRef.get(EventEmitter2);
    const context = new RequestContext(ClsServiceManager.getClsService<AppClsStore>());
    const { tenantDb } = fakeTenantDb({ inTransaction: true });
    const bus = new EventBus(emitter, context, tenantDb);
    return { moduleRef, emitter, bus, handlers: moduleRef.get(ChargeHandlers) };
  }

  it('run one at a time, in registration order', async () => {
    const { moduleRef, bus, handlers } = await wire();

    await bus.publish(bus.create('VisitCompleted', { visitId: 'v1' }));

    expect(handlers.log).toEqual(['first:start', 'first:end', 'second']);
    await moduleRef.close();
  });

  it('surface the error, with its type, and stop at the first throw (@OnEvent swallows by default)', async () => {
    const { moduleRef, emitter, bus, handlers } = await wire();
    handlers.failFirst = true;

    await expect(
      bus.publish(bus.create('VisitCompleted', { visitId: 'v1' })),
    ).rejects.toBeInstanceOf(ChargeFailed);
    expect(handlers.log).toEqual(['first:start', 'first:end']);
    await expect(emitter.emitAsync('SwallowedByDefault', {})).resolves.toEqual([undefined]);
    await moduleRef.close();
  });
});

describe('catch-all channel', () => {
  it('delivers every event to generic subscribers such as the audit log', async () => {
    const emitter = new EventEmitter2();
    const context = new RequestContext(ClsServiceManager.getClsService<AppClsStore>());
    const { tenantDb } = fakeTenantDb({ inTransaction: false });
    const bus = new EventBus(emitter, context, tenantDb);
    const seen: string[] = [];
    emitter.on(ANY_DOMAIN_EVENT, (event: DomainEvent) => seen.push(event.name));

    await bus.publish(bus.create('TenantProvisioned', { tenantId: 't1' }));

    expect(seen).toEqual(['TenantProvisioned']);
  });
});
