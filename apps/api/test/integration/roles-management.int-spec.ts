import type { AuditPage, Role, Session, StaffUser } from '@dcm/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ok, provisionClinic, type StaffMember, type TestClinic } from '../support/clinic';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { createTestApp, type TestApp } from '../support/test-app';

describe('roles: custom roles, per-user grants and their rules (ADR-0055)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let clinic: TestClinic;
  let dentist: StaffMember;

  const roles = () => ok<Role[]>(clinic.owner.get('/api/v1/roles'));
  const role = async (key: string) => {
    const found = (await roles()).find((candidate) => candidate.key === key);
    if (!found) throw new Error(`no role ${key}`);
    return found;
  };
  const session = (member: StaffMember) => ok<Session>(member.agent.get('/api/v1/session'));

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    clinic = await provisionClinic(testApp, 'Roles Mgmt');
    dentist = await clinic.staff(['dentist'], 'Dr Grant');
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  it('lists roles with description, active and holders; the owner role is locked', async () => {
    const listed = await roles();
    expect(listed.map((item) => [item.key, item.system, item.active])).toEqual([
      ['owner', true, true],
      ['admin', true, true],
      ['dentist', true, true],
      ['assistant', true, true],
      ['frontdesk', true, true],
    ]);
    expect((await role('dentist')).holders).toBe(1);
    const owner = await role('owner');
    const locked = await clinic.owner
      .patch(`/api/v1/roles/${owner.id}`)
      .send({ permissions: ['patient:read'] });
    expect(locked.status).toBe(409);
    expect(locked.body).toMatchObject({ code: 'role.owner_locked' });
  });

  it('edits a system role, closes implies, applies on the next request and resets', async () => {
    const frontdesk = await role('frontdesk');
    const desk = await clinic.staff(['frontdesk'], 'Desk One', 'frontdesk');
    expect((await session(desk)).permissions).not.toContain('visit:discount');

    const edited = await ok<Role>(
      clinic.owner
        .patch(`/api/v1/roles/${frontdesk.id}`)
        .send({ permissions: [...frontdesk.permissions, 'visit:discount', 'finance:read'] }),
    );
    expect(edited.permissions).toEqual(expect.arrayContaining(['visit:discount', 'finance:read']));
    expect((await session(desk)).permissions).toContain('visit:discount');

    const reset = await ok<Role>(clinic.owner.post(`/api/v1/roles/${frontdesk.id}/reset`));
    expect(reset.permissions).not.toContain('visit:discount');
    expect((await session(desk)).permissions).not.toContain('visit:discount');

    const audit = await ok<AuditPage>(
      clinic.owner.get(`/api/v1/audit?resourceType=role&resourceId=${frontdesk.id}`),
    );
    expect(audit.items.map((entry) => entry.action)).toEqual([
      'role.reset',
      'role.update',
      'role.create',
    ]);
    expect(audit.items[1]?.after).toMatchObject({
      permissions: expect.arrayContaining(['visit:discount']) as unknown,
    });
  });

  it('creates a custom role from a copy, assigns it, and refuses deactivating it while held', async () => {
    const manager = await ok<Role>(
      clinic.owner
        .post('/api/v1/roles')
        .send({ name: 'Clinic manager', description: 'Runs the desk', copyFrom: 'frontdesk' }),
      201,
    );
    expect(manager).toMatchObject({ system: false, active: true, holders: 0 });
    expect(manager.key).toMatch(/^custom_[0-9a-f]{8}$/);
    const withFinance = await ok<Role>(
      clinic.owner
        .patch(`/api/v1/roles/${manager.id}`)
        .send({ permissions: [...manager.permissions, 'finance:read'] }),
    );
    expect(withFinance.permissions).toContain('finance:read');

    const member = await clinic.staff([manager.key], 'Manager One', 'frontdesk');
    expect((await session(member)).permissions).toContain('finance:read');
    await ok(member.agent.get('/api/v1/billing/aging'));

    const refused = await clinic.owner.post(`/api/v1/roles/${manager.id}/deactivate`);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'role.has_holders', holders: 1 });

    const empty = await ok<Role>(
      clinic.owner.post('/api/v1/roles').send({ name: 'Unused role' }),
      201,
    );
    const off = await ok<Role>(clinic.owner.post(`/api/v1/roles/${empty.id}/deactivate`));
    expect(off.active).toBe(false);
    const assignInactive = await clinic.owner
      .patch(`/api/v1/users/${member.user.id}`)
      .send({ roleKeys: [empty.key] });
    expect(assignInactive.status).toBe(422);
  });

  it('grants a user extra permissions: closed under implies, effective next request, audited', async () => {
    const before = await ok<StaffUser>(clinic.owner.get(`/api/v1/users/${dentist.user.id}`));
    expect(before.grants).toEqual([]);
    expect(before.effectivePermissions).not.toContain('payment:read');

    const after = await ok<StaffUser>(
      clinic.owner
        .put(`/api/v1/users/${dentist.user.id}/grants`)
        .send({ permissions: ['visit:read_all', 'payment:write'] }),
    );
    expect(after.grants).toEqual(['visit:read', 'visit:read_all', 'payment:read', 'payment:write']);
    expect(after.effectivePermissions).toEqual(expect.arrayContaining(['payment:read']));
    expect((await session(dentist)).permissions).toEqual(
      expect.arrayContaining(['visit:read_all', 'payment:read', 'payment:write']),
    );

    // Without role:read, the access fields stay hidden.
    const seenByDentist = await ok<StaffUser[]>(dentist.agent.get('/api/v1/users'));
    expect(seenByDentist.every((user) => user.grants === null)).toBe(true);

    const audit = await ok<AuditPage>(
      clinic.owner.get(`/api/v1/audit?resourceType=user&resourceId=${dentist.user.id}`),
    );
    expect(audit.items[0]).toMatchObject({
      action: 'user.grants_update',
      before: { grants: [] },
      after: { grants: ['visit:read', 'visit:read_all', 'payment:read', 'payment:write'] },
    });

    await ok(clinic.owner.put(`/api/v1/users/${dentist.user.id}/grants`).send({ permissions: [] }));
    expect((await session(dentist)).permissions).not.toContain('payment:read');
  });

  it('only lets an editor give what they hold, by role edit, grant or assignment', async () => {
    const admins = await ok<Role>(
      clinic.owner.post('/api/v1/roles').send({ name: 'Staff admin' }),
      201,
    );
    await ok(
      clinic.owner
        .patch(`/api/v1/roles/${admins.id}`)
        .send({ permissions: ['role:write', 'user:write', 'payment:read'] }),
    );
    const editor = await clinic.staff([admins.key], 'Staff Admin', 'other');
    const frontdesk = await role('frontdesk');
    // Someone the editor may manage: they hold nothing the editor lacks.
    const bare = await ok<Role>(clinic.owner.post('/api/v1/roles').send({ name: 'Newcomer' }), 201);
    const newcomer = await clinic.staff([bare.key], 'New Comer', 'other');

    const byRole = await editor.agent
      .patch(`/api/v1/roles/${frontdesk.id}`)
      .send({ permissions: [...frontdesk.permissions, 'finance:read'] });
    expect(byRole.status).toBe(403);
    expect(byRole.body).toMatchObject({ code: 'role.cannot_grant', permission: 'finance:read' });

    const byGrant = await editor.agent
      .put(`/api/v1/users/${newcomer.user.id}/grants`)
      .send({ permissions: ['finance:read'] });
    expect(byGrant.body).toMatchObject({ code: 'role.cannot_grant', permission: 'finance:read' });

    await ok(
      editor.agent
        .put(`/api/v1/users/${newcomer.user.id}/grants`)
        .send({ permissions: ['payment:read'] }),
    );

    const byAssignment = await editor.agent
      .patch(`/api/v1/users/${newcomer.user.id}`)
      .send({ roleKeys: ['frontdesk'] });
    expect(byAssignment.status).toBe(403);
    expect(byAssignment.body).toMatchObject({ code: 'role.cannot_grant' });

    const owner = await editor.agent
      .patch(`/api/v1/users/${newcomer.user.id}`)
      .send({ roleKeys: ['owner'] });
    expect(owner.body).toMatchObject({ code: 'role.cannot_grant', permission: 'owner' });
  });

  it('keeps a staff manager from taking over whoever holds more: password, status, owner role', async () => {
    const managers = await ok<Role>(
      clinic.owner.post('/api/v1/roles').send({ name: 'Staff manager' }),
      201,
    );
    await ok(
      clinic.owner
        .patch(`/api/v1/roles/${managers.id}`)
        .send({ permissions: ['role:write', 'user:write', 'patient:read'] }),
    );
    const manager = await clinic.staff([managers.key], 'Staff Manager', 'other');
    const coOwner = await clinic.staff(['owner'], 'Co Owner', 'other');

    const reset = await manager.agent
      .post(`/api/v1/users/${coOwner.user.id}/reset-password`)
      .send({ temporaryPassword: 'taken-over-pw-1' });
    expect(reset.status).toBe(403);
    expect(reset.body).toMatchObject({ code: 'role.cannot_manage' });
    const deactivate = await manager.agent
      .post(`/api/v1/users/${coOwner.user.id}/deactivate`)
      .send({ reason: 'Taking over' });
    expect(deactivate.body).toMatchObject({ code: 'role.cannot_manage' });
    const demote = await manager.agent
      .patch(`/api/v1/users/${coOwner.user.id}`)
      .send({ roleKeys: [managers.key] });
    expect(demote.status).toBe(403);

    // Nor by narrowing a role they hold: the dentist role's holder holds more than the manager.
    const dentistRole = await role('dentist');
    const narrow = await manager.agent
      .patch(`/api/v1/roles/${dentistRole.id}`)
      .send({ permissions: dentistRole.permissions.filter((key) => key !== 'file:archive') });
    expect(narrow.status).toBe(403);
    expect(narrow.body).toMatchObject({ code: 'role.cannot_manage' });
    await ok(
      clinic.owner
        .patch(`/api/v1/roles/${dentistRole.id}`)
        .send({ permissions: [...dentistRole.permissions, 'finance:read'] }),
    );
    const resetNarrows = await manager.agent.post(`/api/v1/roles/${dentistRole.id}/reset`);
    expect(resetNarrows.body).toMatchObject({ code: 'role.cannot_manage' });
    await ok(clinic.owner.post(`/api/v1/roles/${dentistRole.id}/reset`));

    // Someone who holds no more than the manager can be managed.
    const clerk = await clinic.staff([managers.key], 'Clerk', 'other');
    expect(
      (
        await manager.agent
          .post(`/api/v1/users/${clerk.user.id}/reset-password`)
          .send({ temporaryPassword: 'clerk-new-pw-1' })
      ).status,
    ).toBe(204);
  });

  it('refuses a change that takes away the caller’s own role:write or user:write', async () => {
    const admins = await ok<Role>(
      clinic.owner.post('/api/v1/roles').send({ name: 'Self admin' }),
      201,
    );
    await ok(
      clinic.owner
        .patch(`/api/v1/roles/${admins.id}`)
        .send({ permissions: ['role:write', 'user:write'] }),
    );
    const editor = await clinic.staff([admins.key], 'Self Admin', 'other');

    const byRoleEdit = await editor.agent
      .patch(`/api/v1/roles/${admins.id}`)
      .send({ permissions: ['user:write'] });
    expect(byRoleEdit.status).toBe(409);
    expect(byRoleEdit.body).toMatchObject({ code: 'role.self_lockout', permission: 'role:write' });

    const bare = await ok<Role>(clinic.owner.post('/api/v1/roles').send({ name: 'Bare' }), 201);
    const byRemoval = await editor.agent
      .patch(`/api/v1/users/${editor.user.id}`)
      .send({ roleKeys: [bare.key] });
    expect(byRemoval.status).toBe(409);
    expect(byRemoval.body).toMatchObject({ code: 'role.self_lockout' });

    // A grant the caller holds role:write by: revoking it is a lockout too.
    const granted = await clinic.staff([bare.key], 'Granted Admin', 'other');
    await ok(
      clinic.owner
        .put(`/api/v1/users/${granted.user.id}/grants`)
        .send({ permissions: ['role:write', 'user:write'] }),
    );
    const byRevoke = await granted.agent
      .put(`/api/v1/users/${granted.user.id}/grants`)
      .send({ permissions: ['user:write'] });
    expect(byRevoke.status).toBe(409);
    expect(byRevoke.body).toMatchObject({ code: 'role.self_lockout' });

    // An owner removing their own owner role (another owner remains) locks themselves out.
    const second = await clinic.staff(['owner'], 'Second Owner', 'other');
    const ownerSelf = await second.agent
      .patch(`/api/v1/users/${second.user.id}`)
      .send({ roleKeys: ['dentist'] });
    expect(ownerSelf.status).toBe(409);
    expect(ownerSelf.body).toMatchObject({ code: 'role.self_lockout' });
  });
});
