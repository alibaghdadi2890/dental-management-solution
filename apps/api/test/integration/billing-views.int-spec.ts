import type {
  Branch,
  OpeningBalanceResult,
  Patient,
  PatientBalance,
  PatientPage,
  Session,
  StaffUser,
  Tenant,
} from '@dcm/contracts';
import { formatPhone } from '@dcm/contracts';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BillingService } from '../../src/modules/billing';
import { MergeLedgerSubscriber } from '../../src/modules/billing/application/merge-ledger.subscriber';
import { BILLING_QUEUE } from '../../src/modules/billing/application/merge-ledger.worker';
import { PATIENTS_MERGED, type PatientsMerged } from '../../src/modules/patients';
import { newId } from '../../src/platform/kernel/id';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { createPlatformAdmin, signIn, signInAndSetPassword, uniqueEmail } from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';

const TEMPORARY = 'temporary-pw-1';

/** Beirut is UTC+3 in June: the tenant's today is 2026-06-10 all day at this instant. */
const NOON = '2026-06-10T09:00:00Z';
const TODAY = '2026-06-10';

interface Clinic {
  tenant: Tenant;
  owner: TestAgent;
  branch: Branch;
}

/**
 * The CSV body (decoded as UTF-8, which keeps a byte order mark as U+FEFF) without its BOM, as
 * lines, the CRLF after the last line dropped.
 */
function csvLines(text: string): string[] {
  expect(text.startsWith('\uFEFF')).toBe(true);
  expect(text.endsWith('\r\n')).toBe(true);
  return text.slice(1, -2).split('\r\n');
}

const ids = (page: PatientPage) => page.items.map((item) => item.id);

