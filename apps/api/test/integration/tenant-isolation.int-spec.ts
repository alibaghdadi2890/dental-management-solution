import { sql } from 'drizzle-orm';
import { ClsServiceManager } from 'nestjs-cls';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppClsStore } from '../../src/platform/cls/app-cls-store';
import {
  type ContextSeed,
  MissingTenantContextError,
  RequestContext,
} from '../../src/platform/cls/request-context';
import { CURRENT_TENANT_SQL } from '../../src/platform/db/columns';
import { createDatabase } from '../../src/platform/db/database';
import { PlatformAccessDeniedError, PlatformAdminDb } from '../../src/platform/db/platform-admin-db';
import { TenantDb } from '../../src/platform/db/tenant-db';
import { newId } from '../../src/platform/kernel/id';
import { startTestDatabase, type TestDatabase } from '../support/postgres';

const TENANT_A = newId();
const TENANT_B = newId();

const context = new RequestContext(ClsServiceManager.getClsService<AppClsStore>());
const asUser = (tenantId?: string): ContextSeed => ({
  requestId: newId(),
  actorKind: 'user',
  userId: newId(),
  ...(tenantId ? { tenantId } : {}),
});

describe('tenant isolation (RLS)', () => {
  let database: TestDatabase;
  let tenantDb: TenantDb;
  let adminDb: PlatformAdminDb;

  const labels = (rows: { rows: Record<string, unknown>[] }) =>
    rows.rows.map((row) => row['label']).sort();

  beforeAll(async () => {
    database = await startTestDatabase();
    await database.ownerPool.query(`
      CREATE TABLE rls_probe (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL DEFAULT ${CURRENT_TENANT_SQL},
        label text NOT NULL
      );
      ALTER TABLE rls_probe ENABLE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON rls_probe
        USING (tenant_id = ${CURRENT_TENANT_SQL})
        WITH CHECK (tenant_id = ${CURRENT_TENANT_SQL});
    `);
    await database.ownerPool.query(
      'INSERT INTO rls_probe (id, tenant_id, label) VALUES ($1, $2, $3), ($4, $5, $6)',
      [newId(), TENANT_A, 'a-1', newId(), TENANT_B, 'b-1'],
    );
    tenantDb = new TenantDb(createDatabase(database.appPool), context);
    adminDb = new PlatformAdminDb(createDatabase(database.adminPool), context);
  });

  afterAll(async () => {
    await database.stop();
  });

  it('only returns the current tenant rows', async () => {
    const rows = await context.run(asUser(TENANT_A), () =>
      tenantDb.run((tx) => tx.execute(sql`select label from rls_probe`)),
    );
    expect(labels(rows)).toEqual(['a-1']);
  });

  it('fills tenant_id from the transaction on insert', async () => {
    await context.run(asUser(TENANT_B), () =>
      tenantDb.run((tx) =>
        tx.execute(sql`insert into rls_probe (id, label) values (${newId()}, 'b-2')`),
      ),
    );
    const owner = await database.ownerPool.query(
      "select tenant_id from rls_probe where label = 'b-2'",
    );
    expect(owner.rows).toEqual([{ tenant_id: TENANT_B }]);
  });

  it('rejects writing a row into another tenant', async () => {
    const attempt = context.run(asUser(TENANT_A), () =>
      tenantDb.run((tx) =>
        tx.execute(
          sql`insert into rls_probe (id, tenant_id, label) values (${newId()}, ${TENANT_B}, 'sneaky')`,
        ),
      ),
    );
    await expect(attempt).rejects.toThrow();
  });

  it('cannot update or delete another tenant rows', async () => {
    const [updated, deleted] = await context.run(asUser(TENANT_A), () =>
      tenantDb.run(async (tx) => [
        await tx.execute(sql`update rls_probe set label = 'hijacked' where label = 'b-1'`),
        await tx.execute(sql`delete from rls_probe where label = 'b-1'`),
      ]),
    );
    expect(updated.rowCount).toBe(0);
    expect(deleted.rowCount).toBe(0);
  });

  it('refuses to open a transaction without a tenant', async () => {
    const attempt = context.run(asUser(), () => tenantDb.run((tx) => tx.execute(sql`select 1`)));
    await expect(attempt).rejects.toBeInstanceOf(MissingTenantContextError);
  });

  it('returns nothing, not everything, when the tenant setting is missing', async () => {
    const rows = await database.appPool.query('select label from rls_probe');
    expect(rows.rows).toEqual([]);
  });

  it('joins the open transaction on nested calls and rolls back together', async () => {
    const attempt = context.run(asUser(TENANT_A), () =>
      tenantDb.run(async () => {
        await tenantDb.run((tx) =>
          tx.execute(sql`insert into rls_probe (id, label) values (${newId()}, 'a-rolled-back')`),
        );
        throw new Error('abort');
      }),
    );
    await expect(attempt).rejects.toThrow('abort');
    const rows = await database.ownerPool.query(
      "select 1 from rls_probe where label = 'a-rolled-back'",
    );
    expect(rows.rowCount).toBe(0);
  });

  it('runs after-commit hooks only when the transaction commits', async () => {
    const fired: string[] = [];
    await context.run(asUser(TENANT_A), async () => {
      await tenantDb.run(() => {
        tenantDb.afterCommit(() => {
          fired.push('committed');
        });
        return Promise.resolve();
      });
      await tenantDb
        .run(() => {
          tenantDb.afterCommit(() => {
            fired.push('rolled-back');
          });
          return Promise.reject(new Error('abort'));
        })
        .catch(() => undefined);
    });
    expect(fired).toEqual(['committed']);
    expect(tenantDb.afterCommit(() => undefined)).toBe(false);
  });

  it('refuses withoutTenant() for normal users', async () => {
    const attempt = context.run(asUser(TENANT_A), () =>
      adminDb.withoutTenant('test', (tx) => tx.execute(sql`select 1`)),
    );
    await expect(attempt).rejects.toBeInstanceOf(PlatformAccessDeniedError);
  });

  it('allows withoutTenant() for platform admins and system tasks, across tenants', async () => {
    const seed = { requestId: newId(), actorKind: 'system' as const };
    const rows = await context.run(seed, () =>
      adminDb.withoutTenant('test: cross-tenant read', (tx) =>
        tx.execute(sql`select label from rls_probe where label in ('a-1', 'b-1')`),
      ),
    );
    expect(labels(rows)).toEqual(['a-1', 'b-1']);

    const admin = { ...asUser(), platformAdmin: true };
    await expect(
      context.run(admin, () => adminDb.withoutTenant('test', (tx) => tx.execute(sql`select 1`))),
    ).resolves.toBeDefined();
  });

  it('has RLS enabled with a policy on every table that has a tenant_id', async () => {
    const unprotected = await database.ownerPool.query(`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
      where n.nspname = 'public' and c.relkind = 'r'
        and (not c.relrowsecurity or not exists (select 1 from pg_policy p where p.polrelid = c.oid))
    `);
    expect(unprotected.rows).toEqual([]);
  });
});
