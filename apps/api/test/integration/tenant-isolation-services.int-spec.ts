import type {
  AuditPage,
  Branch,
  DiagnosisItem,
  Patient,
  PatientPage,
  Role,
  Room,
  ServiceItem,
  Session,
  StaffUser,
  Tenant,
} from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../src/platform/kernel/id';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { createPlatformAdmin, signIn, signInAndSetPassword, uniqueEmail } from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';

const TEMPORARY = 'temporary-pw-1';

interface Clinic {
  tenant: Tenant;
  ownerEmail: string;
  branch: Branch;
  room: Room;
  staff: StaffUser;
  patient: Patient;
}

/**
 * CLAUDE.md §14: tenant A's users cannot read or affect tenant B's rows through any public
 * service — branches, rooms, users, roles, audit, catalogs, patients — and cannot pick B with
 * `X-Tenant-Id`.
 */
describe('tenant isolation through the public services', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let admin: TestAgent;
  let a: Clinic;
  let b: Clinic;
  let ownerA: TestAgent;

  const provisionClinic = async (name: string): Promise<Clinic> => {
    const ownerEmail = uniqueEmail('owner');
    const slug = `iso-${newId().slice(-12)}`;
    const provisioned = await admin.post('/api/v1/platform/tenants').send({
      clinic: { name, slug },
      firstBranch: { name: `${name} Main` },
      owner: { displayName: `${name} Owner`, email: ownerEmail, temporaryPassword: TEMPORARY },
    });
    expect(provisioned.status).toBe(201);
    const tenant = provisioned.body as Tenant;
    const inTenant = {
      get: (path: string) => admin.get(`/api/v1${path}`).set('X-Tenant-Id', tenant.id),
      post: (path: string, body: object) =>
        admin.post(`/api/v1${path}`).set('X-Tenant-Id', tenant.id).send(body),
    };
    const [branch] = (await inTenant.get('/branches')).body as Branch[];
    if (!branch) throw new Error('provisioning created no branch');
    const [room] = (
      await inTenant.post('/rooms/batch', {
        items: [{ branchId: branch.id, name: 'Room 1', code: 'R1', active: true }],
      })
    ).body as Room[];
    if (!room) throw new Error('room batch returned nothing');
    const staff = (
      await inTenant.post('/users', {
        displayName: `${name} Assistant`,
        email: uniqueEmail('staff'),
        practitionerType: 'assistant',
        roleKeys: ['assistant'],
        branchIds: [branch.id],
        temporaryPassword: TEMPORARY,
      })
    ).body as StaffUser;
    const patient = (
      await inTenant.post('/patients', { fullName: `${name} Patient`, phone: '03 123 456' })
    ).body as Patient;
    if (patient.displayNumber !== 'P-000001') throw new Error('patient create failed');
    return { tenant, ownerEmail, branch, room, staff, patient };
  };

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    admin = await signIn(testApp.app, await createPlatformAdmin(testApp.app), undefined, {
      rememberMe: true,
    });
    a = await provisionClinic('Alpha');
    b = await provisionClinic('Bravo');
    ownerA = await signInAndSetPassword(testApp.app, a.ownerEmail, TEMPORARY);
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  describe('lists show only the own tenant', () => {
    it('branches and rooms', async () => {
      const branches = (await ownerA.get('/api/v1/branches')).body as Branch[];
      expect(branches.map((branch) => branch.id)).toEqual([a.branch.id]);
      const rooms = (await ownerA.get('/api/v1/rooms')).body as Room[];
      expect(rooms.map((room) => room.id)).toEqual([a.room.id]);
      expect((await ownerA.get(`/api/v1/rooms?branchId=${b.branch.id}`)).body).toEqual([]);
    });

    it('users and roles', async () => {
      const users = (await ownerA.get('/api/v1/users')).body as StaffUser[];
      expect(users.map((user) => user.displayName).sort()).toEqual([
        'Alpha Assistant',
        'Alpha Owner',
      ]);
      const roles = (await ownerA.get('/api/v1/roles')).body as Role[];
      const bRoleIds = await database.ownerPool.query<{ id: string }>(
        'select id from roles where tenant_id = $1',
        [b.tenant.id],
      );
      const foreign = new Set(bRoleIds.rows.map((row) => row.id));
      expect(foreign.size).toBe(4);
      expect(roles).toHaveLength(4);
      expect(roles.filter((role) => foreign.has(role.id))).toEqual([]);
    });

    it('service and diagnosis catalogs', async () => {
      const foreign = await database.ownerPool.query<{ id: string }>(
        'select id from procedures where tenant_id = $1 union all select id from diagnoses where tenant_id = $1',
        [b.tenant.id],
      );
      const foreignIds = new Set(foreign.rows.map((row) => row.id));
      expect(foreignIds.size).toBe(26);
      const services = (await ownerA.get('/api/v1/catalog/services')).body as ServiceItem[];
      const diagnoses = (await ownerA.get('/api/v1/catalog/diagnoses')).body as DiagnosisItem[];
      expect(services).toHaveLength(12);
      expect(diagnoses).toHaveLength(14);
      expect([...services, ...diagnoses].filter((item) => foreignIds.has(item.id))).toEqual([]);
    });

    it('patients: search, counts and duplicates', async () => {
      const all = (await ownerA.get('/api/v1/patients?size=50')).body as PatientPage;
      expect(all.items.map((item) => item.id)).toEqual([a.patient.id]);
      expect(all.total).toBe(1);
      // B's patient has the same number and phone as A's: neither matches across tenants.
      for (const q of ['P-000001', '03123456', 'Bravo']) {
        const found = (await ownerA.get(`/api/v1/patients?q=${q}`)).body as PatientPage;
        expect(found.items.map((item) => item.id)).not.toContain(b.patient.id);
      }
      expect((await ownerA.get('/api/v1/patients/counts')).body).toEqual({
        active: 1,
        notSeen: 1,
        archived: 0,
      });
      const twins = await ownerA.get(
        `/api/v1/patients/duplicates/check?fullName=${encodeURIComponent(b.patient.fullName)}&dateOfBirth=1990-01-01`,
      );
      expect(twins.body).toEqual([]);
    });

    it('audit entries', async () => {
      const audit = (await ownerA.get('/api/v1/audit?limit=100')).body as AuditPage;
      expect(audit.items.length).toBeGreaterThan(0);
      const foreign = new Set([b.tenant.id, b.branch.id, b.room.id, b.staff.id]);
      expect(audit.items.filter((entry) => foreign.has(entry.resourceId))).toEqual([]);
      expect(
        ((await ownerA.get(`/api/v1/audit?resourceId=${b.staff.id}`)).body as AuditPage).items,
      ).toEqual([]);
    });
  });

  describe("B's rows cannot be reached by id", () => {
    it('users: not found for read and every write', async () => {
      const id = b.staff.id;
      const attempts = [
        ownerA.get(`/api/v1/users/${id}`),
        ownerA.patch(`/api/v1/users/${id}`).send({ title: 'Hijacked' }),
        ownerA.post(`/api/v1/users/${id}/deactivate`).send({ reason: 'Hijack' }),
        ownerA.post(`/api/v1/users/${id}/reactivate`).send({ reason: 'Hijack' }),
        ownerA.post(`/api/v1/users/${id}/reset-password`).send({ temporaryPassword: TEMPORARY }),
      ];
      for (const response of await Promise.all(attempts)) {
        expect(response.status).toBe(404);
        expect(response.body).toMatchObject({ code: 'user.not_found' });
      }
      // B's user is untouched: still active and able to sign in with their password.
      await signIn(testApp.app, b.staff.email, TEMPORARY);
    });

    it('branches and rooms: not found', async () => {
      const branch = await ownerA.patch(`/api/v1/branches/${b.branch.id}`).send({ name: 'X' });
      expect(branch.body).toMatchObject({ code: 'branch.not_found' });

      const room = await ownerA.post('/api/v1/rooms/batch').send({
        items: [{ id: b.room.id, branchId: b.branch.id, name: 'X', code: null, active: false }],
      });
      expect(room.body).toMatchObject({ code: 'room.not_found' });

      const newRoom = await ownerA.post('/api/v1/rooms/batch').send({
        items: [{ branchId: b.branch.id, name: 'Sneaky', code: null, active: true }],
      });
      expect(newRoom.body).toMatchObject({ code: 'branch.not_found' });
    });

    it('catalog rows: not found for every write, and left unchanged', async () => {
      const bService = (
        await database.ownerPool.query<{ id: string }>(
          "select id from procedures where tenant_id = $1 and code = 'EXT'",
          [b.tenant.id],
        )
      ).rows[0]?.id;
      const bDiagnosis = (
        await database.ownerPool.query<{ id: string }>(
          "select id from diagnoses where tenant_id = $1 and code = 'DX-CAR'",
          [b.tenant.id],
        )
      ).rows[0]?.id;
      if (!bService || !bDiagnosis) throw new Error("B's catalog was not seeded");

      const attempts = [
        ownerA.put('/api/v1/catalog/services').send({
          items: [
            {
              id: bService,
              code: 'EXT',
              name: 'Hijacked',
              category: null,
              chargeUnit: 'per_tooth',
              price: '0',
            },
          ],
        }),
        ownerA.delete(`/api/v1/catalog/services/${bService}`),
        ownerA.post(`/api/v1/catalog/services/${bService}/deactivate`),
        ownerA
          .put('/api/v1/catalog/diagnoses')
          .send({ items: [{ id: bDiagnosis, code: 'DX-CAR', name: 'Hijacked', category: null }] }),
        ownerA.delete(`/api/v1/catalog/diagnoses/${bDiagnosis}`),
        ownerA.post(`/api/v1/catalog/diagnoses/${bDiagnosis}/deactivate`),
      ];
      for (const response of await Promise.all(attempts)) {
        expect(response.status).toBe(404);
        expect(response.body).toMatchObject({ code: 'catalog.not_found' });
      }
      const untouched = await database.ownerPool.query(
        `select name, active, deleted_at from procedures where id = $1
         union all select name, active, deleted_at from diagnoses where id = $2`,
        [bService, bDiagnosis],
      );
      expect(untouched.rows).toEqual([
        { name: 'Extraction', active: true, deleted_at: null },
        { name: 'Dental caries', active: true, deleted_at: null },
      ]);
    });

    it('patients: not found for read and every write, and left unchanged', async () => {
      const id = b.patient.id;
      const attempts = [
        ownerA.get(`/api/v1/patients/${id}`),
        ownerA.patch(`/api/v1/patients/${id}`).send({ fullName: 'Hijacked' }),
        ownerA.post('/api/v1/patients/archive').send({ ids: [id] }),
        ownerA.post('/api/v1/patients/archive').send({ ids: [a.patient.id, id] }),
        ownerA.post('/api/v1/patients/restore').send({ ids: [id] }),
        ownerA
          .post('/api/v1/patients/merge')
          .send({ keepId: a.patient.id, dropId: id, reason: 'Hijack' }),
        ownerA
          .post('/api/v1/patients/merge')
          .send({ keepId: id, dropId: a.patient.id, reason: 'Hijack' }),
      ];
      for (const response of await Promise.all(attempts)) {
        expect(response.status).toBe(404);
        expect(response.body).toMatchObject({ code: 'patient.not_found' });
      }
      const untouched = await database.ownerPool.query(
        'select id, full_name, deleted_at, merged_into_id from patients where id = any($1) order by full_name',
        [[a.patient.id, id]],
      );
      expect(untouched.rows).toEqual([
        { id: a.patient.id, full_name: 'Alpha Patient', deleted_at: null, merged_into_id: null },
        { id, full_name: 'Bravo Patient', deleted_at: null, merged_into_id: null },
      ]);
    });

    it("A's patient creates never advance B's counter", async () => {
      const counter = async (tenantId: string) =>
        (
          await database.ownerPool.query<{ last_value: number }>(
            'select last_value from patient_counters where tenant_id = $1',
            [tenantId],
          )
        ).rows[0]?.last_value;
      expect(await counter(b.tenant.id)).toBe(1);
      const created = await ownerA
        .post('/api/v1/patients')
        .send({ fullName: 'Alpha Second', phone: '71 000 000' });
      expect(created.body).toMatchObject({ displayNumber: 'P-000002' });
      expect(await counter(a.tenant.id)).toBe(2);
      expect(await counter(b.tenant.id)).toBe(1);
    });

    it("B's branches cannot be assigned or switched to", async () => {
      const assign = await ownerA.post('/api/v1/users').send({
        displayName: 'Cross Tenant',
        email: uniqueEmail('cross'),
        practitionerType: 'other',
        roleKeys: ['frontdesk'],
        branchIds: [b.branch.id],
        temporaryPassword: TEMPORARY,
      });
      expect(assign.body).toMatchObject({ code: 'user.unknown_branch' });

      const promote = await ownerA
        .patch(`/api/v1/users/${a.staff.id}`)
        .send({ branchIds: [a.branch.id, b.branch.id] });
      expect(promote.body).toMatchObject({ code: 'user.unknown_branch' });

      const switchTo = await ownerA.post('/api/v1/session/branch').send({ branchId: b.branch.id });
      expect(switchTo.body).toMatchObject({ code: 'session.branch_not_assigned' });
    });
  });

  describe('X-Tenant-Id', () => {
    it('is ignored for clinic users', async () => {
      const tenant = await ownerA.get('/api/v1/tenant').set('X-Tenant-Id', b.tenant.id);
      expect(tenant.body).toMatchObject({ id: a.tenant.id });
      const users = (await ownerA.get('/api/v1/users').set('X-Tenant-Id', b.tenant.id))
        .body as StaffUser[];
      expect(users.map((user) => user.id)).not.toContain(b.staff.id);
      const session = (await ownerA.get('/api/v1/session').set('X-Tenant-Id', b.tenant.id))
        .body as Session;
      expect(session.tenant?.id).toBe(a.tenant.id);

      const write = await ownerA
        .post('/api/v1/branches')
        .set('X-Tenant-Id', b.tenant.id)
        .send({ name: 'Planted' });
      expect(write.status).toBe(201);
      const planted = await database.ownerPool.query<{ tenant_id: string }>(
        "select tenant_id from branches where name = 'Planted'",
      );
      expect(planted.rows).toEqual([{ tenant_id: a.tenant.id }]);
    });
  });

  it('has RLS enabled on every tenant table', async () => {
    const tables = [
      'tenants',
      'branches',
      'rooms',
      'roles',
      'role_permissions',
      'user_roles',
      'staff_profiles',
      'staff_branches',
      'audit_log',
      'procedures',
      'diagnoses',
      'patients',
      'patient_counters',
    ];
    const result = await database.ownerPool.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
       where relnamespace = 'public'::regnamespace and relname = any($1)`,
      [tables],
    );
    expect(
      result.rows
        .filter((row) => row.relrowsecurity)
        .map((row) => row.relname)
        .sort(),
    ).toEqual([...tables].sort());
  });
});
