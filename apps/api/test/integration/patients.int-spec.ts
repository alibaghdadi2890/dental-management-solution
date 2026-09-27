import type {
  AuditEntry,
  AuditPage,
  Branch,
  DuplicateGroup,
  Patient,
  PatientCounts,
  PatientListItem,
  PatientPage,
  ProblemDetails,
  StaffUser,
  Tenant,
} from '@dcm/contracts';
import {
  patientArchiveSchema,
  patientInputSchema,
  patientListQuerySchema,
  patientMergeSchema,
} from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PatientsService } from '../../src/modules/patients';
import { PermissionDeniedError } from '../../src/platform/cls/permission-denied.error';
import { RequestContext } from '../../src/platform/cls/request-context';
import { PatientsRepository } from '../../src/modules/patients/persistence/patients.repository';
import { TenantDb } from '../../src/platform/db/tenant-db';
import { newId } from '../../src/platform/kernel/id';
import { ValidationFailedError } from '../../src/platform/kernel/validation-failed.error';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { createPlatformAdmin, signIn, signInAndSetPassword, uniqueEmail } from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';
import { asPlatformAdminIn } from '../support/tenants';

const TEMPORARY = 'temporary-pw-1';

interface Clinic {
  tenant: Tenant;
  owner: TestAgent;
  branch: Branch;
}

/** The problem body's `errors[0].path`, for 422/400 validation responses. */
const firstPath = (body: unknown) => (body as ProblemDetails).errors?.[0]?.path;

const ids = (page: PatientPage) => page.items.map((item) => item.id);

