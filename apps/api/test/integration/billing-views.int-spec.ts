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
import { patientExportQuerySchema } from '@dcm/contracts';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BillingService } from '../../src/modules/billing';
import { BILLING_QUEUE } from '../../src/modules/billing/application/merge-ledger.worker';
import { PatientExportService } from '../../src/modules/billing/application/patient-export.service';
import { exportLabels } from '../../src/modules/billing/http/export-headers';
import { RequestContext } from '../../src/platform/cls/request-context';
import { newId } from '../../src/platform/kernel/id';
import { TenantJobs } from '../../src/platform/queue/tenant-jobs';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { createPlatformAdmin, signIn, signInAndSetPassword, uniqueEmail } from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';
import { asPlatformAdminIn } from '../support/tenants';

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
      // A foreign number: international format, which starts with `+`.
      omar = await openWithBalance(
        clinic.owner,
        { fullName: 'Omar Other', sex: 'male', phone: '+33 6 12 34 56 78' },
        '5.00',
      );
      await adjust(clinic.owner, omar.id, '-55.00');
    });

    const ranaRow = () =>
      [
        rana.displayNumber,
        'Rana Haddad',
        // Born 11 June 1990; the tenant's today is 10 June 2026.
        '35',
        'Female',
        // The tenant country's (LB) numbers in national format, unguarded.
        '71 123 456',
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
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(csvLines(response.text)).toEqual([
        'Patient ID,Name,Age,Sex,Phone,Last visit,Dentist,Visits,Balance (USD)',
        ranaRow(),
        [ranad.displayNumber, 'Ranad Plain', '', '', '03 123 456', '', '', '', '0.00'].join(','),
      ]);
    });

    it('writes a credit unguarded and a foreign phone internationally, guarded', async () => {
      const lines = csvLines((await exportCsv(clinic.owner, 'q=omar')).text);
      expect(lines[1]).toBe(
        [
          omar.displayNumber,
          'Omar Other',
          '',
          'Male',
          "'+33 6 12 34 56 78",
          '',
          '',
          '',
          '-50.00',
        ].join(','),
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

    it('takes the language from lang over Accept-Language', async () => {
      const french = csvLines((await exportCsv(clinic.owner, 'q=rana&lang=fr', 'ar')).text);
      expect(french[0]?.startsWith('N° patient,Nom,')).toBe(true);
      expect(french[1]?.split(',')[3]).toBe('Femme');
      const arabic = csvLines((await exportCsv(clinic.owner, 'q=rana&lang=ar')).text);
      expect(arabic[0]?.startsWith('رقم المريض,')).toBe(true);
      const blank = csvLines((await exportCsv(clinic.owner, 'q=rana&lang=', 'fr')).text);
      expect(blank[0]?.startsWith('N° patient,')).toBe(true);
      expect((await exportCsv(clinic.owner, 'q=rana&lang=de')).status).toBe(400);
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

    describe('1,200 patients', () => {
      let bulk: Clinic;

      /** Adds patients `Bulk <from>` to `Bulk <to>` straight into the table (fast fixtures). */
      const seed = (from: number, to: number) =>
        database.ownerPool.query(
          `insert into patients
             (id, tenant_id, display_number, full_name, name_key, phone, phone_search)
           select gen_random_uuid(), $1, 'P-' || lpad((g + 1)::text, 6, '0'),
                  'Bulk ' || lpad(g::text, 4, '0'), 'bulk ' || lpad(g::text, 4, '0'),
                  '+96171000000', '96171000000 71000000'
           from generate_series($2::int, $3::int) as g`,
          [bulk.tenant.id, from, to],
        );

      beforeAll(async () => {
        bulk = await provision('Bulk Export Clinic');
        await seed(1, 1200);
      });

      const namesOf = (csv: string) =>
        csvLines(csv)
          .slice(1)
          .map((row) => row.split(',')[1]);

      it('streams them in full, in chunks of 500', async () => {
        const response = await exportCsv(bulk.owner, 'view=active');
        expect(response.status).toBe(200);
        const names = namesOf(response.text);
        expect(names).toHaveLength(1200);
        expect(new Set(names).size).toBe(1200);
        expect(names[0]).toBe('Bulk 0001');
        expect(names[499]).toBe('Bulk 0500');
        expect(names[500]).toBe('Bulk 0501');
        expect(names[1199]).toBe('Bulk 1200');
      });

      it('exports the snapshot taken at the start: a row added mid-stream shifts nothing', async () => {
        const service = testApp.app.get(PatientExportService);
        const csv = await asPlatformAdminIn(testApp.app, bulk.tenant.id, async () => {
          const { chunks } = await service.open(
            patientExportQuerySchema.parse({ view: 'active' }),
            exportLabels('en'),
          );
          const parts: string[] = [];
          const first = await chunks.next();
          if (!first.done) parts.push(first.value);
          // Sorts first by name: with offset paging, the first chunk's last row would repeat.
          await seed(0, 0);
          for await (const chunk of chunks) parts.push(chunk);
          return parts.join('');
        });
        const names = namesOf(csv);
        expect(names).toHaveLength(1200);
        expect(new Set(names).size).toBe(1200);
        expect(names).not.toContain('Bulk 0000');
        expect(names[500]).toBe('Bulk 0501');
      });
    });
  });

  describe('merge re-point', () => {
    const repointAudit = async (tenantId: string) =>
      (
        await database.ownerPool.query<{ resource_id: string; after: unknown }>(
          `select actor_kind, actor_user_id, actor_platform_admin, resource_type, resource_id,
                  after
           from audit_log where tenant_id = $1 and action = 'ledger_entry.repoint'
           order by occurred_at, id`,
          [tenantId],
        )
      ).rows;

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
        expect(await repointAudit(clinic.tenant.id)).toEqual([
          {
            actor_kind: 'job',
            actor_user_id: session.user.id,
            actor_platform_admin: false,
            resource_type: 'patient',
            resource_id: keep.id,
            after: { droppedId: drop.id, keptId: keep.id, count: 1 },
          },
        ]);

        // The same job again (a replayed event): the job id is taken, so nothing runs twice.
        const queue = testApp.app.get<Queue>(getQueueToken(BILLING_QUEUE));
        const job = await queue.getJob(`${clinic.tenant.id}_merge_${drop.id}`);
        expect(job?.returnvalue).toEqual({ moved: 1 });
        await testApp.app.get(RequestContext).run(
          {
            requestId: newId(),
            actorKind: 'user',
            tenantId: clinic.tenant.id,
            userId: session.user.id,
          },
          () =>
            testApp.app
              .get(TenantJobs)
              .enqueue(
                queue,
                'merge-ledger',
                { keptId: keep.id, droppedId: drop.id },
                { jobId: `merge_${drop.id}` },
              ),
        );
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

    it("records a platform admin's merge as such on the job's audit entry", async () => {
      const clinic = await provision('Admin Merge Clinic');
      const keep = await openWithBalance(clinic.owner, { fullName: 'Admin Keep' }, '5.00');
      const drop = await openWithBalance(clinic.owner, { fullName: 'Admin Drop' }, '6.00');
      const merged = await admin
        .post('/api/v1/patients/merge')
        .set('X-Tenant-Id', clinic.tenant.id)
        .send({ keepId: keep.id, dropId: drop.id, reason: 'Support merge' });
      expect(merged.status, JSON.stringify(merged.body)).toBe(200);
      const adminId = ((await admin.get('/api/v1/session')).body as Session).user.id;
      await vi.waitFor(
        async () => {
          expect(await repointAudit(clinic.tenant.id)).toEqual([
            expect.objectContaining({
              actor_kind: 'job',
              actor_user_id: adminId,
              actor_platform_admin: true,
              resource_id: keep.id,
            }),
          ]);
        },
        { timeout: 15_000, interval: 100 },
      );
    });

    it('ends a merge chain on the survivor, whatever order its jobs run in', async () => {
      const clinic = await provision('Merge Chain Clinic');
      const a = await openWithBalance(clinic.owner, { fullName: 'Chain A' }, '10.00');
      const b = await openWithBalance(clinic.owner, { fullName: 'Chain B' }, '20.00');
      const c = await openWithBalance(clinic.owner, { fullName: 'Chain C' }, '30.00');
      const queue = testApp.app.get<Queue>(getQueueToken(BILLING_QUEUE));
      const billing = testApp.app.get(BillingService);
      const asJob = <T>(fn: () => Promise<T>) =>
        testApp.app
          .get(RequestContext)
          .run({ requestId: newId(), actorKind: 'job', tenantId: clinic.tenant.id }, fn);

      await queue.pause();
      try {
        // J1: A merged into B. J2: B merged into C. Both wait in the paused queue.
        expect((await merge(clinic.owner, b.id, a.id)).status).toBe(200);
        expect((await merge(clinic.owner, c.id, b.id)).status).toBe(200);
        // J2 first, then J1: J1's kept patient (B) is merged away by then; its survivor is C.
        expect(await asJob(() => billing.repointMergedEntries(c.id, b.id))).toBe(1);
        expect(await asJob(() => billing.repointMergedEntries(b.id, a.id))).toBe(1);
      } finally {
        await queue.resume();
      }
      expect(await ledgerOwners(clinic.tenant.id)).toEqual([
        { patient_id: c.id, amount: '10.00' },
        { patient_id: c.id, amount: '20.00' },
        { patient_id: c.id, amount: '30.00' },
      ]);
      expect(await balanceOf(clinic.owner, c.id)).toEqual([{ amount: '60.00', currency: 'USD' }]);
      const audit = await repointAudit(clinic.tenant.id);
      expect(audit.map((entry) => entry.resource_id)).toEqual([c.id, c.id]);
      expect(audit.map((entry) => entry.after)).toEqual([
        { droppedId: b.id, keptId: c.id, count: 1 },
        { droppedId: a.id, keptId: b.id, count: 1 },
      ]);

      // The queued jobs then run and find nothing left to move.
      for (const dropped of [a.id, b.id]) {
        await vi.waitFor(
          async () => {
            const job = await queue.getJob(`${clinic.tenant.id}_merge_${dropped}`);
            expect(job?.returnvalue).toEqual({ moved: 0 });
          },
          { timeout: 15_000, interval: 100 },
        );
      }
      expect(await balanceOf(clinic.owner, c.id)).toEqual([{ amount: '60.00', currency: 'USD' }]);
    });

    it('moves nothing when the kept patient is not in this tenant', async () => {
      const clinic = await provision('Merge Unknown Clinic');
      const drop = await openWithBalance(clinic.owner, { fullName: 'Lonely Drop' }, '10.00');
      const moved = await testApp.app
        .get(RequestContext)
        .run({ requestId: newId(), actorKind: 'job', tenantId: clinic.tenant.id }, () =>
          testApp.app.get(BillingService).repointMergedEntries(newId(), drop.id),
        );
      expect(moved).toBe(0);
      expect(await ledgerOwners(clinic.tenant.id)).toEqual([
        { patient_id: drop.id, amount: '10.00' },
      ]);
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
    it('moves nothing between two patients that were never merged', async () => {
      const clinic = await provision('Merge Mismatch Clinic');
      const kept = await openWithBalance(clinic.owner, { fullName: 'Live Kept' }, '10.00');
      const other = await openWithBalance(clinic.owner, { fullName: 'Live Other' }, '20.00');
      const moved = await testApp.app
        .get(RequestContext)
        .run({ requestId: newId(), actorKind: 'job', tenantId: clinic.tenant.id }, () =>
          testApp.app.get(BillingService).repointMergedEntries(kept.id, other.id),
        );
      expect(moved).toBe(0);
      expect(await ledgerOwners(clinic.tenant.id)).toEqual([
        { patient_id: kept.id, amount: '10.00' },
        { patient_id: other.id, amount: '20.00' },
      ]);
      expect(await repointAudit(clinic.tenant.id)).toEqual([]);
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
