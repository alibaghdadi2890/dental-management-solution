import type { Role, RoleTemplate, Tenant } from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RolesService } from '../../src/modules/roles';
import { RoleTemplatesService } from '../../src/modules/roles/application/role-templates.service';
import { systemRole } from '../../src/modules/roles/domain/system-roles';
import { ok, provisionClinic, type TestClinic } from '../support/clinic';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { createTestApp, type TestApp } from '../support/test-app';
import { asPlatformAdminIn, createBareTenant } from '../support/tenants';

const sorted = (values: readonly string[]) => [...values].sort();

/**
 * The platform's default roles (ADR-0056). They are global and test files run in parallel, so
 * nothing here changes what another file's new clinic would get: new extra templates start
 * switched off, a system template is only rewritten with what it holds, and what provisioning
 * reads is stubbed in this file's own app.
 */
describe('roles: the platform default roles (ADR-0056)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let clinic: TestClinic;
  let admin: TestAgent;

  const templates = () => ok<RoleTemplate[]>(admin.get('/api/v1/platform/role-templates'));
  const template = async (key: string) => {
    const found = (await templates()).find((candidate) => candidate.key === key);
    if (!found) throw new Error(`no template ${key}`);
    return found;
  };

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    clinic = await provisionClinic(testApp, 'Templates');
    admin = clinic.admin;
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  it('lists the system templates, seeded with the default matrix; owner is none', async () => {
    const listed = await templates();
    const system = listed.filter((candidate) => candidate.system);
    expect(system.map((candidate) => candidate.key)).toEqual(['dentist', 'assistant', 'frontdesk']);
    for (const candidate of system) {
      const key = candidate.key as 'dentist' | 'assistant' | 'frontdesk';
      expect(sorted(candidate.permissions)).toEqual(sorted(systemRole(key).permissions));
    }
  });

  it('is the platform admin’s alone, and only withoutTenant writes the tables', async () => {
    expect((await clinic.owner.get('/api/v1/platform/role-templates')).status).toBe(403);
    expect(
      (await clinic.owner.post('/api/v1/platform/role-templates').send({ name: 'Sneaky' })).status,
    ).toBe(403);
    await expect(
      database.appPool.query("update role_templates set name = 'x' where key = 'dentist'"),
    ).rejects.toThrow(/permission denied/);
    const read = await database.appPool.query('select count(*) from role_templates');
    expect(read.rowCount).toBe(1);
  });

  it('adds an extra default role switched off, edits it, and keeps a system one’s name', async () => {
    const created = await ok<RoleTemplate>(
      admin
        .post('/api/v1/platform/role-templates')
        .send({ name: 'Clinic manager', description: 'Runs the desk', copyFrom: 'frontdesk' }),
      201,
    );
    expect(created).toMatchObject({ system: false, active: false, name: 'Clinic manager' });
    expect(created.key).toMatch(/^custom_[0-9a-f]{8}$/);
    expect(sorted(created.permissions)).toEqual(sorted(systemRole('frontdesk').permissions));

    const edited = await ok<RoleTemplate>(
      admin
        .patch(`/api/v1/platform/role-templates/${created.id}`)
        .send({ permissions: [...created.permissions, 'finance:read'] }),
    );
    expect(edited.permissions).toContain('finance:read');

    const dentist = await template('dentist');
    const renamed = await admin
      .patch(`/api/v1/platform/role-templates/${dentist.id}`)
      .send({ name: 'Doctor' });
    expect(renamed.status).toBe(409);
    expect(
      (await admin.post(`/api/v1/platform/role-templates/${dentist.id}/deactivate`)).status,
    ).toBe(409);
    // Rewritten with what it holds: the route works, and no other test sees a change.
    const same = await ok<RoleTemplate>(
      admin
        .patch(`/api/v1/platform/role-templates/${dentist.id}`)
        .send({ permissions: dentist.permissions }),
    );
    expect(sorted(same.permissions)).toEqual(sorted(dentist.permissions));
  });

  it('creates a new clinic from the templates; Reset to default follows them', async () => {
    const service = testApp.app.get(RoleTemplatesService, { strict: false });
    const changed = (await templates()).map((candidate) =>
      candidate.key === 'dentist'
        ? { ...candidate, permissions: [...candidate.permissions, 'visit:read_all' as const] }
        : candidate,
    );
    const extra = (keyName: string, active: boolean): RoleTemplate => ({
      id: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c0000',
      key: keyName,
      name: keyName === 'custom_00aa11bb' ? 'Lab liaison' : 'Hidden',
      description: null,
      system: false,
      active,
      permissions: ['patient:read'],
    });
    const spy = vi
      .spyOn(service, 'forTenant')
      .mockResolvedValue([
        ...changed,
        extra('custom_00aa11bb', true),
        extra('custom_00cc22dd', false),
      ]);
    try {
      const tenant: Tenant = await createBareTenant(testApp.app, 'From Templates');
      await asPlatformAdminIn(testApp.app, tenant.id, () =>
        testApp.app.get(RolesService).seedSystemRoles(),
      );
      const roles = await asPlatformAdminIn(testApp.app, tenant.id, () =>
        testApp.app.get(RolesService).listRoles(),
      );
      expect(roles.find((role) => role.key === 'dentist')?.permissions).toContain('visit:read_all');
      expect(roles.find((role) => role.key === 'custom_00aa11bb')).toMatchObject({
        name: 'Lab liaison',
        system: false,
        permissions: ['patient:read'],
      });
      expect(roles.some((role) => role.key === 'custom_00cc22dd')).toBe(false);

      // The existing clinic is untouched until it resets, then gets the template.
      const before = (await ok<Role[]>(clinic.owner.get('/api/v1/roles'))).find(
        (role) => role.key === 'dentist',
      );
      if (!before) throw new Error('no dentist role');
      expect(before.permissions).not.toContain('visit:read_all');
      const reset = await ok<Role>(clinic.owner.post(`/api/v1/roles/${before.id}/reset`));
      expect(reset.permissions).toContain('visit:read_all');
    } finally {
      spy.mockRestore();
    }
  });
});
