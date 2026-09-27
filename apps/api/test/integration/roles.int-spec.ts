import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AuditPage, Role, Tenant } from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RolesService } from '../../src/modules/roles';
import { toProblemDetails } from '../../src/platform/errors/problem-details';
import { newId } from '../../src/platform/kernel/id';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { createPlatformAdmin, signIn } from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';
import { asPlatformAdminIn, createBareTenant } from '../support/tenants';

describe('roles: system roles, assignments and permission lookup', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let admin: TestAgent;
  let tenant: Tenant;

  const roles = () => testApp.app.get(RolesService);
  const inTenant = <T>(fn: (service: RolesService) => Promise<T>) =>
    asPlatformAdminIn(testApp.app, tenant.id, () => fn(roles()));
  const rowCount = async (sql: string) =>
    Number(
      (await database.ownerPool.query<{ n: string }>(sql, [tenant.id])).rows[0]?.n ?? Number.NaN,
    );

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    admin = await signIn(testApp.app, await createPlatformAdmin(testApp.app), undefined, {
      rememberMe: true,
    });
    tenant = await createBareTenant(testApp.app, 'Roles Clinic');
    await inTenant((service) => service.seedSystemRoles());
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  it('seeds the four system roles with the D5 matrix, once', async () => {
    const permissionRows = await rowCount(
      'select count(*) as n from role_permissions where tenant_id = $1',
    );
    await inTenant((service) => service.seedSystemRoles());
    expect(await rowCount('select count(*) as n from roles where tenant_id = $1')).toBe(4);
    expect(await rowCount('select count(*) as n from role_permissions where tenant_id = $1')).toBe(
      permissionRows,
    );

    const response = await admin.get('/api/v1/roles').set('X-Tenant-Id', tenant.id);
    expect(response.status).toBe(200);
    const listed = response.body as Role[];
    expect(listed.map((role) => [role.key, role.name, role.system])).toEqual([
      ['owner', 'Owner', true],
      ['dentist', 'Dentist', true],
      ['assistant', 'Assistant', true],
      ['frontdesk', 'Front desk', true],
    ]);
    expect(listed.find((role) => role.key === 'owner')?.permissions).not.toContain(
      'platform:admin',
    );

    const audit = (await admin.get('/api/v1/audit?resourceType=role').set('X-Tenant-Id', tenant.id))
      .body as AuditPage;
    expect(audit.items.filter((entry) => entry.action === 'role.create')).toHaveLength(4);
  });

  it('replaces the role set of a user and unions their permissions', async () => {
    const userId = newId();
    await inTenant((service) => service.assignRoles(userId, ['frontdesk', 'assistant']));
    const both = await inTenant((service) => service.permissionsForUser(userId));
    expect(both).toContain('visit:write'); // assistant only
    expect(both).toContain('payment:write'); // frontdesk only
    expect(both).not.toContain('tenant:write');

    await inTenant((service) => service.assignRoles(userId, ['frontdesk']));
    const frontdesk = await inTenant((service) => service.permissionsForUser(userId));
    expect(frontdesk).not.toContain('visit:write');
    const assigned = await inTenant((service) => service.rolesFor([userId]));
    expect(assigned.get(userId)).toEqual([{ key: 'frontdesk', name: 'Front desk' }]);

    const audit = (
      await admin.get(`/api/v1/audit?resourceId=${userId}`).set('X-Tenant-Id', tenant.id)
    ).body as AuditPage;
    expect(audit.items[0]).toMatchObject({
      action: 'user.roles_assign',
      before: { roles: ['assistant', 'frontdesk'] },
      after: { roles: ['frontdesk'] },
    });
  });

  it('refuses unknown role keys with 422 role.unknown and changes nothing', async () => {
    const userId = newId();
    await inTenant((service) => service.assignRoles(userId, ['dentist']));
    const attempt = inTenant((service) => service.assignRoles(userId, ['dentist', 'janitor']));
    await expect(attempt).rejects.toMatchObject({ code: 'role.unknown' });
    expect(toProblemDetails(await attempt.catch((error: unknown) => error)).status).toBe(422);
    expect((await inTenant((service) => service.rolesFor([userId]))).get(userId)).toEqual([
      { key: 'dentist', name: 'Dentist' },
    ]);
  });

  it('lists the holders of a role', async () => {
    const owner = newId();
    await inTenant((service) => service.assignRoles(owner, ['owner', 'dentist']));
    expect(await inTenant((service) => service.holdersOf('owner'))).toContain(owner);
    expect(await inTenant((service) => service.holdersOf('frontdesk'))).not.toContain(owner);
  });

  it('keeps each tenant to its own roles', async () => {
    const other = await createBareTenant(testApp.app, 'Other Clinic');
    const listed = (await admin.get('/api/v1/roles').set('X-Tenant-Id', other.id)).body as Role[];
    expect(listed).toEqual([]);
  });

  it('renames stored procedure:* grants to catalog:* (migration 0006)', async () => {
    const owner = (await inTenant((service) => service.listRoles())).find(
      (role) => role.key === 'owner',
    );
    if (!owner) throw new Error('owner role missing');
    // A tenant provisioned before the rename holds the old permission text.
    await database.ownerPool.query(
      "delete from role_permissions where role_id = $1 and permission like 'catalog:%'",
      [owner.id],
    );
    await database.ownerPool.query(
      `insert into role_permissions (tenant_id, role_id, permission)
       values ($1, $2, 'procedure:read'), ($1, $2, 'procedure:write')`,
      [tenant.id, owner.id],
    );

    await database.ownerPool.query(
      readFileSync(resolve(__dirname, '../../migrations/0006_catalog_permissions.sql'), 'utf8'),
    );

    const permissions = (await inTenant((service) => service.listRoles())).find(
      (role) => role.key === 'owner',
    )?.permissions;
    expect(permissions).toEqual(expect.arrayContaining(['catalog:read', 'catalog:write']));
    expect(
      await rowCount(
        "select count(*) as n from role_permissions where tenant_id = $1 and permission like 'procedure:%'",
      ),
    ).toBe(0);
  });
});
