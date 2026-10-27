import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AuditPage, Role, Tenant } from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RolesService } from '../../src/modules/roles';
import { systemRole } from '../../src/modules/roles/domain/system-roles';
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

  it('seeds the five system roles with the default matrix, once', async () => {
    const permissionRows = await rowCount(
      'select count(*) as n from role_permissions where tenant_id = $1',
    );
    await inTenant((service) => service.seedSystemRoles());
    expect(await rowCount('select count(*) as n from roles where tenant_id = $1')).toBe(5);
    expect(await rowCount('select count(*) as n from role_permissions where tenant_id = $1')).toBe(
      permissionRows,
    );

    const response = await admin.get('/api/v1/roles').set('X-Tenant-Id', tenant.id);
    expect(response.status).toBe(200);
    const listed = response.body as Role[];
    expect(listed.map((role) => [role.key, role.name, role.system])).toEqual([
      ['owner', 'Owner', true],
      ['admin', 'Admin', true],
      ['dentist', 'Dentist', true],
      ['assistant', 'Assistant', true],
      ['frontdesk', 'Front desk', true],
    ]);
    expect(listed.find((role) => role.key === 'owner')?.permissions).not.toContain(
      'platform:admin',
    );
    // The default matrix of ADR-0055, as seeded.
    for (const key of ['owner', 'admin', 'dentist', 'assistant', 'frontdesk'] as const) {
      expect([...(listed.find((role) => role.key === key)?.permissions ?? [])].sort()).toEqual(
        [...systemRole(key).permissions].sort(),
      );
    }

    const audit = (await admin.get('/api/v1/audit?resourceType=role').set('X-Tenant-Id', tenant.id))
      .body as AuditPage;
    expect(audit.items.filter((entry) => entry.action === 'role.create')).toHaveLength(5);
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

  it('rewrites the system roles to the 13a matrix and leaves custom data alone (migration 0050)', async () => {
    const listed = await inTenant((service) => service.listRoles());
    const idOf = (key: string) => {
      const found = listed.find((candidate) => candidate.key === key);
      if (!found) throw new Error(`no role ${key}`);
      return found.id;
    };
    const customId = newId();
    const holder = newId();
    // The rewrite touches every tenant: run it in a transaction that is rolled back, so test
    // files running in parallel never see it.
    const client = await database.ownerPool.connect();
    try {
      await client.query('begin');
      // A tenant as it was before 0050: the old (D5) matrix, plus a custom role and an assignment.
      await client.query(
        `delete from role_permissions where tenant_id = $1 and role_id = any($2::uuid[])`,
        [tenant.id, [idOf('dentist'), idOf('frontdesk')]],
      );
      await client.query(
        `insert into role_permissions (tenant_id, role_id, permission)
         select $1::uuid, $2::uuid, unnest($3::text[]) union all
         select $1::uuid, $4::uuid, unnest($5::text[])`,
        [
          tenant.id,
          idOf('dentist'),
          ['visit:read', 'visit:discount', 'payment:read', 'payment:write', 'payment:refund'],
          idOf('frontdesk'),
          ['visit:read', 'visit:discount', 'payment:read', 'payment:write'],
        ],
      );
      await client.query(
        `insert into roles (id, tenant_id, key, name, system) values ($1, $2, 'lab_tech', 'Lab', false)`,
        [customId, tenant.id],
      );
      await client.query(
        `insert into role_permissions (tenant_id, role_id, permission) values ($1, $2, 'payment:refund')`,
        [tenant.id, customId],
      );
      await client.query(
        `insert into user_roles (tenant_id, user_id, role_id) values ($1, $2, $3)`,
        [tenant.id, holder, customId],
      );

      const migration = readFileSync(
        resolve(__dirname, '../../migrations/0050_financial_access.sql'),
        'utf8',
      );
      const rewrite = migration
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter((statement) => /^(--[^\n]*\n)*(DELETE|INSERT)/.test(statement));
      expect(rewrite).toHaveLength(2);
      // Twice: it is idempotent.
      for (const statement of [...rewrite, ...rewrite]) await client.query(statement);

      const grantsOf = async (roleId: string) =>
        (
          await client.query<{ permission: string }>(
            'select permission from role_permissions where role_id = $1 order by permission',
            [roleId],
          )
        ).rows.map((row) => row.permission);
      const sorted = (values: readonly string[]) => [...values].sort();
      for (const key of ['owner', 'dentist', 'assistant', 'frontdesk'] as const) {
        expect(await grantsOf(idOf(key))).toEqual(sorted(systemRole(key).permissions));
      }
      expect(await grantsOf(customId)).toEqual(['payment:refund']);
      expect(
        (await client.query('select 1 from user_roles where user_id = $1', [holder])).rowCount,
      ).toBe(1);
    } finally {
      await client.query('rollback');
      client.release();
    }
  });

  it('gives an existing clinic the admin role with every permission, once (migration 0054)', async () => {
    const client = await database.ownerPool.connect();
    try {
      await client.query('begin');
      // A clinic as it was before 0054: no admin role.
      await client.query(`delete from roles where tenant_id = $1 and key = 'admin'`, [tenant.id]);

      const migration = readFileSync(
        resolve(__dirname, '../../migrations/0054_admin_role.sql'),
        'utf8',
      );
      const statements = migration
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim());
      expect(statements).toHaveLength(4);
      // Twice: it is idempotent.
      for (const statement of [...statements, ...statements]) await client.query(statement);

      const added = await client.query<{ id: string; name: string; system: boolean }>(
        `select id, name, system from roles where tenant_id = $1 and key = 'admin'`,
        [tenant.id],
      );
      expect(added.rows).toEqual([expect.objectContaining({ name: 'Admin', system: true })]);
      const granted = await client.query<{ permission: string }>(
        'select permission from role_permissions where role_id = $1 order by permission',
        [added.rows[0]?.id],
      );
      expect(granted.rows.map((row) => row.permission)).toEqual(
        [...systemRole('admin').permissions].sort(),
      );
      const template = await client.query<{ permission: string }>(
        `select permission from role_template_permissions
         join role_templates on role_templates.id = template_id
         where role_templates.key = 'admin' and role_templates.system
         order by permission`,
      );
      expect(template.rows.map((row) => row.permission)).toEqual(
        [...systemRole('admin').permissions].sort(),
      );
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});
