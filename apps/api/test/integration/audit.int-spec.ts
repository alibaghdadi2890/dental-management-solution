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

  describe('the activity feed (feature 7, H7)', () => {
    const tenant = newId();
    const other = newId();
    const staff = newId();
    const patient = newId();
    const visit = newId();
    const list = (query: Partial<Parameters<AuditService['list']>[0]>, tenantId = tenant) =>
      context.run({ ...seed(tenantId), platformAdmin: true }, () =>
        audit.list({ limit: 100, ...query }),
      );
    const actions = async (
      query: Partial<Parameters<AuditService['list']>[0]>,
      tenantId = tenant,
    ) => (await list(query, tenantId)).items.map((item) => item.action);

    beforeAll(async () => {
      const step = () => {
        testApp.clock.advance({ seconds: 1 });
      };
      const as = (extra: Partial<ContextSeed>, work: () => Promise<void>) =>
        context.run(seed(tenant, extra), work);
      step();
      await as({}, () =>
        audit.record({ action: 'patient.update', resourceType: 'patient', resourceId: patient }),
      );
      step();
      // The surrounding work says who and which visit; the row itself names neither.
      await as({ userId: staff }, () =>
        audit.about({ patientId: patient, visitId: visit }, () =>
          audit.record({
            action: 'treatment_plan.cancel',
            resourceType: 'treatment_plan',
            resourceId: newId(),
            after: { status: 'cancelled' },
          }),
        ),
      );
      step();
      await as({ platformAdmin: true }, () =>
        audit.record({
          action: 'payment.create',
          resourceType: 'payment',
          resourceId: newId(),
          after: { patientId: patient, receiptNumber: 3 },
        }),
      );
      step();
      // A payment's own ledger entry: in the log, not in the feed.
      await as({}, () =>
        audit.record({
          action: 'ledger_entry.create',
          resourceType: 'ledger_entry',
          resourceId: newId(),
          after: { patientId: patient, kind: 'payment' },
          hidden: true,
        }),
      );
      step();
      await as({}, () =>
        audit.record({
          action: 'catalog.service.update',
          resourceType: 'procedure',
          resourceId: 'p',
        }),
      );
      step();
      await as({}, () => events.publish(events.create('VisitPaused', { visitId: visit })));
      await context.run(seed(other), () =>
        audit.record({ action: 'patient.update', resourceType: 'patient', resourceId: patient }),
      );
    });

    it('stamps the area from the action, and the patient and visit from the context', async () => {
      const { items } = await list({});
      const row = (action: string) => items.find((item) => item.action === action);
      expect(row('patient.update')).toMatchObject({
        area: 'patients',
        patientId: patient,
        visitId: null,
      });
      expect(row('treatment_plan.cancel')).toMatchObject({
        area: 'visits',
        patientId: patient,
        visitId: visit,
      });
      expect(row('payment.create')).toMatchObject({ area: 'payments', patientId: patient });
      expect(row('ledger_entry.create')).toMatchObject({ area: null, patientId: patient });
      expect(row('catalog.service.update')).toMatchObject({ area: 'catalog', patientId: null });
      expect(row('VisitPaused')).toMatchObject({
        area: null,
        resourceType: 'event',
        visitId: visit,
      });
    });

    it('lists only what a person did, newest first, and narrows it', async () => {
      expect(await actions({ feed: true })).toEqual([
        'catalog.service.update',
        'payment.create',
        'treatment_plan.cancel',
        'patient.update',
      ]);
      expect(await actions({ feed: true, area: 'payments' })).toEqual(['payment.create']);
      expect(await actions({ feed: true, actorUserId: staff })).toEqual(['treatment_plan.cancel']);
      expect(await actions({ feed: true, platformAdmin: true })).toEqual(['payment.create']);
      expect(await actions({ feed: true, platformAdmin: false })).toHaveLength(3);
      expect(await actions({ feed: true, patientId: patient })).toEqual([
        'payment.create',
        'treatment_plan.cancel',
        'patient.update',
      ]);
      expect(await actions({ feed: true, visitId: visit })).toEqual(['treatment_plan.cancel']);

      const [, second] = (await list({ feed: true })).items;
      expect(await actions({ feed: true, from: second?.occurredAt })).toEqual([
        'catalog.service.update',
        'payment.create',
      ]);
    });

    it("keeps the filters inside the tenant: another clinic's rows about the same ids stay out", async () => {
      expect(await actions({ feed: true, patientId: patient }, other)).toEqual(['patient.update']);
      expect(await actions({ feed: true, visitId: visit }, other)).toEqual([]);
      expect(await actions({ feed: true, actorUserId: staff }, other)).toEqual([]);
    });
  });

  it('requires audit:read to list', async () => {
    await expect(context.run(seed(tenantA), () => audit.list({ limit: 5 }))).rejects.toMatchObject({
      code: 'forbidden',
    });
  });
});
