import { EventEmitter2 } from '@nestjs/event-emitter';
import { ClsServiceManager } from 'nestjs-cls';
import { describe, expect, it } from 'vitest';
import type { AppClsStore } from '../cls/app-cls-store';
import { RequestContext } from '../cls/request-context';
import type { TenantDb } from '../db/tenant-db';
import type { DomainEvent } from './domain-event';
import { EventBus } from './event-bus';

type Hook = () => void | Promise<void>;

function setup(options: { inTransaction: boolean }) {
  const emitter = new EventEmitter2();
  const context = new RequestContext(ClsServiceManager.getClsService<AppClsStore>());
  const pending: Hook[] = [];
  const tenantDb = {
    afterCommit: (hook: Hook) => {
      if (options.inTransaction) pending.push(hook);
      return options.inTransaction;
    },
  } as unknown as TenantDb;
  const received: DomainEvent[] = [];
  emitter.on('PatientCreated', (event: DomainEvent) => received.push(event));
  return { bus: new EventBus(emitter, context, tenantDb), context, pending, received };
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
      actor: { userId: 'u1', kind: 'user' },
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
