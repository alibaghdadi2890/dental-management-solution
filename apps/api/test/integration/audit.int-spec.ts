import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../../src/modules/audit';
import { type ContextSeed, RequestContext } from '../../src/platform/cls/request-context';
import { TenantDb } from '../../src/platform/db/tenant-db';
import { EventBus } from '../../src/platform/events/event-bus';
import { newId } from '../../src/platform/kernel/id';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { createTestApp, type TestApp } from '../support/test-app';

describe('audit log', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let audit: AuditService;
  let context: RequestContext;
  let tenantDb: TenantDb;
  let events: EventBus;

  const tenantA = newId();
  const tenantB = newId();
  const userA = newId();
  const seed = (tenantId: string, extra: Partial<ContextSeed> = {}): ContextSeed => ({
    requestId: `req-${newId()}`,
    actorKind: 'user',
    tenantId,
    userId: userA,
    ...extra,
  });
  const readAll = (tenantId: string) =>
    context.run({ ...seed(tenantId), platformAdmin: true }, () => audit.list({ limit: 100 }));

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    audit = testApp.app.get(AuditService);
    context = testApp.app.get(RequestContext);
    tenantDb = testApp.app.get(TenantDb);
    events = testApp.app.get(EventBus);
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  it('stamps actor, platform-admin flag and request id from the context', async () => {
    const context_ = seed(tenantA, { platformAdmin: true });
    await context.run(context_, () =>
      audit.record({
        action: 'branch.update',
        resourceType: 'branch',
        resourceId: 'b-1',
        before: { name: 'Main' },
        after: { name: 'Main St', temporaryPassword: 'never-stored' },
        reason: 'Renamed',
      }),
    );

    const { items } = await readAll(tenantA);
    expect(items[0]).toMatchObject({
      actorUserId: userA,
      actorKind: 'user',
      actorPlatformAdmin: true,
      action: 'branch.update',
      before: { name: 'Main' },
      after: { name: 'Main St' },
      reason: 'Renamed',
      requestId: context_.requestId,
    });
  });

  it('commits and rolls back with the surrounding transaction', async () => {
    const attempt = context.run(seed(tenantA), () =>
      tenantDb.run(async () => {
        await audit.record({ action: 'rolled.back', resourceType: 'x', resourceId: '1' });
        throw new Error('abort');
      }),
    );
    await expect(attempt).rejects.toThrow('abort');

    const { items } = await readAll(tenantA);
    expect(items.map((item) => item.action)).not.toContain('rolled.back');
  });

  it('cannot be updated or deleted by the runtime roles', async () => {
    for (const pool of [database.appPool, database.adminPool]) {
      await expect(pool.query("update audit_log set action = 'x'")).rejects.toThrow(
        /permission denied/,
      );
      await expect(pool.query('delete from audit_log')).rejects.toThrow(/permission denied/);
    }
  });

  it('records every published domain event with its actor', async () => {
    await context.run(seed(tenantA), () =>
      events.publish(events.create('TenantProvisioned', { tenantId: tenantA })),
    );

    const { items } = await readAll(tenantA);
    expect(items[0]).toMatchObject({
      action: 'TenantProvisioned',
      resourceType: 'event',
      actorUserId: userA,
      after: { tenantId: tenantA },
    });
  });

  it('pages newest first with an opaque cursor', async () => {
    const tenant = newId();
    for (const n of [1, 2, 3]) {
      testApp.clock.advance({ seconds: 1 });
      await context.run(seed(tenant), () =>
        audit.record({ action: `step.${n}`, resourceType: 'x', resourceId: String(n) }),
      );
    }

    const first = await context.run({ ...seed(tenant), platformAdmin: true }, () =>
      audit.list({ limit: 2 }),
    );
    expect(first.items.map((item) => item.action)).toEqual(['step.3', 'step.2']);
    expect(first.nextCursor).not.toBeNull();

    const second = await context.run({ ...seed(tenant), platformAdmin: true }, () =>
      audit.list({ limit: 2, cursor: first.nextCursor! }),
    );
    expect(second.items.map((item) => item.action)).toEqual(['step.1']);
    expect(second.nextCursor).toBeNull();
  });

  it("never shows one tenant's entries to another", async () => {
    await context.run(seed(tenantB), () =>
      audit.record({ action: 'b.only', resourceType: 'x', resourceId: '1' }),
    );
    const { items } = await readAll(tenantA);
    expect(items.map((item) => item.action)).not.toContain('b.only');
  });

  it('requires audit:read to list', async () => {
    await expect(context.run(seed(tenantA), () => audit.list({ limit: 5 }))).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});
