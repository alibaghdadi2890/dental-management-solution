import type { AuditPage, Branch, Room, Session, Tenant } from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../src/platform/kernel/id';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { createPlatformAdmin, signIn } from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';
import { createBareTenant } from '../support/tenants';

describe('tenancy: tenant settings, branches and rooms', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let admin: TestAgent;
  let tenant: Tenant;

  const api = {
    get: (path: string, tenantId = tenant.id) =>
      admin.get(`/api/v1${path}`).set('X-Tenant-Id', tenantId),
    post: (path: string, body: object, tenantId = tenant.id) =>
      admin.post(`/api/v1${path}`).set('X-Tenant-Id', tenantId).send(body),
    patch: (path: string, body: object, tenantId = tenant.id) =>
      admin.patch(`/api/v1${path}`).set('X-Tenant-Id', tenantId).send(body),
  };
  const auditOf = async (resourceId: string) =>
    ((await api.get(`/audit?resourceId=${resourceId}`)).body as AuditPage).items;

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    admin = await signIn(testApp.app, await createPlatformAdmin(testApp.app), undefined, {
      rememberMe: true,
    });
    tenant = await createBareTenant(testApp.app, 'Northgate Dental');
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  describe('tenant', () => {
    it('is only reachable inside a tenant context', async () => {
      expect((await admin.get('/api/v1/tenant')).body).toMatchObject({ code: 'forbidden' });
      const response = await api.get('/tenant');
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ id: tenant.id, name: 'Northgate Dental' });
    });

    it('answers 404 for an unknown or malformed X-Tenant-Id', async () => {
      expect((await api.get('/tenant', newId())).body).toMatchObject({ code: 'tenant.not_found' });
      expect((await api.get('/tenant', 'nope')).status).toBe(404);
    });

    it('updates validated settings and audits the change', async () => {
      expect((await api.patch('/tenant', { timeZone: 'Mars/Olympus' })).status).toBe(400);

      const response = await api.patch('/tenant', { timeZone: 'Europe/Paris', locale: 'fr' });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ timeZone: 'Europe/Paris', locale: 'fr' });

      const [entry] = await auditOf(tenant.id);
      expect(entry).toMatchObject({
        action: 'tenant.update',
        actorPlatformAdmin: true,
        before: { timeZone: 'Asia/Beirut' },
        after: { timeZone: 'Europe/Paris' },
      });
    });
  });

  describe('branches', () => {
    let main: Branch;

    it('creates a branch and audits it', async () => {
      const response = await api.post('/branches', { name: 'Main St', code: 'MS', phone: '' });
      expect(response.status).toBe(201);
      main = response.body as Branch;
      expect(main).toMatchObject({ name: 'Main St', code: 'MS', phone: null, active: true });

      const [entry] = await auditOf(main.id);
      expect(entry).toMatchObject({ action: 'branch.create', after: { name: 'Main St' } });
    });

    it('rejects duplicate names and codes, case-insensitively', async () => {
      expect((await api.post('/branches', { name: 'main st' })).body).toMatchObject({
        code: 'branch.name_taken',
      });
      expect((await api.post('/branches', { name: 'Other', code: 'ms' })).body).toMatchObject({
        code: 'branch.code_taken',
      });
    });

    it('deactivates instead of deleting, with before and after in the audit', async () => {
      const second = (await api.post('/branches', { name: 'Harbor' })).body as Branch;

      const response = await api.patch(`/branches/${second.id}`, { active: false });
      expect(response.body).toMatchObject({ id: second.id, active: false });

      const [entry] = await auditOf(second.id);
      expect(entry).toMatchObject({
        action: 'branch.update',
        before: { active: true },
        after: { active: false },
      });
      const listed = (await api.get('/branches')).body as Branch[];
      expect(listed.map((branch) => branch.name)).toEqual(['Main St', 'Harbor']);
    });

    it('answers 404 for a branch of another tenant', async () => {
      const other = await createBareTenant(testApp.app);
      const foreign = (await api.post('/branches', { name: 'Elsewhere' }, other.id)).body as Branch;

      const response = await api.patch(`/branches/${foreign.id}`, { name: 'Hijacked' });
      expect(response.status).toBe(404);
    });

    it('offers only active branches in the session, the first one active', async () => {
      const session = (await api.get('/session')).body as Session;
      expect(session.tenant).toMatchObject({ id: tenant.id, name: 'Northgate Dental' });
      expect(session.branches.map((branch) => branch.name)).toEqual(['Main St']);
      expect(session.branch).toEqual({ id: main.id, name: 'Main St' });
    });

    describe('rooms', () => {
      it('saves a batch atomically and lets rooms swap names', async () => {
        const created = await api.post('/rooms/batch', {
          items: [
            { branchId: main.id, name: 'Room A', code: 'A', active: true },
            { branchId: main.id, name: 'Room B', code: 'B', active: true },
          ],
        });
        expect(created.status).toBe(200);
        const [a, b] = created.body as Room[];

        const swapped = await api.post('/rooms/batch', {
          items: [
            { id: a!.id, branchId: main.id, name: 'Room B', code: 'B', active: true },
            { id: b!.id, branchId: main.id, name: 'Room A', code: 'A', active: false },
          ],
        });
        expect(swapped.status).toBe(200);

        const rooms = (await api.get(`/rooms?branchId=${main.id}`)).body as Room[];
        expect(rooms).toEqual([
          { id: a!.id, branchId: main.id, name: 'Room B', code: 'B', active: true },
          { id: b!.id, branchId: main.id, name: 'Room A', code: 'A', active: false },
        ]);
        expect((await auditOf(b!.id))[0]).toMatchObject({
          action: 'room.update',
          before: { name: 'Room B', active: true },
          after: { name: 'Room A', active: false },
        });
      });

      it('rejects duplicates and rolls back the whole batch', async () => {
        const response = await api.post('/rooms/batch', {
          items: [
            { branchId: main.id, name: 'Room C', active: true },
            { branchId: main.id, name: 'room a', active: true },
          ],
        });
        expect(response.status).toBe(409);
        expect(response.body).toMatchObject({ code: 'room.name_taken' });

        const names = ((await api.get(`/rooms?branchId=${main.id}`)).body as Room[]).map(
          (room) => room.name,
        );
        expect(names).not.toContain('Room C');
      });

      it('refuses unknown branches and moves between branches', async () => {
        expect(
          (
            await api.post('/rooms/batch', {
              items: [{ branchId: newId(), name: 'X', active: true }],
            })
          ).body,
        ).toMatchObject({ code: 'branch.not_found' });

        const [room] = (await api.get(`/rooms?branchId=${main.id}`)).body as Room[];
        const other = (await api.post('/branches', { name: 'Uptown' })).body as Branch;
        const moved = await api.post('/rooms/batch', {
          items: [{ id: room!.id, branchId: other.id, name: room!.name, active: true }],
        });
        expect(moved.status).toBe(422);
        expect(moved.body).toMatchObject({ code: 'room.branch_change' });
      });
    });
  });
});
