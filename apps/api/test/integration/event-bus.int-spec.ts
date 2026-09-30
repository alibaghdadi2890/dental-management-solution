import { Injectable } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CORE_PLATFORM_MODULES } from '../../src/app.module';
import { AuditModule } from '../../src/modules/audit';
import { type ContextSeed, RequestContext } from '../../src/platform/cls/request-context';
import { APP_CONFIG } from '../../src/platform/config/config.module';
import { TenantDb } from '../../src/platform/db/tenant-db';
import type { DomainEvent } from '../../src/platform/events/domain-event';
import { EventBus, OnDomainEventInTransaction } from '../../src/platform/events/event-bus';
import { newId } from '../../src/platform/kernel/id';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { testConfig } from '../support/test-config';

/**
 * A throwaway table rather than a module's own: the handler needs rows no service writes, and a
 * plain table (no RLS, no foreign keys) keeps the probe independent of any module's invariants.
 * `txid` defaults to the writing transaction's id, which proves handler and publisher share one.
 */
const PROBE_TABLE = `event_bus_probe_${newId().replaceAll('-', '')}`;
const probe = sql.identifier(PROBE_TABLE);
const PROBE_EVENT = 'ProbeRecorded';

interface ProbePayload {
  fail: boolean;
}

/** Writes its own row through `TenantDb` in the publisher's transaction, then maybe throws. */
@Injectable()
class ProbeHandler {
  constructor(
    private readonly tenantDb: TenantDb,
    private readonly context: RequestContext,
  ) {}

  @OnDomainEventInTransaction(PROBE_EVENT)
  async onProbe(event: DomainEvent<typeof PROBE_EVENT, ProbePayload>): Promise<void> {
    await this.tenantDb.run((tx) =>
      tx.execute(
        sql`insert into ${probe} (source, tenant_id, user_id)
            values ('handler', ${this.context.requireTenantId()}, ${this.context.userId ?? null})`,
      ),
    );
    if (event.payload.fail) {
      throw new Error('handler failed');
    }
  }
}

interface ProbeRow {
  source: string;
  tenant_id: string;
  user_id: string | null;
  txid: string;
}

describe('in-transaction domain event handlers', () => {
  let database: TestDatabase;
  let moduleRef: TestingModule;
  let context: RequestContext;
  let tenantDb: TenantDb;
  let events: EventBus;

  const userId = newId();
  const seed = (tenantId: string): ContextSeed => ({
    requestId: `req-${newId()}`,
    actorKind: 'user',
    tenantId,
    userId,
  });

  const probeRows = async (tenantId: string): Promise<ProbeRow[]> =>
    (
      await database.ownerPool.query<ProbeRow>(
        `select source, tenant_id, user_id, txid::text from ${PROBE_TABLE}
         where tenant_id = $1 order by source`,
        [tenantId],
      )
    ).rows;
  const auditActions = async (eventId: string): Promise<string[]> =>
    (
      await database.ownerPool.query<{ action: string }>(
        `select action from audit_log where resource_type = 'event' and resource_id = $1`,
        [eventId],
      )
    ).rows.map((row) => row.action);

  /**
   * A publisher: writes its own row and publishes, recording the event id in `published`, then
   * counts (inside its transaction) the audit entries for the event, which must not exist yet.
   */
  const publishInTransaction = (fail: boolean, published: { eventId?: string }) =>
    tenantDb.run(async (tx) => {
      await tx.execute(
        sql`insert into ${probe} (source, tenant_id, user_id)
            values ('publisher', ${context.requireTenantId()}, ${userId})`,
      );
      const event = events.create(PROBE_EVENT, { fail });
      published.eventId = event.id;
      await events.publish(event);
      const audited = await tx.execute(
        sql`select 1 from audit_log where resource_type = 'event' and resource_id = ${event.id}`,
      );
      return { auditedBeforeCommit: audited.rows.length };
    });

  beforeAll(async () => {
    database = connectTestDatabase();
    await database.ownerPool.query(
      `create table ${PROBE_TABLE} (
         source text not null,
         tenant_id uuid not null,
         user_id uuid,
         txid bigint not null default txid_current()
       )`,
    );
    await database.ownerPool.query(`grant select, insert on ${PROBE_TABLE} to dcm_app`);

    moduleRef = await Test.createTestingModule({
      imports: [...CORE_PLATFORM_MODULES, AuditModule],
      providers: [ProbeHandler],
    })
      .overrideProvider(APP_CONFIG)
      .useValue(
        testConfig({
          DATABASE_URL: database.urls.app,
          DATABASE_ADMIN_URL: database.urls.admin,
          DATABASE_POOL_MAX: '4',
        }),
      )
      .compile();
    moduleRef.useLogger(false);
    await moduleRef.init();
    context = moduleRef.get(RequestContext);
    tenantDb = moduleRef.get(TenantDb);
    events = moduleRef.get(EventBus);
  });

  afterAll(async () => {
    await moduleRef.close();
    await database.ownerPool.query(`drop table if exists ${PROBE_TABLE}`);
    await database.close();
  });

  it("commits the handler's write with the publisher's, in one transaction and context", async () => {
    const tenantId = newId();
    const published: { eventId?: string } = {};

    const { auditedBeforeCommit } = await context.run(seed(tenantId), () =>
      publishInTransaction(false, published),
    );

    const rows = await probeRows(tenantId);
    expect(rows.map((row) => row.source)).toEqual(['handler', 'publisher']);
    const [handler, publisher] = rows;
    expect(handler?.txid).toBe(publisher?.txid);
    expect(handler).toMatchObject({ tenant_id: tenantId, user_id: userId });
    expect(auditedBeforeCommit).toBe(0);
    expect(await auditActions(published.eventId ?? '')).toEqual([PROBE_EVENT]);
  });

  it("rolls the publisher's transaction back when the handler throws", async () => {
    const tenantId = newId();
    const published: { eventId?: string } = {};

    const attempt = context.run(seed(tenantId), () => publishInTransaction(true, published));

    await expect(attempt).rejects.toThrow('handler failed');
    expect(await probeRows(tenantId)).toEqual([]);
    expect(published.eventId).toBeDefined();
    expect(await auditActions(published.eventId ?? '')).toEqual([]);
  });

  it('refuses to publish an event with in-transaction handlers outside a transaction', async () => {
    const attempt = context.run(seed(newId()), () =>
      events.publish(events.create(PROBE_EVENT, { fail: false })),
    );

    await expect(attempt).rejects.toThrow(/needs an open transaction/);
  });
});
