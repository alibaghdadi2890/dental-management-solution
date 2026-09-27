import type { AuditPage, Branch, Practitioner, Session, StaffUser, Tenant } from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RolesService } from '../../src/modules/roles';
import { UsersService } from '../../src/modules/users';
import { newId } from '../../src/platform/kernel/id';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import {
  browser,
  createPlatformAdmin,
  signIn,
  signInAndSetPassword,
  uniqueEmail,
} from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';
import { asPlatformAdminIn, createBareTenant } from '../support/tenants';

const TEMPORARY = 'temporary-pw-1';

describe('users: staff profiles with identity, branches and roles', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let admin: TestAgent;
  let tenant: Tenant;
  let main: Branch;
  let north: Branch;

  const api = {
    get: (path: string) => admin.get(`/api/v1${path}`).set('X-Tenant-Id', tenant.id),
    post: (path: string, body: object = {}) =>
      admin.post(`/api/v1${path}`).set('X-Tenant-Id', tenant.id).send(body),
    patch: (path: string, body: object) =>
      admin.patch(`/api/v1${path}`).set('X-Tenant-Id', tenant.id).send(body),
  };
  const staff = (overrides: Record<string, unknown> = {}) => ({
    displayName: 'Dr. Ana Reyes',
    email: uniqueEmail('staff'),
    practitionerType: 'dentist',
    roleKeys: ['dentist'],
    branchIds: [main.id],
    temporaryPassword: TEMPORARY,
    ...overrides,
  });
  const createUser = async (overrides: Record<string, unknown> = {}) => {
    const response = await api.post('/users', staff(overrides));
    expect(response.status).toBe(201);
    return response.body as StaffUser;
  };
  const count = async (sql: string, params: unknown[]) =>
    Number((await database.ownerPool.query<{ n: string }>(sql, params)).rows[0]?.n);
  const auditOf = async (resourceId: string) =>
    ((await api.get(`/audit?resourceId=${resourceId}`)).body as AuditPage).items;

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    admin = await signIn(testApp.app, await createPlatformAdmin(testApp.app), undefined, {
      rememberMe: true,
    });
    tenant = await createBareTenant(testApp.app, 'Staff Clinic');
    await asPlatformAdminIn(testApp.app, tenant.id, () =>
      testApp.app.get(RolesService).seedSystemRoles(),
    );
    main = (await api.post('/branches', { name: 'Main St' })).body as Branch;
    north = (await api.post('/branches', { name: 'North' })).body as Branch;
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  it('creates identity, membership mirror, profile, branches and roles together', async () => {
    const body = staff({ branchIds: [main.id, north.id], title: 'Orthodontist' });
    const user = await createUser(body);
    expect(user).toMatchObject({
      email: body.email,
      displayName: 'Dr. Ana Reyes',
      title: 'Orthodontist',
      practitionerType: 'dentist',
      phone: null,
      active: true,
      roles: [{ key: 'dentist', name: 'Dentist' }],
      branches: [
        { id: main.id, name: 'Main St' },
        { id: north.id, name: 'North' },
      ],
    });
    expect(
      await count(
        'select count(*) as n from auth_members where organization_id = $1 and user_id = $2',
        [tenant.id, user.id],
      ),
    ).toBe(1);
    expect(
      await count('select count(*) as n from auth_team_members where user_id = $1', [user.id]),
    ).toBe(2);

    expect((await api.get(`/users/${user.id}`)).body).toEqual(user);
    expect(((await api.get('/users')).body as StaffUser[]).map((row) => row.id)).toContain(user.id);

    const agent = await signIn(testApp.app, body.email, TEMPORARY);
    const session = (await agent.get('/api/v1/session')).body as Session;
    expect(session).toMatchObject({
      mustChangePassword: true,
      tenant: { id: tenant.id },
      branch: { id: main.id, name: 'Main St' },
    });
    expect(session.user.displayName).toBe('Dr. Ana Reyes');
  });

  it('rolls the identity back when assigning roles fails', async () => {
    const body = staff({ roleKeys: ['dentist', 'janitor'] });
    const response = await api.post('/users', body);
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: 'role.unknown' });
    expect(await count('select count(*) as n from auth_users where email = $1', [body.email])).toBe(
      0,
    );
    expect(
      await count('select count(*) as n from staff_profiles where tenant_id = $1', [tenant.id]),
    ).toBe(((await api.get('/users')).body as StaffUser[]).length);
  });

  it('refuses a registered email in any case, and branches of no one', async () => {
    const user = await createUser();
    const taken = await api.post('/users', staff({ email: user.email.toUpperCase() }));
    expect(taken.status).toBe(409);
    expect(taken.body).toMatchObject({ code: 'user.email_taken' });

    const unknown = await api.post('/users', staff({ branchIds: [newId()] }));
    expect(unknown.status).toBe(422);
    expect(unknown.body).toMatchObject({ code: 'user.unknown_branch' });
  });

  it('updates profile, roles and branches and re-syncs the membership mirror', async () => {
    const user = await createUser({ branchIds: [main.id, north.id] });
    const response = await api.patch(`/users/${user.id}`, {
      title: 'Hygienist',
      practitionerType: 'assistant',
      roleKeys: ['assistant', 'frontdesk'],
      branchIds: [north.id],
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      title: 'Hygienist',
      practitionerType: 'assistant',
      roles: [
        { key: 'assistant', name: 'Assistant' },
        { key: 'frontdesk', name: 'Front desk' },
      ],
      branches: [{ id: north.id, name: 'North' }],
    });
    const teams = await database.ownerPool.query<{ team_id: string }>(
      'select team_id from auth_team_members where user_id = $1',
      [user.id],
    );
    expect(teams.rows).toEqual([{ team_id: north.id }]);

    const [latest] = await auditOf(user.id);
    expect(latest).toMatchObject({
      action: 'user.update',
      before: { title: null, branches: [{ id: main.id }, { id: north.id }] },
      after: { title: 'Hygienist', branches: [{ id: north.id }] },
    });
  });

  it('deactivates (ban, sessions revoked, membership removed) and reactivates', async () => {
    const body = staff();
    const user = await createUser(body);
    const agent = await signIn(testApp.app, body.email, TEMPORARY);

    const deactivated = await api.post(`/users/${user.id}/deactivate`, {
      reason: 'Left the clinic',
    });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body).toMatchObject({ active: false });
    expect((await agent.get('/api/v1/session')).status).toBe(401);
    const refused = await browser(testApp.app)
      .post('/api/v1/auth/sign-in/email')
      .send({ email: body.email, password: TEMPORARY });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ code: 'auth.account_deactivated' });
    expect(
      await count('select count(*) as n from auth_members where user_id = $1', [user.id]),
    ).toBe(0);

    const actions = (await auditOf(user.id)).map((entry) => [entry.action, entry.reason]);
    expect(actions).toContainEqual(['user.deactivate', 'Left the clinic']);
    const events = ((await api.get('/audit?resourceType=event')).body as AuditPage).items;
    expect(
      events.some(
        (entry) =>
          entry.action === 'MemberRemoved' &&
          (entry.after as { userId?: string }).userId === user.id,
      ),
    ).toBe(true);

    const reactivated = await api.post(`/users/${user.id}/reactivate`, { reason: 'Came back' });
    expect(reactivated.body).toMatchObject({ active: true, branches: [{ id: main.id }] });
    const again = await signIn(testApp.app, body.email, TEMPORARY);
    expect(((await again.get('/api/v1/session')).body as Session).branch?.id).toBe(main.id);
  });

  it('resets the password to a new temporary one and signs the user out', async () => {
    const body = staff();
    const user = await createUser(body);
    const agent = await signIn(testApp.app, body.email, TEMPORARY);

    const reset = await api.post(`/users/${user.id}/reset-password`, {
      temporaryPassword: 'another-temp-2',
    });
    expect(reset.status).toBe(204);
    expect((await agent.get('/api/v1/session')).status).toBe(401);
    await expect(signIn(testApp.app, body.email, TEMPORARY)).rejects.toThrow('sign-in failed');
    const fresh = await signIn(testApp.app, body.email, 'another-temp-2');
    expect(((await fresh.get('/api/v1/session')).body as Session).mustChangePassword).toBe(true);
    expect((await auditOf(user.id))[0]).toMatchObject({ action: 'user.reset_password' });
  });

  it('never writes a password to the audit log', async () => {
    expect(
      await count(
        `select count(*) as n from audit_log
         where tenant_id = $1 and (coalesce(before::text, '') || coalesce(after::text, '')) ~ $2`,
        [tenant.id, `${TEMPORARY}|another-temp-2|password`],
      ),
    ).toBe(0);
  });

  it('keeps at least one active owner', async () => {
    const owners = await asPlatformAdminIn(testApp.app, tenant.id, () =>
      testApp.app.get(RolesService).holdersOf('owner'),
    );
    expect(owners).toEqual([]);
    const first = await createUser({ roleKeys: ['owner'] });

    const deactivate = await api.post(`/users/${first.id}/deactivate`, { reason: 'Leaving' });
    expect(deactivate.status).toBe(409);
    expect(deactivate.body).toMatchObject({ code: 'user.last_owner' });
    const demote = await api.patch(`/users/${first.id}`, { roleKeys: ['dentist'] });
    expect(demote.body).toMatchObject({ code: 'user.last_owner' });

    await createUser({ roleKeys: ['owner', 'dentist'] });
    expect((await api.post(`/users/${first.id}/deactivate`, { reason: 'Leaving' })).status).toBe(
      200,
    );
  });

  describe('practitioners', () => {
    const relevant = (ids: string[], list: Practitioner[]) =>
      list.filter((row) => ids.includes(row.userId)).map((row) => row.userId);

    it('orders by display name using the tenant locale collation, then by user id for a tie', async () => {
      const zed = await createUser({ displayName: 'Dr. Zed' });
      const amir = await createUser({ displayName: 'dr. amir' });
      const emile = await createUser({ displayName: 'Dr. Émile' });

      const list = (await api.get('/users/practitioners')).body as Practitioner[];
      expect(relevant([amir.id, emile.id, zed.id], list)).toEqual([amir.id, emile.id, zed.id]);

      // Two dentists with the exact same display name tie-break on user id, ascending.
      const [first, second] = await Promise.all([
        createUser({ displayName: 'Dr. Ana Reyes' }),
        createUser({ displayName: 'Dr. Ana Reyes' }),
      ]);
      const [expectedFirst, expectedSecond]: [StaffUser, StaffUser] =
        first.id < second.id ? [first, second] : [second, first];
      const withTwins = (await api.get('/users/practitioners')).body as Practitioner[];
      expect(relevant([expectedFirst.id, expectedSecond.id], withTwins)).toEqual([
        expectedFirst.id,
        expectedSecond.id,
      ]);
    });

    it('lists only active dentists; a deactivated one is absent but still found by id', async () => {
      const zed = await createUser({ displayName: 'Dr. Zed Nassar' });
      const amir = await createUser({ displayName: 'Dr. Amir Haddad' });
      const assistant = await createUser({
        displayName: 'Nour Aziz',
        practitionerType: 'assistant',
        roleKeys: ['assistant'],
      });

      const before = (await api.get('/users/practitioners')).body as Practitioner[];
      expect(before.map((row) => row.userId)).toEqual(expect.arrayContaining([zed.id, amir.id]));
      expect(before.map((row) => row.userId)).not.toContain(assistant.id);

      expect(
        (await api.post(`/users/${zed.id}/deactivate`, { reason: 'Left the clinic' })).status,
      ).toBe(200);
      const after = (await api.get('/users/practitioners')).body as Practitioner[];
      expect(after.map((row) => row.userId)).not.toContain(zed.id);
      expect(after.map((row) => row.userId)).toContain(amir.id);

      const byIds = await asPlatformAdminIn(testApp.app, tenant.id, () =>
        testApp.app.get(UsersService).practitionersByIds([zed.id, amir.id]),
      );
      expect(byIds.map((row) => row.userId).sort()).toEqual([zed.id, amir.id].sort());
      expect(byIds.find((row) => row.userId === zed.id)).toMatchObject({
        displayName: 'Dr. Zed Nassar',
      });
    });

    it('is reachable by front desk (user:read, not a privileged read)', async () => {
      const body = staff({
        displayName: 'Jamie Ortiz',
        practitionerType: 'frontdesk',
        roleKeys: ['frontdesk'],
      });
      await createUser(body);
      const agent = await signInAndSetPassword(testApp.app, body.email, TEMPORARY);
      expect((await agent.get('/api/v1/users/practitioners')).status).toBe(200);
    });
  });

  it('answers 404 for users of no one', async () => {
    expect((await api.get(`/users/${newId()}`)).body).toMatchObject({ code: 'user.not_found' });
    expect(
      (await api.post(`/users/${newId()}/reset-password`, { temporaryPassword: TEMPORARY })).status,
    ).toBe(404);
  });
});
