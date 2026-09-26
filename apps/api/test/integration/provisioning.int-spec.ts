import type { AuditPage, PlatformTenant, Session, Tenant } from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../src/platform/kernel/id';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { browser, createPlatformAdmin, signIn, uniqueEmail } from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';

describe('provisioning (platform admin)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let admin: TestAgent;

  const request = (overrides: { slug?: string; email?: string } = {}) => {
    const slug = overrides.slug ?? `clinic-${newId().slice(-12)}`;
    return {
      clinic: { name: `Clinic ${slug}`, slug },
      firstBranch: { name: 'Main St', address: '1 Main St', phone: '+961 1 000 000' },
      owner: {
        displayName: 'Dr. Owner',
        email: overrides.email ?? uniqueEmail('owner'),
        temporaryPassword: 'temporary-pw-1',
      },
    };
  };
  const provision = (body: object) => admin.post('/api/v1/platform/tenants').send(body);
  const count = async (sql: string, params: unknown[]) =>
    Number((await database.ownerPool.query<{ n: string }>(sql, params)).rows[0]?.n);

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    admin = await signIn(testApp.app, await createPlatformAdmin(testApp.app), undefined, {
      rememberMe: true,
    });
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  it('creates the tenant with D8 defaults, its first branch and its organization mirror', async () => {
    const response = await provision(request());
    expect(response.status).toBe(201);
    const tenant = response.body as Tenant;
    expect(tenant).toMatchObject({
      status: 'active',
      timeZone: 'Asia/Beirut',
      currency: 'USD',
      locale: 'en',
    });

    const session = (await admin.get('/api/v1/session').set('X-Tenant-Id', tenant.id))
      .body as Session;
    expect(session.branches.map((branch) => branch.name)).toEqual(['Main St']);
    expect(
      await count('select count(*) as n from auth_organizations where id = $1 and slug = $2', [
        tenant.id,
        tenant.slug,
      ]),
    ).toBe(1);

    const audit = (await admin.get('/api/v1/audit').set('X-Tenant-Id', tenant.id))
      .body as AuditPage;
    expect(audit.items.filter((entry) => entry.action === 'TenantProvisioned')).toHaveLength(1);
    expect(audit.items.map((entry) => entry.action)).toContain('tenant.provision');
  });

  it('refuses a slug that is already taken and leaves nothing behind', async () => {
    const first = request();
    expect((await provision(first)).status).toBe(201);

    const clash = await provision(request({ slug: first.clinic.slug }));
    expect(clash.status).toBe(409);
    expect(clash.body).toMatchObject({ code: 'tenant.slug_taken' });
    expect(
      await count('select count(*) as n from tenants where slug = $1', [first.clinic.slug]),
    ).toBe(1);
  });

  it('refuses an owner email that already has an account', async () => {
    const email = await createPlatformAdmin(testApp.app);
    const response = await provision(request({ email }));
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: 'user.email_taken' });
  });

  it('discards the tenant when a later step fails', async () => {
    const body = request();
    // Occupy the organization slug so the mirror write fails inside the tenant transaction.
    await database.ownerPool.query(
      'insert into auth_organizations (id, name, slug) values ($1, $2, $3)',
      [newId(), 'Squatter', body.clinic.slug],
    );

    const response = await provision(body);
    expect(response.status).toBe(500);
    expect(
      await count('select count(*) as n from tenants where slug = $1', [body.clinic.slug]),
    ).toBe(0);
    expect(
      await count(
        'select count(*) as n from branches b left join tenants t on t.id = b.tenant_id where t.id is null',
        [],
      ),
    ).toBe(0);
  });

  it('lists tenants with branch and user counts, filtered by status and search', async () => {
    const body = request();
    const tenant = (await provision(body)).body as Tenant;

    const all = (await admin.get('/api/v1/platform/tenants')).body as PlatformTenant[];
    expect(all.find((row) => row.id === tenant.id)).toMatchObject({ branchCount: 1, userCount: 0 });

    const found = (await admin.get(`/api/v1/platform/tenants?search=${body.clinic.slug}`))
      .body as PlatformTenant[];
    expect(found.map((row) => row.id)).toEqual([tenant.id]);
    const suspended = (await admin.get('/api/v1/platform/tenants?status=suspended'))
      .body as PlatformTenant[];
    expect(suspended.map((row) => row.id)).not.toContain(tenant.id);
  });

  it('suspends and reactivates with a reason, both audited', async () => {
    const tenant = (await provision(request())).body as Tenant;

    const suspended = await admin
      .post('/api/v1/platform/tenants/suspend')
      .send({ tenantId: tenant.id, reason: 'Unpaid invoice' });
    expect(suspended.status).toBe(200);
    expect(suspended.body).toMatchObject({ status: 'suspended' });

    // Platform admins can still act inside a suspended clinic, e.g. to reactivate it.
    expect((await admin.get('/api/v1/tenant').set('X-Tenant-Id', tenant.id)).status).toBe(200);

    await admin
      .post('/api/v1/platform/tenants/reactivate')
      .send({ tenantId: tenant.id, reason: 'Paid' });
    const audit = (
      await admin.get(`/api/v1/audit?resourceId=${tenant.id}`).set('X-Tenant-Id', tenant.id)
    ).body as AuditPage;
    expect(audit.items.slice(0, 2)).toMatchObject([
      { action: 'tenant.reactivate', reason: 'Paid', actorPlatformAdmin: true },
      { action: 'tenant.suspend', reason: 'Unpaid invoice', after: { status: 'suspended' } },
    ]);
  });

  it('requires a reason of at least 3 characters and an existing tenant', async () => {
    const tenant = (await provision(request())).body as Tenant;
    expect(
      (
        await admin
          .post('/api/v1/platform/tenants/suspend')
          .send({ tenantId: tenant.id, reason: 'x' })
      ).status,
    ).toBe(400);
    expect(
      (
        await admin
          .post('/api/v1/platform/tenants/suspend')
          .send({ tenantId: newId(), reason: 'Unknown' })
      ).body,
    ).toMatchObject({ code: 'tenant.not_found' });
  });

  it('is closed to anonymous callers', async () => {
    const response = await browser(testApp.app).get('/api/v1/platform/tenants');
    expect(response.status).toBe(401);
  });
});