describe('billing: patient views, CSV export and merge re-point', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let admin: TestAgent;

  const provision = async (name: string): Promise<Clinic> => {
    const ownerEmail = uniqueEmail('owner');
    const response = await admin.post('/api/v1/platform/tenants').send({
      clinic: { name, slug: `bv-${newId().slice(-12)}` },
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
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return { ...(response.body as StaffUser), email };
  };

  /** A staff member holding exactly `permissions`, through a custom role. */
  const agentWith = async (clinic: Clinic, permissions: string[]): Promise<TestAgent> => {
    const staff = await createStaff(clinic, { practitionerType: 'other', roleKeys: ['frontdesk'] });
    const roleId = newId();
    const tenantId = clinic.tenant.id;
    await database.ownerPool.query(
      `insert into roles (id, tenant_id, key, name, system) values ($1, $2, $3, 'Custom', false)`,
      [roleId, tenantId, `custom-${roleId.slice(-8)}`],
    );
    for (const permission of permissions) {
      await database.ownerPool.query(
        'insert into role_permissions (tenant_id, role_id, permission) values ($1, $2, $3)',
        [tenantId, roleId, permission],
      );
    }
    await database.ownerPool.query('delete from user_roles where user_id = $1', [staff.id]);
    await database.ownerPool.query(
      'insert into user_roles (tenant_id, user_id, role_id) values ($1, $2, $3)',
      [tenantId, staff.id, roleId],
    );
    return signInAndSetPassword(testApp.app, staff.email, TEMPORARY);
  };

  const openWithBalance = async (
    agent: TestAgent,
    patient: Record<string, unknown>,
    amount: string,
  ): Promise<Patient> => {
    const response = await agent.post('/api/v1/billing/opening-balances').send({
      patient: { phone: '71 000 000', ...patient },
      openingBalance: { amount, asOf: TODAY },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return (response.body as OpeningBalanceResult).patient;
  };

  const createPatient = async (
    agent: TestAgent,
    patient: Record<string, unknown>,
  ): Promise<Patient> => {
    const response = await agent.post('/api/v1/patients').send({ phone: '71 000 000', ...patient });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as Patient;
  };

  const adjust = async (agent: TestAgent, patientId: string, amount: string) => {
    const response = await agent
      .post(`/api/v1/billing/patients/${patientId}/adjustments`)
      .send({ amount, effectiveDate: TODAY, reason: 'test adjustment' });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
  };

  const list = async (agent: TestAgent, query: string): Promise<PatientPage> => {
    const response = await agent.get(`/api/v1/billing/patients?${query}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body as PatientPage;
  };

  const owingCount = async (agent: TestAgent): Promise<number> => {
    const response = await agent.get('/api/v1/billing/patients/owing-count');
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return (response.body as { count: number }).count;
  };

  const exportCsv = (agent: TestAgent, query: string, language?: string) => {
    const request = agent.get(`/api/v1/billing/patients/export?${query}`);
    return language ? request.set('Accept-Language', language) : request;
  };

  const balanceOf = async (agent: TestAgent, patientId: string) => {
    const response = await agent.get(`/api/v1/billing/patients/${patientId}/balance`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return (response.body as PatientBalance).balances;
  };

  const merge = (agent: TestAgent, keepId: string, dropId: string) =>
    agent.post('/api/v1/patients/merge').send({ keepId, dropId, reason: 'Same person' });

  const ledgerOwners = async (tenantId: string) =>
    (
      await database.ownerPool.query<{ patient_id: string; amount: string }>(
        `select patient_id, amount::text from ledger_entries where tenant_id = $1
         order by ledger_entries.amount, id`,
        [tenantId],
      )
    ).rows;

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    testApp.clock.set(new Date(NOON));
    admin = await signIn(testApp.app, await createPlatformAdmin(testApp.app), undefined, {
      rememberMe: true,
    });
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  describe('Owes balance view', () => {
    it('lists the active patients owing, with the matching total and owing-count', async () => {
      const clinic = await provision('Owing View Clinic');
      const adam = await openWithBalance(clinic.owner, { fullName: 'Adam Owing' }, '100.00');
      const beth = await openWithBalance(clinic.owner, { fullName: 'Beth Owing' }, '25.00');
      const archived = await openWithBalance(clinic.owner, { fullName: 'Arch Owing' }, '40.00');
      const archive = await clinic.owner
        .post('/api/v1/patients/archive')
        .send({ ids: [archived.id] });
      expect(archive.status).toBe(200);
      const settled = await openWithBalance(clinic.owner, { fullName: 'Sett Owing' }, '50.00');
      await adjust(clinic.owner, settled.id, '-50.00');
      const credit = await openWithBalance(clinic.owner, { fullName: 'Cred Owing' }, '10.00');
      await adjust(clinic.owner, credit.id, '-30.00');
      await createPatient(clinic.owner, { fullName: 'Plain Owing' });

      const owing = await list(clinic.owner, 'view=owing');
      expect(ids(owing)).toEqual([adam.id, beth.id]);
      expect(owing).toMatchObject({ total: 2, page: 1, size: 25 });
      expect(await owingCount(clinic.owner)).toBe(2);

      const paged = await list(clinic.owner, 'view=owing&size=10&page=2');
      expect(paged).toMatchObject({ items: [], total: 2, page: 2, size: 10 });
      const filtered = await list(clinic.owner, 'view=owing&q=beth');
      expect(ids(filtered)).toEqual([beth.id]);

      // The route answers any list query: without owing/balance it is the plain list.
      expect((await list(clinic.owner, 'view=archived')).items.map((item) => item.id)).toEqual([
        archived.id,
      ]);
      expect((await list(clinic.owner, 'size=50')).total).toBe(5);
    });

    it('counts zero when nobody owes', async () => {
      const clinic = await provision('Nobody Owes Clinic');
      await createPatient(clinic.owner, { fullName: 'Plain Patient' });
      expect(await owingCount(clinic.owner)).toBe(0);
      expect(await list(clinic.owner, 'view=owing')).toMatchObject({ items: [], total: 0 });
    });
  });

  describe('sort by balance', () => {
    let clinic: Clinic;
    let dana: Patient;
    let adel: Patient;
    let carl: Patient;
    let basil: Patient;
    let nadia: Patient;
    let zaki: Patient;
    let cyrus: Patient;
    let eve: Patient;

    beforeAll(async () => {
      clinic = await provision('Balance Sort Clinic');
      dana = await openWithBalance(clinic.owner, { fullName: 'Dana Daher' }, '250.00');
      // Equal debts: ordered by name, whatever the insertion order.
      carl = await openWithBalance(
        clinic.owner,
        { fullName: 'Carl Chami', medicalAlerts: ['Latex'] },
        '100.00',
      );
      adel = await openWithBalance(clinic.owner, { fullName: 'Adel Ammar' }, '100.00');
      zaki = await createPatient(clinic.owner, { fullName: 'Zaki Zero' });
      basil = await createPatient(clinic.owner, { fullName: 'Basil Bare' });
      nadia = await openWithBalance(clinic.owner, { fullName: 'Nadia Nil' }, '30.00');
      await adjust(clinic.owner, nadia.id, '-30.00');
      cyrus = await openWithBalance(clinic.owner, { fullName: 'Cyrus Credit' }, '10.00');
      await adjust(clinic.owner, cyrus.id, '-30.00');
      eve = await openWithBalance(clinic.owner, { fullName: 'Eve Credit' }, '10.00');
      await adjust(clinic.owner, eve.id, '-60.00');
    });

    it('desc: debts by amount, then zero balances by name, then credits', async () => {
      const page = await list(clinic.owner, 'sort=balance&dir=desc&size=10');
      expect(ids(page)).toEqual([
        dana.id,
        adel.id,
        carl.id,
        basil.id,
        nadia.id,
        zaki.id,
        cyrus.id,
        eve.id,
      ]);
      expect(page.total).toBe(8);
    });

    it('asc mirrors it; equal amounts still by name', async () => {
      const page = await list(clinic.owner, 'sort=balance&dir=asc&size=10');
      expect(ids(page)).toEqual([
        eve.id,
        cyrus.id,
        basil.id,
        nadia.id,
        zaki.id,
        adel.id,
        carl.id,
        dana.id,
      ]);
    });

    it('combines with the owing view, q and the other filters', async () => {
      expect(ids(await list(clinic.owner, 'view=owing&sort=balance&dir=desc'))).toEqual([
        dana.id,
        adel.id,
        carl.id,
      ]);
      expect(ids(await list(clinic.owner, 'view=owing&sort=balance&dir=asc'))).toEqual([
        adel.id,
        carl.id,
        dana.id,
      ]);
      expect(ids(await list(clinic.owner, 'q=credit&sort=balance&dir=desc'))).toEqual([
        cyrus.id,
        eve.id,
      ]);
      expect(ids(await list(clinic.owner, 'alerts=yes&sort=balance'))).toEqual([carl.id]);
    });
  });

  describe('CSV export', () => {
    let clinic: Clinic;
    let dentist: StaffUser;
    let rana: Patient;
    let ranad: Patient;
    let omar: Patient;

    beforeAll(async () => {
      clinic = await provision('Export Clinic');
      dentist = await createStaff(clinic, { displayName: 'Dr. Export Dentist' });
      rana = await openWithBalance(
        clinic.owner,
        {
          fullName: 'Rana Haddad',
          phone: '71 123 456',
          dateOfBirth: '1990-06-11',
          sex: 'female',
          primaryDentistUserId: dentist.id,
        },
        '250.00',
      );
      ranad = await createPatient(clinic.owner, { fullName: 'Ranad Plain', phone: '03 123 456' });
      omar = await openWithBalance(clinic.owner, { fullName: 'Omar Other', sex: 'male' }, '5.00');
      await adjust(clinic.owner, omar.id, '-55.00');
    });

    /**
     * International format (`+961 71 123 456`) behind the injection guard's `'`: a spreadsheet
     * would evaluate a leading `+` (the spaces as its intersection operator).
     */
    const phoneCell = (patient: Patient) => `'${formatPhone(patient.phone)}`;

    const ranaRow = () =>
      [
        rana.displayNumber,
        'Rana Haddad',
        // Born 11 June 1990; the tenant's today is 10 June 2026.
        '35',
        'Female',
        phoneCell(rana),
        '',
        'Dr. Export Dentist',
        '',
        '250.00',
      ].join(',');

    it('streams the filtered view as UTF-8 CSV with a BOM, in the table column order', async () => {
      const response = await exportCsv(clinic.owner, 'view=active&q=rana');
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="patients-${TODAY}.csv"`,
      );
      expect(csvLines(response.text)).toEqual([
        'Patient ID,Name,Age,Sex,Phone,Last visit,Dentist,Visits,Balance (USD)',
        ranaRow(),
        [ranad.displayNumber, 'Ranad Plain', '', '', phoneCell(ranad), '', '', '', '0.00'].join(
          ',',
        ),
      ]);
      expect(formatPhone(rana.phone)).toBe('+961 71 123 456');
    });

    it('writes a credit as a negative number, unguarded', async () => {
      const lines = csvLines((await exportCsv(clinic.owner, 'q=omar')).text);
      expect(lines[1]).toBe(
        [omar.displayNumber, 'Omar Other', '', 'Male', phoneCell(omar), '', '', '', '-50.00'].join(
          ',',
        ),
      );
    });

    it('localises the header and the sex values from Accept-Language', async () => {
      const arabic = csvLines((await exportCsv(clinic.owner, 'q=rana', 'ar-LB,ar;q=0.9')).text);
      expect(arabic[0]).toBe(
        'رقم المريض,الاسم,العمر,الجنس,الهاتف,آخر زيارة,الطبيب,الزيارات,الرصيد (USD)',
      );
      expect(arabic[1]?.split(',')[3]).toBe('أنثى');
      const french = csvLines((await exportCsv(clinic.owner, 'q=rana', 'fr')).text);
      expect(french[0]?.startsWith('N° patient,Nom,Âge,Sexe,')).toBe(true);
      const german = csvLines((await exportCsv(clinic.owner, 'q=rana', 'de')).text);
      expect(german[0]?.startsWith('Patient ID,')).toBe(true);
    });

    it('exports exactly the selected ids, in the given order', async () => {
      const response = await exportCsv(clinic.owner, `ids=${ranad.id},${newId()},${rana.id}`);
      expect(response.status).toBe(200);
      const lines = csvLines(response.text);
      expect(lines.slice(1).map((line) => line.split(',')[0])).toEqual([
        ranad.displayNumber,
        rana.displayNumber,
      ]);
      expect(lines[2]).toBe(ranaRow());
    });

    it('sorts and filters like the list, owing and balance included', async () => {
      const byBalance = csvLines((await exportCsv(clinic.owner, 'sort=balance&dir=desc')).text);
      expect(byBalance.slice(1).map((line) => line.split(',')[1])).toEqual([
        'Rana Haddad',
        'Ranad Plain',
        'Omar Other',
      ]);
      const owing = csvLines((await exportCsv(clinic.owner, 'view=owing')).text);
      expect(owing.slice(1).map((line) => line.split(',')[1])).toEqual(['Rana Haddad']);
      const nothing = csvLines((await exportCsv(clinic.owner, 'q=nobody')).text);
      expect(nothing).toHaveLength(1);
    });

    it('guards a formula-looking name with a leading quote', async () => {
      const evil = await createPatient(clinic.owner, {
        fullName: '=HYPERLINK("http://evil.example","Click")',
      });
      const lines = csvLines((await exportCsv(clinic.owner, `ids=${evil.id}`)).text);
      expect(
        lines[1]?.startsWith(
          `${evil.displayNumber},"'=HYPERLINK(""http://evil.example"",""Click"")",`,
        ),
      ).toBe(true);
    });

    it('streams 1,200 patients in full (pages of 500)', async () => {
      const bulk = await provision('Bulk Export Clinic');
      await database.ownerPool.query(
        `insert into patients
           (id, tenant_id, display_number, full_name, name_key, phone, phone_search)
         select gen_random_uuid(), $1, 'P-' || lpad(g::text, 6, '0'),
                'Bulk ' || lpad(g::text, 4, '0'), 'bulk ' || lpad(g::text, 4, '0'),
                '+96171000000', '96171000000 71000000'
         from generate_series(1, 1200) as g`,
        [bulk.tenant.id],
      );
      const response = await exportCsv(bulk.owner, 'view=active');
      expect(response.status).toBe(200);
      const rows = csvLines(response.text).slice(1);
      expect(rows).toHaveLength(1200);
      const names = rows.map((row) => row.split(',')[1]);
      expect(new Set(names).size).toBe(1200);
      expect(names[0]).toBe('Bulk 0001');
      expect(names[499]).toBe('Bulk 0500');
      expect(names[500]).toBe('Bulk 0501');
      expect(names[1199]).toBe('Bulk 1200');
    });
  });

  describe('merge re-point', () => {
    it('moves the dropped patient’s entries to the kept one, as an audited job, once', async () => {
      const clinic = await provision('Merge Ledger Clinic');
      const keep = await openWithBalance(clinic.owner, { fullName: 'Keep Kareem' }, '50.00');
      const drop = await openWithBalance(clinic.owner, { fullName: 'Drop Kareem' }, '100.00');
      const billing = testApp.app.get(BillingService);
      const repoint = vi.spyOn(billing, 'repointMergedEntries');
      try {
        expect((await merge(clinic.owner, keep.id, drop.id)).status).toBe(200);
        await vi.waitFor(
          async () => {
            expect(await ledgerOwners(clinic.tenant.id)).toEqual([
              { patient_id: keep.id, amount: '50.00' },
              { patient_id: keep.id, amount: '100.00' },
            ]);
          },
          { timeout: 15_000, interval: 100 },
        );
        expect(await balanceOf(clinic.owner, keep.id)).toEqual([
          { amount: '150.00', currency: 'USD' },
        ]);
        expect(await balanceOf(clinic.owner, drop.id)).toEqual([]);

        const session = (await clinic.owner.get('/api/v1/session')).body as Session;
        const audit = await database.ownerPool.query(
          `select actor_kind, actor_user_id, resource_type, resource_id, after
           from audit_log where tenant_id = $1 and action = 'ledger_entry.repoint'`,
          [clinic.tenant.id],
        );
        expect(audit.rows).toEqual([
          {
            actor_kind: 'job',
            actor_user_id: session.user.id,
            resource_type: 'patient',
            resource_id: keep.id,
            after: { droppedId: drop.id, count: 1 },
          },
        ]);

        // The same event again (a replay): the job id is taken, so nothing runs a second time.
        const queue = testApp.app.get<Queue>(getQueueToken(BILLING_QUEUE));
        const job = await queue.getJob(`${clinic.tenant.id}_merge_${drop.id}`);
        expect(job?.returnvalue).toEqual({ moved: 1 });
        const replay: PatientsMerged = {
          id: newId(),
          name: PATIENTS_MERGED,
          occurredAt: new Date().toISOString(),
          tenantId: clinic.tenant.id,
          actor: { userId: session.user.id, kind: 'user', platformAdmin: false },
          requestId: null,
          payload: { keptId: keep.id, droppedId: drop.id },
        };
        await testApp.app.get(MergeLedgerSubscriber).onPatientsMerged(replay);
        await vi.waitFor(
          async () => {
            const counts = await queue.getJobCounts('waiting', 'delayed', 'active');
            expect(counts).toMatchObject({ waiting: 0, delayed: 0, active: 0 });
          },
          { timeout: 10_000 },
        );
        expect(repoint).toHaveBeenCalledOnce();
        expect(repoint).toHaveBeenCalledWith(keep.id, drop.id);
      } finally {
        repoint.mockRestore();
      }
    });

    it('lets a merge wait for an in-flight ledger write, then moves that entry too', async () => {
      const clinic = await provision('Merge Race Clinic');
      const keep = await createPatient(clinic.owner, { fullName: 'Race Keep' });
      const drop = await openWithBalance(clinic.owner, { fullName: 'Race Drop' }, '100.00');
      const session = (await clinic.owner.get('/api/v1/session')).body as Session;

      const writer = await database.ownerPool.connect();
      let merging: Promise<{ status: number }> | undefined;
      try {
        await writer.query('begin');
        // What a ledger write does: the patient row FOR SHARE, then the entry, in one transaction.
        await writer.query('select id from patients where id = $1 for share', [drop.id]);
        await writer.query(
          `insert into ledger_entries
             (id, tenant_id, patient_id, kind, amount, currency, effective_date, reason, created_by)
           values (gen_random_uuid(), $1, $2, 'adjustment', 5.00, 'USD', $3, 'late fee', $4)`,
          [clinic.tenant.id, drop.id, TODAY, session.user.id],
        );
        merging = merge(clinic.owner, keep.id, drop.id).then((response) => response);
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
        await writer.query('commit');
      } catch (error) {
        await writer.query('rollback');
        throw error;
      } finally {
        writer.release();
      }
      expect((await merging).status).toBe(200);
      await vi.waitFor(
        async () => {
          expect(await ledgerOwners(clinic.tenant.id)).toEqual([
            { patient_id: keep.id, amount: '5.00' },
            { patient_id: keep.id, amount: '100.00' },
          ]);
        },
        { timeout: 15_000, interval: 100 },
      );
      expect(await balanceOf(clinic.owner, keep.id)).toEqual([
        { amount: '105.00', currency: 'USD' },
      ]);
    });
  });

  describe('routes', () => {
    it('serves owing-count and export next to /:id/balance without either capturing the other', async () => {
      const clinic = await provision('Routes Clinic');
      const patient = await openWithBalance(clinic.owner, { fullName: 'Route Patient' }, '7.00');
      expect(await owingCount(clinic.owner)).toBe(1);
      const csv = await exportCsv(clinic.owner, '');
      expect(csv.status).toBe(200);
      expect(csv.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(await balanceOf(clinic.owner, patient.id)).toEqual([
        { amount: '7.00', currency: 'USD' },
      ]);
      expect((await clinic.owner.get('/api/v1/billing/patients/owing-count/balance')).status).toBe(
        400,
      );
    });

    it('answers invalid queries with 400 problem details', async () => {
      const clinic = await provision('Bad Query Clinic');
      expect((await clinic.owner.get('/api/v1/billing/patients?size=7')).status).toBe(400);
      const badIds = await clinic.owner.get('/api/v1/billing/patients/export?ids=nope');
      expect(badIds.status).toBe(400);
      expect(badIds.headers['content-type']).toContain('application/problem+json');
    });
  });

  describe('permissions', () => {
    let clinic: Clinic;

    beforeAll(async () => {
      clinic = await provision('Views Permissions Clinic');
      await openWithBalance(clinic.owner, { fullName: 'Perm Patient' }, '9.00');
    });

    const routes = ['/api/v1/billing/patients', '/api/v1/billing/patients/owing-count'];

    it('refuses a role without payment:read (403 at the route)', async () => {
      const reader = await agentWith(clinic, ['patient:read', 'user:read']);
      for (const route of routes) expect((await reader.get(route)).status, route).toBe(403);
      const csv = await exportCsv(reader, 'view=active');
      expect(csv.status).toBe(403);
      expect(csv.headers['content-type']).toContain('application/problem+json');
      expect((await reader.get('/api/v1/patients')).status).toBe(200);
    });

    it('refuses a role without patient:read (403 from the service re-check)', async () => {
      const payer = await agentWith(clinic, ['payment:read', 'user:read']);
      for (const route of [...routes, '/api/v1/billing/patients?view=owing&sort=balance']) {
        const response = await payer.get(route);
        expect(response.status, route).toBe(403);
        expect(response.body).toMatchObject({ code: 'forbidden' });
      }
      const csv = await exportCsv(payer, 'view=active');
      expect(csv.status).toBe(403);
      expect(csv.headers['content-type']).toContain('application/problem+json');
      expect(csv.headers['content-disposition']).toBeUndefined();
    });
  });
});
