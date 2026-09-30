import { Injectable } from '@nestjs/common';
import { EventEmitter2, EventEmitterModule, OnEvent } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { ClsServiceManager } from 'nestjs-cls';
import { describe, expect, it } from 'vitest';
import type { AppClsStore } from '../cls/app-cls-store';
import { RequestContext } from '../cls/request-context';
import type { Transaction } from '../db/database';
import type { TenantDb } from '../db/tenant-db';
import type { DomainEvent } from './domain-event';
import { ANY_DOMAIN_EVENT, EventBus, OnDomainEventInTransaction } from './event-bus';

type Hook = () => void | Promise<void>;

/** A `TenantDb` stand-in: with `inTransaction`, after-commit hooks queue up until `commit()`. */
function fakeTenantDb(options: { inTransaction: boolean }) {
  const pending: Hook[] = [];
  const tenantDb = {
    currentTransaction: () => (options.inTransaction ? ({} as Transaction) : undefined),
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

  it('reject publish when they throw, and the after-commit dispatch never runs', async () => {
    const { bus, emitter, pending } = setup({ inTransaction: true });
    // Decorated handlers reject asynchronously; the Nest wiring test below covers that path.
    emitter.on(IN_TRANSACTION_VISIT_COMPLETED, () => {
      throw new Error('ledger failed');
    });

    await expect(bus.publish(bus.create('VisitCompleted', { visitId: 'v1' }))).rejects.toThrow(
      'ledger failed',
    );
    expect(pending).toHaveLength(0);
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
  class FailingHandlers {
    @OnDomainEventInTransaction('VisitCompleted')
    postCharge(): Promise<void> {
      return Promise.reject(new Error('ledger write failed'));
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
      providers: [FailingHandlers],
    }).compile();
    moduleRef.useLogger(false);
    await moduleRef.init();
    return moduleRef;
  }

  it('surface an in-transaction handler error to the publisher (@OnEvent swallows by default)', async () => {
    const moduleRef = await wire();
    const emitter = moduleRef.get(EventEmitter2);
    const context = new RequestContext(ClsServiceManager.getClsService<AppClsStore>());
    const { tenantDb, pending } = fakeTenantDb({ inTransaction: true });
    const bus = new EventBus(emitter, context, tenantDb);

    await expect(bus.publish(bus.create('VisitCompleted', { visitId: 'v1' }))).rejects.toThrow(
      'ledger write failed',
    );
    expect(pending).toHaveLength(0);
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
