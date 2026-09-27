import type { Branch, Session, StaffUser, Tenant } from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RolesService } from '../../src/modules/roles';
import { newId } from '../../src/platform/kernel/id';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import {
  createPlatformAdmin,
  PASSWORD,
  signIn,
  signInAndSetPassword,
  uniqueEmail,
} from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';
import { asPlatformAdminIn, createBareTenant } from '../support/tenants';

const TEMPORARY = 'temporary-pw-1';

/** The D5 front desk column. */
const FRONTDESK = [
  'tenant:read',
  'user:read',
  'patient:read',
  'patient:write',
  'visit:read',
  'catalog:read',
  'payment:read',
  'payment:write',
];

describe('session: role-based permissions, branch switch and password change', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let admin: TestAgent;
  let tenant: Tenant;
  let main: Branch;
  let north: Branch;
  let south: Branch;

  const inTenant = {
    post: (path: string, body: object) =>
      admin.post(`/api/v1${path}`).set('X-Tenant-Id', tenant.id).send(body),
    patch: (path: string, body: object) =>
      admin.patch(`/api/v1${path}`).set('X-Tenant-Id', tenant.id).send(body),
  };
  const createUser = async (roleKeys: string[], branchIds: string[]) => {
    const email = uniqueEmail('staff');
    const response = await inTenant.post('/users', {
      displayName: 'Jamie Ortiz',
      email,
      practitionerType: 'frontdesk',
      roleKeys,
      branchIds,
      temporaryPassword: TEMPORARY,
    });
    expect(response.status).toBe(201);
    return { email, user: response.body as StaffUser };
  };
  const sessionOf = async (agent: TestAgent) =>
    (await agent.get('/api/v1/session')).body as Session;

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    admin = await signIn(testApp.app, await createPlatformAdmin(testApp.app), undefined, {
      rememberMe: true,
    });
    tenant = await createBareTenant(testApp.app, 'Session Clinic');
    await asPlatformAdminIn(testApp.app, tenant.id, () =>
      testApp.app.get(RolesService).seedSystemRoles(),
    );
    main = (await inTenant.post('/branches', { name: 'Main St' })).body as Branch;
    north = (await inTenant.post('/branches', { name: 'North' })).body as Branch;
    south = (await inTenant.post('/branches', { name: 'South' })).body as Branch;
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  describe('pending temporary password', () => {
    it('allows only the session read until the password is changed', async () => {
      const { email } = await createUser(['frontdesk'], [main.id]);
      const agent = await signIn(testApp.app, email, TEMPORARY);

      expect((await sessionOf(agent)).mustChangePassword).toBe(true);
      const blocked = await agent.get('/api/v1/branches');
      expect(blocked.status).toBe(403);
      expect(blocked.body).toMatchObject({ code: 'auth.password_change_required' });
      expect((await agent.post('/api/v1/session/touch')).status).toBe(204);
    });

    it('checks the current password and refuses keeping the temporary one', async () => {
      const { email } = await createUser(['frontdesk'], [main.id]);
      const agent = await signIn(testApp.app, email, TEMPORARY);

      const wrong = await agent
        .post('/api/v1/session/password')
        .send({ currentPassword: 'not-the-temporary', newPassword: PASSWORD });
      expect(wrong.status).toBe(422);
      expect(wrong.body).toMatchObject({ code: 'auth.invalid_current_password' });

      const same = await agent
        .post('/api/v1/session/password')
        .send({ currentPassword: TEMPORARY, newPassword: TEMPORARY });
      expect(same.body).toMatchObject({ code: 'auth.password_unchanged' });

      const short = await agent
        .post('/api/v1/session/password')
        .send({ currentPassword: TEMPORARY, newPassword: 'short' });
      expect(short.status).toBe(400);
    });

    it('clears the flag, keeps this session and signs out the others', async () => {
      const { email, user } = await createUser(['frontdesk'], [main.id]);
      const other = await signIn(testApp.app, email, TEMPORARY);
      const agent = await signInAndSetPassword(testApp.app, email, TEMPORARY);

      expect((await sessionOf(agent)).mustChangePassword).toBe(false);
      expect((await agent.get('/api/v1/branches')).status).toBe(200);
      expect((await other.get('/api/v1/session')).status).toBe(401);
      await expect(signIn(testApp.app, email, TEMPORARY)).rejects.toThrow('sign-in failed');
      await signIn(testApp.app, email, PASSWORD);

      const audit = await database.ownerPool.query<{ action: string }>(
        'select action from audit_log where tenant_id = $1 and resource_id = $2',
        [tenant.id, user.id],
      );
      expect(audit.rows.map((row) => row.action)).toContain('user.password_change');
    });
  });

  describe('permissions by role', () => {
    it('gives front desk exactly its D5 permissions and refuses writes it lacks', async () => {
      const { email } = await createUser(['frontdesk'], [main.id]);
      const agent = await signInAndSetPassword(testApp.app, email, TEMPORARY);

      const session = await sessionOf(agent);
      expect([...session.permissions].sort()).toEqual([...FRONTDESK].sort());
      expect(session).toMatchObject({
        platformAdmin: false,
        roleNames: ['Front desk'],
        user: { displayName: 'Jamie Ortiz', email },
        tenant: { id: tenant.id, name: 'Session Clinic', country: 'LB' },
      });

      expect((await agent.get('/api/v1/branches')).status).toBe(200);
      const refused = await agent.post('/api/v1/branches').send({ name: 'Sneaky' });
      expect(refused.status).toBe(403);
      expect(refused.headers['content-type']).toContain('application/problem+json');
      expect(refused.body).toMatchObject({ code: 'forbidden' });
      expect((await agent.get('/api/v1/audit')).status).toBe(403);
    });

    it('follows role changes on the next request', async () => {
      const { email, user } = await createUser(['frontdesk'], [main.id]);
      const agent = await signInAndSetPassword(testApp.app, email, TEMPORARY);
      expect((await agent.get('/api/v1/users')).status).toBe(200);
      expect((await agent.get('/api/v1/roles')).status).toBe(403);

      await inTenant.patch(`/users/${user.id}`, { roleKeys: ['frontdesk', 'owner'] });
      expect((await agent.get('/api/v1/roles')).status).toBe(200);
      expect((await sessionOf(agent)).roleNames).toEqual(['Owner', 'Front desk']);
    });

    it('lets a platform admin outside a tenant hold only platform:admin', async () => {
      const session = await sessionOf(admin);
      expect(session).toMatchObject({ platformAdmin: true, tenant: null, roleNames: [] });
      expect(session.permissions).toEqual(['platform:admin']);
    });
  });

  describe('branch switch', () => {
    it('switches among assigned branches and remembers the choice', async () => {
      const { email } = await createUser(['dentist'], [main.id, north.id]);
      const agent = await signInAndSetPassword(testApp.app, email, TEMPORARY);

      const before = await sessionOf(agent);
      expect(before.branch).toEqual({ id: main.id, name: 'Main St' });
      expect(before.branches).toEqual([
        { id: main.id, name: 'Main St' },
        { id: north.id, name: 'North' },
      ]);

      expect((await agent.post('/api/v1/session/branch').send({ branchId: north.id })).status).toBe(
        204,
      );
      expect((await sessionOf(agent)).branch).toEqual({ id: north.id, name: 'North' });
      expect((await sessionOf(agent)).branch?.id).toBe(north.id);
    });

    it('refuses a branch the user is not assigned to', async () => {
      const { email } = await createUser(['dentist'], [main.id, north.id]);
      const agent = await signInAndSetPassword(testApp.app, email, TEMPORARY);

      for (const branchId of [south.id, newId()]) {
        const response = await agent.post('/api/v1/session/branch').send({ branchId });
        expect(response.status).toBe(403);
        expect(response.body).toMatchObject({ code: 'session.branch_not_assigned' });
      }
      expect((await sessionOf(agent)).branch?.id).toBe(main.id);
    });

    it('lets a platform admin pick any active branch inside the tenant', async () => {
      const response = await admin
        .post('/api/v1/session/branch')
        .set('X-Tenant-Id', tenant.id)
        .send({ branchId: south.id });
      expect(response.status).toBe(204);
      const session = (await admin.get('/api/v1/session').set('X-Tenant-Id', tenant.id))
        .body as Session;
      expect(session.branch?.id).toBe(south.id);

      const outside = await admin.post('/api/v1/session/branch').send({ branchId: south.id });
      expect(outside.body).toMatchObject({ code: 'session.branch_not_assigned' });
    });
  });
});