describe('patients: records, search, duplicates, archive and merge', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let admin: TestAgent;
  let main: Clinic;

  const provision = async (name: string): Promise<Clinic> => {
    const ownerEmail = uniqueEmail('owner');
    const response = await admin.post('/api/v1/platform/tenants').send({
      clinic: { name, slug: `pat-${newId().slice(-12)}` },
      firstBranch: { name: `${name} Main` },
      owner: { displayName: `${name} Owner`, email: ownerEmail, temporaryPassword: TEMPORARY },
    });
    expect(response.status).toBe(201);
    const owner = await signInAndSetPassword(testApp.app, ownerEmail, TEMPORARY);
    const [branch] = (await owner.get('/api/v1/branches')).body as Branch[];
    if (!branch) throw new Error('provisioning created no branch');
    return { tenant: response.body as Tenant, owner, branch };
  };

  const createStaff = async (
    clinic: Clinic,
    overrides: Record<string, unknown> = {},
  ): Promise<StaffUser & { email: string }> => {
    const email = uniqueEmail('staff');
    const response = await clinic.owner.post('/api/v1/users').send({
      displayName: 'Dr. Staff',
      email,
      practitionerType: 'dentist',
      roleKeys: ['dentist'],
      branchIds: [clinic.branch.id],
      temporaryPassword: TEMPORARY,
      ...overrides,
    });
    expect(response.status).toBe(201);
    return { ...(response.body as StaffUser), email };
  };

  const createPatient = async (agent: TestAgent, body: Record<string, unknown>) => {
    const response = await agent.post('/api/v1/patients').send(body);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as Patient;
  };

  const getPatient = async (agent: TestAgent, id: string) =>
    (await agent.get(`/api/v1/patients/${id}`)).body as Patient;

  const search = async (agent: TestAgent, query: string) => {
    const response = await agent.get(`/api/v1/patients?${query}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body as PatientPage;
  };

  const auditOf = async (agent: TestAgent, query: string): Promise<AuditEntry[]> =>
    ((await agent.get(`/api/v1/audit?${query}&limit=100`)).body as AuditPage).items;

  /** Events recorded by the generic audit subscriber, newest first. */
  const events = async (agent: TestAgent, name: string) =>
    (await auditOf(agent, 'resourceType=event')).filter((entry) => entry.action === name);

  /** Runs `fn` with the test clock at `at`, then puts the clock back. */
  const withClockAt = async <T>(at: string, fn: () => Promise<T>): Promise<T> => {
    const original = testApp.clock.now();
    testApp.clock.set(new Date(at));
    try {
      return await fn();
    } finally {
      testApp.clock.set(original);
    }
  };

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    admin = await signIn(testApp.app, await createPlatformAdmin(testApp.app), undefined, {
      rememberMe: true,
    });
    main = await provision('Patients Clinic');
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  describe('create', () => {
    it('mints P-000001, P-000002 per tenant and stores the phone in E.164', async () => {
      const numbering = await provision('Numbering Clinic');
      const first = await createPatient(numbering.owner, {
        fullName: 'Lina Aoun',
        phone: '03 123 456',
      });
      expect(first).toMatchObject({
        displayNumber: 'P-000001',
        fullName: 'Lina Aoun',
        phone: '+9613123456',
        sex: 'unknown',
        medicalAlerts: [],
        archivedAt: null,
        mergedIntoId: null,
      });
      const second = await createPatient(numbering.owner, {
        fullName: 'Rami Aoun',
        phone: '71123456',
      });
      expect(second.displayNumber).toBe('P-000002');

      const other = await provision('Other Numbering Clinic');
      const theirs = await createPatient(other.owner, { fullName: 'Nour', phone: '03 123 456' });
      expect(theirs.displayNumber).toBe('P-000001');

      const [created] = await auditOf(numbering.owner, `resourceId=${first.id}`);
      expect(created).toMatchObject({
        action: 'patient.create',
        resourceType: 'patient',
        after: { displayNumber: 'P-000001', phone: '+9613123456' },
      });
      const [event] = await events(numbering.owner, 'PatientCreated');
      expect(event?.after).toEqual({ patientId: second.id });
    });

    it('gives 10 parallel creates 10 distinct, consecutive numbers', async () => {
      const clinic = await provision('Parallel Clinic');
      const created = await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          createPatient(clinic.owner, { fullName: `Parallel ${index}`, phone: '71 000 000' }),
        ),
      );
      const numbers = created.map((patient) => patient.displayNumber).sort();
      expect(numbers).toEqual(
        Array.from({ length: 10 }, (_, index) => `P-${String(index + 1).padStart(6, '0')}`),
      );
    });

    it('refuses a dentist who is not an active practitioner', async () => {
      const refused = await main.owner
        .post('/api/v1/patients')
        .send({ fullName: 'No Dentist', phone: '71 000 000', primaryDentistUserId: newId() });
      expect(refused.status).toBe(422);
      expect(refused.body).toMatchObject({ code: 'patient.unknown_dentist' });
    });

    it('frees the number of a create rolled back after minting (caller transaction)', async () => {
      const clinic = await provision('Rollback Clinic');
      const first = await createPatient(clinic.owner, {
        fullName: 'Rollback One',
        phone: '71000050',
      });
      expect(first.displayNumber).toBe('P-000001');

      // As billing's create-with-opening-balance does: create inside the caller's transaction,
      // which then fails after the number was minted, the row inserted and the audit written.
      const service = testApp.app.get(PatientsService);
      const tenantDb = testApp.app.get(TenantDb);
      let lost: Patient | undefined;
      await expect(
        asPlatformAdminIn(testApp.app, clinic.tenant.id, () =>
          tenantDb.run(async () => {
            lost = await service.create(
              patientInputSchema.parse({ fullName: 'Rollback Lost', phone: '71000051' }),
            );
            throw new Error('opening balance failed');
          }),
        ),
      ).rejects.toThrow('opening balance failed');
      if (!lost) throw new Error('create did not run');
      expect(lost.displayNumber).toBe('P-000002');

      const next = await createPatient(clinic.owner, {
        fullName: 'Rollback Two',
        phone: '71000052',
      });
      expect(next.displayNumber).toBe('P-000002');

      const leftovers = await database.ownerPool.query<{ n: number }>(
        `select (select count(*) from patients where id = $1)::int
              + (select count(*) from audit_log
                 where resource_id = $1::text or after->>'patientId' = $1::text)::int as n`,
        [lost.id],
      );
      expect(leftovers.rows[0]?.n).toBe(0);
    });

    it('never takes externalId from a request: only the import sets it', async () => {
      const created = await createPatient(main.owner, {
        fullName: 'Import Key',
        phone: '71000053',
        externalId: 'EXT-1',
      });
      expect(created.externalId).toBeNull();
      const patched = await main.owner
        .patch(`/api/v1/patients/${created.id}`)
        .send({ externalId: 'EXT-1' });
      expect(patched.status).toBe(400);
      expect((await getPatient(main.owner, created.id)).externalId).toBeNull();
    });

    it('rejects an invalid phone or guardian phone at the field', async () => {
      const phone = await main.owner
        .post('/api/v1/patients')
        .send({ fullName: 'Bad Phone', phone: '12' });
      expect(phone.status).toBe(422);
      expect(phone.body).toMatchObject({ code: 'validation_failed' });
      expect(firstPath(phone.body)).toBe('phone');

      const guardian = await main.owner
        .post('/api/v1/patients')
        .send({ fullName: 'Bad Guardian', phone: '71000000', guardianPhone: '999' });
      expect(guardian.status).toBe(422);
      expect(firstPath(guardian.body)).toBe('guardianPhone');
    });

    it("checks the date of birth against the tenant's today, not UTC's", async () => {
      // 22:30 UTC on 1 March is already 2 March in Beirut (UTC+2 in winter).
      await withClockAt('2026-03-01T22:30:00Z', async () => {
        const tomorrow = await main.owner
          .post('/api/v1/patients')
          .send({ fullName: 'Not Born Yet', phone: '71000000', dateOfBirth: '2026-03-03' });
        expect(tomorrow.status).toBe(422);
        expect(tomorrow.body).toMatchObject({ code: 'validation_failed' });
        expect(firstPath(tomorrow.body)).toBe('dateOfBirth');

        const bornToday = await createPatient(main.owner, {
          fullName: 'Born Today',
          phone: '71000000',
          dateOfBirth: '2026-03-02',
        });
        expect(bornToday.dateOfBirth).toBe('2026-03-02');

        const patched = await main.owner
          .patch(`/api/v1/patients/${bornToday.id}`)
          .send({ dateOfBirth: '2026-03-03' });
        expect(patched.status).toBe(422);
        expect(firstPath(patched.body)).toBe('dateOfBirth');
      });
    });
  });

  describe('update', () => {
    it('audits before/after and emits PatientUpdated with the changed fields', async () => {
      const patient = await createPatient(main.owner, {
        fullName: 'Maya Update',
        phone: '71000001',
      });
      const response = await main.owner
        .patch(`/api/v1/patients/${patient.id}`)
        .send({ address: '12 Hamra St', fullName: 'Maya Update' });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ address: '12 Hamra St', fullName: 'Maya Update' });

      const [entry] = await auditOf(main.owner, `resourceType=patient&resourceId=${patient.id}`);
      expect(entry).toMatchObject({
        action: 'patient.update',
        before: { address: null },
        after: { address: '12 Hamra St' },
      });
      const [event] = await events(main.owner, 'PatientUpdated');
      expect(event?.after).toEqual({ patientId: patient.id, fields: ['address'] });
    });

    it('writes, audits and emits nothing for a patch that changes nothing', async () => {
      const patient = await createPatient(main.owner, {
        fullName: 'Noop Patch',
        phone: '71000006',
        address: 'Same St',
      });
      const response = await main.owner
        .patch(`/api/v1/patients/${patient.id}`)
        .send({ phone: '71-000-006', fullName: 'Noop Patch', address: 'Same St' });
      expect(response.status).toBe(200);
      expect(response.body).toEqual(patient);
      const entries = await auditOf(main.owner, `resourceId=${patient.id}`);
      expect(entries.map((entry) => entry.action)).toEqual(['patient.create']);
      const updated = (await events(main.owner, 'PatientUpdated')).filter(
        (entry) => (entry.after as { patientId: string }).patientId === patient.id,
      );
      expect(updated).toEqual([]);
    });

    it('re-normalises a changed phone and keeps it searchable', async () => {
      const patient = await createPatient(main.owner, {
        fullName: 'Phone Change',
        phone: '71000002',
      });
      const response = await main.owner
        .patch(`/api/v1/patients/${patient.id}`)
        .send({ phone: '76 654 321' });
      expect(response.body).toMatchObject({ phone: '+96176654321' });
      const found = await search(main.owner, 'q=76654321');
      expect(found.items.map((item) => item.id)).toEqual([patient.id]);
    });

    it('refuses to edit an archived patient', async () => {
      const patient = await createPatient(main.owner, {
        fullName: 'Archived Edit',
        phone: '71000003',
      });
      await main.owner.post('/api/v1/patients/archive').send({ ids: [patient.id] });
      const response = await main.owner
        .patch(`/api/v1/patients/${patient.id}`)
        .send({ notes: 'too late' });
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'patient.archived' });
    });

    it('keeps a dentist deactivated after assignment, but refuses a newly chosen inactive one', async () => {
      const dentist = await createStaff(main, { displayName: 'Dr. Leaving' });
      const patient = await createPatient(main.owner, {
        fullName: 'Loyal Patient',
        phone: '71000004',
        primaryDentistUserId: dentist.id,
      });
      const other = await createPatient(main.owner, { fullName: 'New Patient', phone: '71000005' });
      const deactivated = await main.owner
        .post(`/api/v1/users/${dentist.id}/deactivate`)
        .send({ reason: 'Left the clinic' });
      expect(deactivated.status).toBe(200);

      const kept = await main.owner
        .patch(`/api/v1/patients/${patient.id}`)
        .send({ primaryDentistUserId: dentist.id, notes: 'Still theirs' });
      expect(kept.status).toBe(200);
      expect(kept.body).toMatchObject({ primaryDentistUserId: dentist.id, notes: 'Still theirs' });

      const chosen = await main.owner
        .patch(`/api/v1/patients/${other.id}`)
        .send({ primaryDentistUserId: dentist.id });
      expect(chosen.status).toBe(422);
      expect(chosen.body).toMatchObject({ code: 'patient.unknown_dentist' });
    });

    it('answers 404 for an unknown id', async () => {
      const response = await main.owner.get(`/api/v1/patients/${newId()}`);
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ code: 'patient.not_found' });
    });
  });

  describe('search', () => {
    let clinic: Clinic;
    let zed: StaffUser;
    let amir: StaffUser;
    let jose: Patient;
    let amira: Patient;
    let omar: Patient;
    let turning18: Patient;
    let stillChild: Patient;

    beforeAll(async () => {
      clinic = await provision('Search Clinic');
      zed = await createStaff(clinic, { displayName: 'Dr. Zed Nassar' });
      amir = await createStaff(clinic, { displayName: 'Dr. Amir Haddad' });
      jose = await createPatient(clinic.owner, {
        fullName: 'José Álvarez',
        phone: '03 123 456',
        medicalAlerts: ['Penicillin'],
        primaryDentistUserId: zed.id,
      });
      amira = await createPatient(clinic.owner, {
        fullName: 'Amira Khalil',
        phone: '71 123 456',
        email: 'amira@example.com',
        primaryDentistUserId: amir.id,
      });
      omar = await createPatient(clinic.owner, { fullName: 'Omar Said', phone: '70 111 222' });
      turning18 = await createPatient(clinic.owner, {
        fullName: 'Agetest Birthday',
        phone: '70000001',
        dateOfBirth: '2008-06-15',
      });
      stillChild = await createPatient(clinic.owner, {
        fullName: 'Agetest Tomorrow',
        phone: '70000002',
        dateOfBirth: '2008-06-16',
      });
      for (let index = 1; index <= 12; index += 1) {
        await createPatient(clinic.owner, {
          fullName: `Pagertest ${String(index).padStart(2, '0')}`,
          phone: '70000003',
        });
      }
    });

    /** The page's ids restricted to `among`, keeping the page's order. */
    const orderOf = (page: PatientPage, among: readonly string[]) =>
      ids(page).filter((id) => among.includes(id));

    it('matches names without diacritics', async () => {
      expect(ids(await search(clinic.owner, 'q=jose'))).toEqual([jose.id]);
    });

    it('matches display numbers', async () => {
      expect(ids(await search(clinic.owner, 'q=P-00000'))).toEqual(
        expect.arrayContaining([jose.id, amira.id, omar.id]),
      );
      // A patient number matches display numbers only: Agetest Tomorrow's phone 70000002
      // contains the digits of P-000002. P-000001 would also match P-000010 to P-000017.
      expect(ids(await search(clinic.owner, 'q=P-000002'))).toEqual([amira.id]);
      const byNumber = await search(clinic.owner, 'q=p000013');
      expect(byNumber.items.map((item) => item.fullName)).toEqual(['Pagertest 08']);
    });

    it('matches local and E.164 phone digits, but not a single digit', async () => {
      expect(ids(await search(clinic.owner, 'q=03123'))).toEqual([jose.id]);
      expect(ids(await search(clinic.owner, 'q=96131'))).toEqual([jose.id]);
      // "3" is in José's phone; one digit never searches phones. P-000003 is Omar's number.
      const oneDigit = ids(await search(clinic.owner, 'q=3&size=50'));
      expect(oneDigit).toContain(omar.id);
      expect(oneDigit).not.toContain(jose.id);
    });

    it('matches e-mail', async () => {
      expect(ids(await search(clinic.owner, 'q=example.com'))).toEqual([amira.id]);
    });

    it('filters by alerts and dentist', async () => {
      expect(ids(await search(clinic.owner, 'alerts=yes'))).toEqual([jose.id]);
      expect(ids(await search(clinic.owner, `dentist=${zed.id}`))).toEqual([jose.id]);
      const none = ids(await search(clinic.owner, 'dentist=none&size=50'));
      expect(none).toContain(omar.id);
      expect(none).not.toContain(jose.id);
      expect(none).not.toContain(amira.id);
    });

    it('sorts by dentist display name, reversed for desc, patients without one last', async () => {
      const three = [jose.id, amira.id, omar.id];
      const asc = await search(clinic.owner, 'sort=dentist&size=50');
      expect(orderOf(asc, three)).toEqual([amira.id, jose.id, omar.id]);
      expect(ids(asc).slice(0, 2)).toEqual([amira.id, jose.id]);
      const desc = await search(clinic.owner, 'sort=dentist&dir=desc&size=50');
      expect(orderOf(desc, three)).toEqual([jose.id, amira.id, omar.id]);
      expect(ids(desc).slice(0, 2)).toEqual([jose.id, amira.id]);
    });

    it('ties dentists with the same display name, so their patients sort by name', async () => {
      const twins = await provision('Twin Dentists Clinic');
      const first = await createStaff(twins, { displayName: 'Dr. Sami Aoun' });
      const second = await createStaff(twins, { displayName: 'dr. sami aoun' });
      const other = await createStaff(twins, { displayName: 'Dr. Basma Rahal' });
      const zara = await createPatient(twins.owner, {
        fullName: 'Zara Twin',
        phone: '70000010',
        primaryDentistUserId: first.id,
      });
      const adam = await createPatient(twins.owner, {
        fullName: 'Adam Twin',
        phone: '70000011',
        primaryDentistUserId: second.id,
      });
      const mona = await createPatient(twins.owner, {
        fullName: 'Mona Twin',
        phone: '70000012',
        primaryDentistUserId: first.id,
      });
      const basma = await createPatient(twins.owner, {
        fullName: 'Yara Other',
        phone: '70000013',
        primaryDentistUserId: other.id,
      });
      const nobody = await createPatient(twins.owner, {
        fullName: 'Aaron None',
        phone: '70000014',
      });

      const asc = await search(twins.owner, 'sort=dentist&size=50');
      expect(ids(asc)).toEqual([basma.id, adam.id, mona.id, zara.id, nobody.id]);
      const desc = await search(twins.owner, 'sort=dentist&dir=desc&size=50');
      expect(ids(desc)).toEqual([adam.id, mona.id, zara.id, basma.id, nobody.id]);
    });

    it('sorts by most recently updated', async () => {
      await clinic.owner.patch(`/api/v1/patients/${amira.id}`).send({ notes: 'touched' });
      expect(ids(await search(clinic.owner, 'sort=recent'))[0]).toBe(amira.id);
    });

    it('bands ages by the tenant time zone', async () => {
      // 23:30 UTC on 14 June is already 15 June in Beirut (UTC+3 in summer): 18 today.
      await withClockAt('2026-06-14T23:30:00Z', async () => {
        expect(ids(await search(clinic.owner, 'q=agetest&age=child'))).toEqual([stillChild.id]);
        expect(ids(await search(clinic.owner, 'q=agetest&age=adult'))).toEqual([turning18.id]);
      });
    });

    it('pages by offset with the total', async () => {
      const first = await search(clinic.owner, 'q=pagertest&size=10');
      expect(first).toMatchObject({ total: 12, page: 1, size: 10 });
      expect(first.items).toHaveLength(10);
      const second = await search(clinic.owner, 'q=pagertest&page=2&size=10');
      expect(second).toMatchObject({ total: 12, page: 2, size: 10 });
      expect(second.items.map((item) => item.fullName)).toEqual(['Pagertest 11', 'Pagertest 12']);
    });

    it('takes idsIn, rank and size only from other modules (billing)', async () => {
      const service = testApp.app.get(PatientsService);
      const inClinic = <T>(fn: () => Promise<T>) =>
        asPlatformAdminIn(testApp.app, clinic.tenant.id, fn);
      const query = (raw: Record<string, string>) => patientListQuerySchema.parse(raw);

      const owing = await inClinic(() =>
        service.search(query({ view: 'owing' }), { idsIn: [omar.id, jose.id] }),
      );
      expect(owing.items.map((item) => item.id).sort()).toEqual([jose.id, omar.id].sort());

      const byBalance = await inClinic(() =>
        service.search(query({ sort: 'balance' }), {
          rank: { ids: [omar.id, jose.id], keys: [1, 2], restKey: 3 },
          size: 2,
        }),
      );
      expect(byBalance.size).toBe(2);
      expect(byBalance.items.map((item) => item.id)).toEqual([omar.id, jose.id]);

      for (const raw of [{ view: 'owing' }, { sort: 'balance' }] as Record<string, string>[]) {
        await expect(inClinic(() => service.search(query(raw)))).rejects.toBeInstanceOf(
          ValidationFailedError,
        );
      }

      const many = await inClinic(() => service.getMany([jose.id, newId()]));
      expect(many.map((patient) => patient.id)).toEqual([jose.id]);
    });

    it('answers view=owing and sort=balance with 400: billing serves them', async () => {
      for (const query of ['view=owing', 'sort=balance']) {
        const response = await clinic.owner.get(`/api/v1/patients?${query}`);
        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({ code: 'validation_failed' });
      }
    });

    it('counts active (= not seen) and archived, ignoring filters', async () => {
      const before = (await clinic.owner.get('/api/v1/patients/counts')).body as PatientCounts;
      expect(before.notSeen).toBe(before.active);
      await clinic.owner.post('/api/v1/patients/archive').send({ ids: [omar.id] });
      const after = (await clinic.owner.get('/api/v1/patients/counts')).body as PatientCounts;
      expect(after).toEqual({
        active: before.active - 1,
        notSeen: before.active - 1,
        archived: before.archived + 1,
      });
      const active = await search(clinic.owner, 'view=active&size=50');
      expect(active.total).toBe(after.active);
      await clinic.owner.post('/api/v1/patients/restore').send({ ids: [omar.id] });
    });
  });

  describe('duplicates', () => {
    let clinic: Clinic;
    let rana: Patient;
    let twin: Patient;

    beforeAll(async () => {
      clinic = await provision('Duplicates Clinic');
      rana = await createPatient(clinic.owner, {
        fullName: 'Rana Haddad',
        phone: '71000010',
        dateOfBirth: '1990-01-02',
      });
      twin = await createPatient(clinic.owner, {
        fullName: 'rana  haddád',
        phone: '71000011',
        dateOfBirth: '1990-01-02',
      });
      const archived = await createPatient(clinic.owner, {
        fullName: 'Rana Haddad',
        phone: '71000012',
        dateOfBirth: '1990-01-02',
      });
      await createPatient(clinic.owner, { fullName: 'Rana Haddad', phone: '71000013' });
      await clinic.owner.post('/api/v1/patients/archive').send({ ids: [archived.id] });
    });

    it('groups active patients sharing a name key and date of birth', async () => {
      const groups = (await clinic.owner.get('/api/v1/patients/duplicates'))
        .body as DuplicateGroup[];
      expect(groups.map((group) => group.patients.map((patient) => patient.id))).toEqual([
        [rana.id, twin.id],
      ]);
    });

    it('checks a name and date of birth, optionally excluding the record being edited', async () => {
      const check = async (query: string) =>
        (
          (await clinic.owner.get(`/api/v1/patients/duplicates/check?${query}`))
            .body as PatientListItem[]
        )
          .map((patient) => patient.id)
          .sort();
      const query = 'fullName=Rana%20Haddad&dateOfBirth=1990-01-02';
      expect(await check(query)).toEqual([rana.id, twin.id].sort());
      expect(await check(`${query}&excludeId=${rana.id}`)).toEqual([twin.id]);
    });
  });

  describe('archive and restore', () => {
    it('archives in bulk with one audit entry and one event per patient', async () => {
      const a = await createPatient(main.owner, { fullName: 'Bulkarch A', phone: '71000020' });
      const b = await createPatient(main.owner, { fullName: 'Bulkarch B', phone: '71000021' });

      // Sent in reverse id order: the result follows the input, not the row order.
      const response = await main.owner
        .post('/api/v1/patients/archive')
        .send({ ids: [b.id, a.id], reason: 'moved' });
      expect(response.status).toBe(200);
      const archived = response.body as Patient[];
      expect(archived.map((patient) => patient.id)).toEqual([b.id, a.id]);
      expect(archived.every((patient) => patient.archivedAt !== null)).toBe(true);

      for (const id of [a.id, b.id]) {
        const [entry] = await auditOf(main.owner, `resourceId=${id}`);
        expect(entry).toMatchObject({
          action: 'patient.archive',
          reason: 'moved',
          before: { archivedAt: null },
        });
      }
      const archivedEvents = (await events(main.owner, 'PatientArchived')).map(
        (entry) => (entry.after as { patientId: string }).patientId,
      );
      expect(archivedEvents).toEqual(expect.arrayContaining([a.id, b.id]));

      expect(ids(await search(main.owner, 'q=bulkarch'))).toEqual([]);
      expect(ids(await search(main.owner, 'q=bulkarch&view=archived'))).toEqual([a.id, b.id]);

      const again = await main.owner.post('/api/v1/patients/archive').send({ ids: [a.id] });
      expect(again.status).toBe(200);
      expect(again.body).toEqual([]);
      const entries = await auditOf(main.owner, `resourceId=${a.id}`);
      expect(entries.filter((entry) => entry.action === 'patient.archive')).toHaveLength(1);

      const restored = await main.owner
        .post('/api/v1/patients/restore')
        .send({ ids: [a.id, b.id] });
      expect(restored.status).toBe(200);
      expect((restored.body as Patient[]).map((patient) => patient.archivedAt)).toEqual([
        null,
        null,
      ]);
      expect(ids(await search(main.owner, 'q=bulkarch'))).toEqual([a.id, b.id]);
      const [restoreEntry] = await auditOf(main.owner, `resourceId=${a.id}`);
      expect(restoreEntry).toMatchObject({ action: 'patient.restore' });
      const restoredEvents = (await events(main.owner, 'PatientRestored')).map(
        (entry) => (entry.after as { patientId: string }).patientId,
      );
      expect(restoredEvents).toEqual(expect.arrayContaining([a.id, b.id]));
    });

    it('takes the before-snapshot under the row lock, after a concurrent edit commits', async () => {
      const patient = await createPatient(main.owner, { fullName: 'Locktest', phone: '71000023' });
      const editor = await database.ownerPool.connect();
      let archiving: Promise<{ status: number }> | undefined;
      try {
        await editor.query('begin');
        await editor.query("update patients set address = 'Committed St' where id = $1", [
          patient.id,
        ]);
        archiving = main.owner
          .post('/api/v1/patients/archive')
          .send({ ids: [patient.id] })
          .then((response) => response);
        // The archive is now blocked on the row lock the open edit holds.
        await vi.waitFor(
          async () => {
            const waiting = await database.ownerPool.query<{ n: number }>(
              `select count(*)::int as n from pg_stat_activity
               where datname = current_database() and pid <> pg_backend_pid()
                 and usename = 'dcm_app' and wait_event_type = 'Lock'
                 and query ilike '%"patients"%'`,
            );
            expect(waiting.rows[0]?.n).toBeGreaterThan(0);
          },
          { timeout: 10_000, interval: 50 },
        );
        await editor.query('commit');
      } catch (error) {
        await editor.query('rollback');
        throw error;
      } finally {
        editor.release();
      }
      expect((await archiving).status).toBe(200);
      const [entry] = await auditOf(main.owner, `resourceId=${patient.id}`);
      expect(entry).toMatchObject({
        action: 'patient.archive',
        before: { address: 'Committed St', archivedAt: null },
        after: { address: 'Committed St' },
      });
    });

    it('is all-or-nothing: an unknown id fails the call and changes nothing', async () => {
      const patient = await createPatient(main.owner, { fullName: 'Survivor', phone: '71000022' });
      const response = await main.owner
        .post('/api/v1/patients/archive')
        .send({ ids: [patient.id, newId()] });
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ code: 'patient.not_found' });
      expect((await getPatient(main.owner, patient.id)).archivedAt).toBeNull();
    });
  });

  describe('merge', () => {
    const merge = (agent: TestAgent, body: Record<string, unknown>) =>
      agent.post('/api/v1/patients/merge').send(body);

    it('takes the chosen fields, unions the alerts and archives the dropped record', async () => {
      const kept = await createPatient(main.owner, {
        fullName: 'Mergetest Karim',
        phone: '71 000 030',
        address: 'Keep St',
        medicalAlerts: ['Penicillin'],
      });
      const dropped = await createPatient(main.owner, {
        fullName: 'Mergetest Karim',
        phone: '76 000 031',
        email: 'karim@example.com',
        medicalAlerts: ['Latex', 'penicillin'],
      });

      const response = await merge(main.owner, {
        keepId: kept.id,
        dropId: dropped.id,
        fieldChoices: { phone: 'drop' },
        reason: 'Same person',
      });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body).toMatchObject({
        id: kept.id,
        phone: '+96176000031',
        address: 'Keep St',
        email: null,
        medicalAlerts: ['Penicillin', 'Latex'],
      });
      // The kept record is found by the phone it took over (search digits re-derived).
      expect(ids(await search(main.owner, 'q=76000031'))).toEqual([kept.id]);

      const droppedAfter = await getPatient(main.owner, dropped.id);
      expect(droppedAfter.archivedAt).not.toBeNull();
      expect(droppedAfter.mergedIntoId).toBe(kept.id);

      const [entry] = await auditOf(main.owner, `resourceId=${kept.id}`);
      expect(entry).toMatchObject({
        action: 'patient.merge',
        reason: 'Same person',
        before: {
          kept: { id: kept.id, phone: '+96171000030' },
          dropped: { id: dropped.id, phone: '+96176000031' },
        },
        after: { id: kept.id, phone: '+96176000031' },
      });
      const [event] = await events(main.owner, 'PatientsMerged');
      expect(event?.after).toEqual({ keptId: kept.id, droppedId: dropped.id });

      const restore = await main.owner.post('/api/v1/patients/restore').send({ ids: [dropped.id] });
      expect(restore.status).toBe(409);
      expect(restore.body).toMatchObject({ code: 'patient.merged' });
    });

    it('fails fast on an archived or merged-away record, before taking any row lock', async () => {
      const kept = await createPatient(main.owner, { fullName: 'Fast Kept', phone: '71000060' });
      const dropped = await createPatient(main.owner, { fullName: 'Fast Drop', phone: '71000061' });
      const third = await createPatient(main.owner, { fullName: 'Fast Third', phone: '71000062' });
      expect(
        (await merge(main.owner, { keepId: kept.id, dropId: dropped.id, reason: 'Same person' }))
          .status,
      ).toBe(200);

      const lockPair = vi.spyOn(testApp.app.get(PatientsRepository), 'lockPair');
      try {
        for (const [keepId, dropId] of [
          [third.id, dropped.id],
          [dropped.id, third.id],
        ] as const) {
          const response = await merge(main.owner, { keepId, dropId, reason: 'Same person' });
          expect(response.status).toBe(409);
          expect(response.body).toMatchObject({ code: 'patient.archived' });
        }
        expect(lockPair).not.toHaveBeenCalled();
      } finally {
        lockPair.mockRestore();
      }
    });

    it('refuses archived records, the same id, a short reason and an alert overflow', async () => {
      const a = await createPatient(main.owner, { fullName: 'Merge Guard A', phone: '71000032' });
      const archived = await createPatient(main.owner, {
        fullName: 'Merge Guard B',
        phone: '71000033',
      });
      await main.owner.post('/api/v1/patients/archive').send({ ids: [archived.id] });

      const withArchived = await merge(main.owner, {
        keepId: a.id,
        dropId: archived.id,
        reason: 'Same person',
      });
      expect(withArchived.status).toBe(409);
      expect(withArchived.body).toMatchObject({ code: 'patient.archived' });

      // The contract refuses the same id before the service (which would answer 422).
      const same = await merge(main.owner, { keepId: a.id, dropId: a.id, reason: 'Same person' });
      expect(same.status).toBe(400);
      expect(same.body).toMatchObject({ code: 'validation_failed' });
      expect(firstPath(same.body)).toBe('dropId');

      const other = await createPatient(main.owner, {
        fullName: 'Merge Guard C',
        phone: '71000034',
      });
      const short = await merge(main.owner, { keepId: a.id, dropId: other.id, reason: 'ab' });
      expect(short.status).toBe(400);

      const alerts = (prefix: string) =>
        Array.from({ length: 12 }, (_, index) => `${prefix} ${index}`);
      const full = await createPatient(main.owner, {
        fullName: 'Many Alerts A',
        phone: '71000035',
        medicalAlerts: alerts('Allergy'),
      });
      const fuller = await createPatient(main.owner, {
        fullName: 'Many Alerts B',
        phone: '71000036',
        medicalAlerts: alerts('Condition'),
      });
      const overflow = await merge(main.owner, {
        keepId: full.id,
        dropId: fuller.id,
        reason: 'Same person',
      });
      expect(overflow.status).toBe(422);
      expect(overflow.body).toMatchObject({ code: 'patient.merge_alerts_overflow' });
      expect((await getPatient(main.owner, fuller.id)).archivedAt).toBeNull();
      expect((await getPatient(main.owner, full.id)).medicalAlerts).toHaveLength(12);
    });

    it('lets exactly one of two conflicting concurrent merges win, without deadlock', async () => {
      const make = (name: string) =>
        createPatient(main.owner, { fullName: name, phone: '71000037' });

      // Opposite directions over the same pair: the loser finds one of its records archived.
      const a = await make('Race A');
      const b = await make('Race B');
      const opposite = await Promise.all([
        merge(main.owner, { keepId: a.id, dropId: b.id, reason: 'Race one' }),
        merge(main.owner, { keepId: b.id, dropId: a.id, reason: 'Race two' }),
      ]);
      expect(opposite.map((response) => response.status).sort()).toEqual([200, 409]);

      // Two merges dropping the same record into different ones.
      const c = await make('Race C');
      const d = await make('Race D');
      const e = await make('Race E');
      const sameDrop = await Promise.all([
        merge(main.owner, { keepId: c.id, dropId: d.id, reason: 'Race one' }),
        merge(main.owner, { keepId: e.id, dropId: d.id, reason: 'Race two' }),
      ]);
      expect(sameDrop.map((response) => response.status).sort()).toEqual([200, 409]);
      const winner = sameDrop[0].status === 200 ? c.id : e.id;
      expect((await getPatient(main.owner, d.id)).mergedIntoId).toBe(winner);

      // Chained pairs (F ← G, G ← H) lock G from both sides: never a deadlock or a 5xx.
      const f = await make('Race F');
      const g = await make('Race G');
      const h = await make('Race H');
      const chained = await Promise.all([
        merge(main.owner, { keepId: f.id, dropId: g.id, reason: 'Race one' }),
        merge(main.owner, { keepId: g.id, dropId: h.id, reason: 'Race two' }),
      ]);
      const statuses = chained.map((response) => response.status);
      expect(statuses.every((status) => status === 200 || status === 409)).toBe(true);
      expect(statuses).toContain(200);
      expect((await getPatient(main.owner, g.id)).mergedIntoId).toBe(f.id);
    });
  });

  describe('permissions', () => {
    it('lets front desk create, edit, archive and merge', async () => {
      const staff = await createStaff(main, {
        displayName: 'Jamie Ortiz',
        practitionerType: 'frontdesk',
        roleKeys: ['frontdesk'],
      });
      const frontdesk = await signInAndSetPassword(testApp.app, staff.email, TEMPORARY);

      const a = await createPatient(frontdesk, { fullName: 'Desk A', phone: '71000040' });
      const b = await createPatient(frontdesk, { fullName: 'Desk B', phone: '71000041' });
      const c = await createPatient(frontdesk, { fullName: 'Desk C', phone: '71000042' });
      expect(
        (await frontdesk.patch(`/api/v1/patients/${a.id}`).send({ notes: 'Called' })).status,
      ).toBe(200);
      expect((await frontdesk.post('/api/v1/patients/archive').send({ ids: [c.id] })).status).toBe(
        200,
      );
      const merged = await frontdesk
        .post('/api/v1/patients/merge')
        .send({ keepId: a.id, dropId: b.id, reason: 'Duplicate' });
      expect(merged.status).toBe(200);
    });

    it('re-checks the permission in the service, not only at the route', async () => {
      const a = await createPatient(main.owner, { fullName: 'Recheck A', phone: '71000044' });
      const b = await createPatient(main.owner, { fullName: 'Recheck B', phone: '71000045' });
      const service = testApp.app.get(PatientsService);
      const context = testApp.app.get(RequestContext);
      const withOnly = <T>(permissions: ('patient:read' | 'user:read')[], fn: () => Promise<T>) =>
        context.run(
          { requestId: newId(), actorKind: 'user', tenantId: main.tenant.id, userId: newId() },
          () => {
            context.setPermissions(permissions);
            return fn();
          },
        );

      await expect(
        withOnly(['patient:read'], () =>
          service.archive(patientArchiveSchema.parse({ ids: [a.id] })),
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        withOnly(['patient:read'], () =>
          service.merge(
            patientMergeSchema.parse({ keepId: a.id, dropId: b.id, reason: 'Same person' }),
          ),
        ),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(withOnly(['user:read'], () => service.getMany([a.id]))).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
      expect((await getPatient(main.owner, a.id)).archivedAt).toBeNull();
      expect((await getPatient(main.owner, b.id)).mergedIntoId).toBeNull();
    });

    it('refuses a role without patient:read or patient:write', async () => {
      const staff = await createStaff(main, {
        displayName: 'Read Only Users',
        practitionerType: 'other',
        roleKeys: ['frontdesk'],
      });
      const roleId = newId();
      const tenantId = main.tenant.id;
      await database.ownerPool.query(
        `insert into roles (id, tenant_id, key, name, system) values ($1, $2, 'viewer', 'Viewer', false)`,
        [roleId, tenantId],
      );
      await database.ownerPool.query(
        `insert into role_permissions (tenant_id, role_id, permission) values ($1, $2, 'user:read')`,
        [tenantId, roleId],
      );
      await database.ownerPool.query('delete from user_roles where user_id = $1', [staff.id]);
      await database.ownerPool.query(
        'insert into user_roles (tenant_id, user_id, role_id) values ($1, $2, $3)',
        [tenantId, staff.id, roleId],
      );
      const viewer = await signInAndSetPassword(testApp.app, staff.email, TEMPORARY);

      expect((await viewer.get('/api/v1/patients')).status).toBe(403);
      expect((await viewer.get('/api/v1/patients/counts')).status).toBe(403);
      const create = await viewer
        .post('/api/v1/patients')
        .send({ fullName: 'Refused', phone: '71000043' });
      expect(create.status).toBe(403);
    });
  });
});
