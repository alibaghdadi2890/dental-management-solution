import type {
  Branch,
  ImportResult,
  Patient,
  PatientBalance,
  PatientChart,
  ProblemDetails,
  ServiceItem,
  StaffUser,
  Visit,
} from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../src/platform/kernel/id';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { createPlatformAdmin, signIn, signInAndSetPassword, uniqueEmail } from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';

const TEMPORARY = 'temporary-pw-1';
/** Beirut is UTC+3 in June: the tenant's today is 2026-06-10 all day at this instant. */
const NOON = '2026-06-10T09:00:00Z';

interface Clinic {
  owner: TestAgent;
  branch: Branch;
  dentist: StaffUser;
  dentistAgent: TestAgent;
}

describe('imports: services, patients and visits from a previous system (ADR-0053)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let admin: TestAgent;
  let main: Clinic;

  const ok = async <T>(request: Promise<{ status: number; body: unknown }>, status = 200) => {
    const response = await request;
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    return response.body as T;
  };

  const provision = async (name: string): Promise<Clinic> => {
    const ownerEmail = uniqueEmail('owner');
    await ok(
      admin.post('/api/v1/platform/tenants').send({
        clinic: { name, slug: `imp-${newId().slice(-12)}` },
        firstBranch: { name: `${name} Main` },
        owner: { displayName: `${name} Owner`, email: ownerEmail, temporaryPassword: TEMPORARY },
      }),
      201,
    );
    const owner = await signInAndSetPassword(testApp.app, ownerEmail, TEMPORARY);
    const [branch] = (await owner.get('/api/v1/branches')).body as Branch[];
    if (!branch) throw new Error('provisioning created no branch');
    const email = uniqueEmail('dentist');
    const dentist = await ok<StaffUser>(
      owner.post('/api/v1/users').send({
        displayName: 'Mahmoud Harb',
        email,
        practitionerType: 'dentist',
        roleKeys: ['dentist'],
        branchIds: [branch.id],
        temporaryPassword: TEMPORARY,
      }),
      201,
    );
    const dentistAgent = await signInAndSetPassword(testApp.app, email, TEMPORARY);
    return { owner, branch, dentist, dentistAgent };
  };

  const post = (clinic: Clinic, path: string, body: object) =>
    ok<ImportResult>(clinic.owner.post(`/api/v1/imports/${path}`).send(body));

  const patientRow = (externalId: string, extra: Record<string, unknown> = {}) => ({
    externalId,
    fullName: `Imported ${externalId}`,
    sex: 'female',
    dateOfBirth: '1990-05-01',
    phone: '71 123 456',
    ...extra,
  });

  const visitRow = (clinic: Clinic, externalId: string, extra: Record<string, unknown> = {}) => ({
    externalId,
    patientExternalId: 'PAT-V',
    branchId: clinic.branch.id,
    dentistId: clinic.dentist.profileId,
    date: '2026-01-02',
    startTime: '12:53',
    endTime: '13:04',
    lines: [{ serviceCode: 'CMP', tooth: '36', amount: '50' }],
    ...extra,
  });

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    testApp.clock.set(new Date(NOON));
    admin = await signIn(testApp.app, await createPlatformAdmin(testApp.app), undefined, {
      rememberMe: true,
    });
    main = await provision('Import Clinic');
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  describe('POST /imports/services', () => {
    it('adds the new codes, leaves the existing ones, and changes nothing on a dry run', async () => {
      const rows = [
        { code: 'CMP', name: 'Composite', chargeUnit: 'per_tooth', price: '50' },
        {
          code: 'PULPOT',
          name: 'Pulpotomy',
          category: 'Pediatric',
          chargeUnit: 'per_tooth',
          price: '75',
        },
      ];
      const dry = await post(main, 'services', { dryRun: true, rows });
      expect(dry.results.map(({ ref, status }) => [ref, status])).toEqual([
        ['CMP', 'exists'],
        ['PULPOT', 'created'],
      ]);
      expect(dry.results[1]?.id).toBeNull();
      const codes = async () =>
        ((await main.owner.get('/api/v1/catalog/services')).body as ServiceItem[]).map(
          (item) => item.code,
        );
      expect(await codes()).not.toContain('PULPOT');

      const real = await post(main, 'services', { rows });
      expect(real.results.map(({ status }) => status)).toEqual(['exists', 'created']);
      expect(await codes()).toContain('PULPOT');
      const again = await post(main, 'services', { rows });
      expect(again.results.map(({ status }) => status)).toEqual(['exists', 'exists']);
    });
  });

  describe('POST /imports/patients', () => {
    it('creates with the import key and the opening balance, archives, and re-runs as exists', async () => {
      const rows = [
        patientRow('PAT-A', {
          phone: '70 122 9951',
          medication: 'Iron supplements',
          allergies: ['Latex', 'latex'],
          openingBalance: { amount: '140', asOf: '2026-06-01' },
        }),
        patientRow('PAT-B', { phone: null, dateOfBirth: null, status: 'archived' }),
        // An opening balance dated after the tenant's today fails this row alone, rolled back.
        patientRow('PAT-C', { openingBalance: { amount: '10', asOf: '2026-06-11' } }),
      ];
      const dry = await post(main, 'patients', { dryRun: true, rows });
      expect(dry.results.map(({ status }) => status)).toEqual(['created', 'created', 'failed']);
      const search = async (q: string) =>
        ((await main.owner.get(`/api/v1/patients?q=${q}&status=all`)).body as { items: Patient[] })
          .items;
      expect(await search('Imported PAT')).toEqual([]);

      const real = await post(main, 'patients', { rows });
      const [a, b, c] = real.results;
      expect(a).toMatchObject({ ref: 'PAT-A', status: 'created' });
      expect(b).toMatchObject({ ref: 'PAT-B', status: 'created' });
      expect(c).toMatchObject({ ref: 'PAT-C', status: 'failed', id: null });
      expect(c?.issues[0]?.path).toContain('asOf');

      const imported = await ok<Patient>(main.owner.get(`/api/v1/patients/${a?.id ?? ''}`));
      expect(imported).toMatchObject({
        externalId: 'PAT-A',
        phone: '70 122 9951',
        medicalHistory: { medication: 'Iron supplements', allergies: [{ name: 'Latex' }] },
      });
      const [balance] = await ok<PatientBalance[]>(
        main.owner.get(`/api/v1/billing/balances?patientIds=${a?.id ?? ''}`),
      );
      expect(balance?.balances).toEqual([{ amount: '140.00', currency: 'USD' }]);
      const archived = await ok<Patient>(main.owner.get(`/api/v1/patients/${b?.id ?? ''}`));
      expect(archived.archivedAt).not.toBeNull();
      expect(await search('Imported PAT-C')).toEqual([]);

      const again = await post(main, 'patients', { rows: rows.slice(0, 2) });
      expect(again.results).toEqual([
        { ref: 'PAT-A', status: 'exists', id: a?.id, issues: [] },
        { ref: 'PAT-B', status: 'exists', id: b?.id, issues: [] },
      ]);
    });
  });

  describe('POST /imports/visits', () => {
    beforeAll(async () => {
      await post(main, 'patients', {
        rows: [patientRow('PAT-V', { openingBalance: { amount: '300', asOf: '2026-06-01' } })],
      });
    });

    it('writes a completed, imported visit with no charge, its chart, and plan work for a line not done', async () => {
      const row = visitRow(main, 'VIS-1', {
        notes: 'Treatment plan: BL3',
        lines: [
          { serviceCode: 'CMP', tooth: '36', amount: '50' },
          { serviceCode: 'EXT', tooth: '46', amount: '30' },
          { serviceCode: 'ZIR', tooth: '25', amount: '350', done: false },
        ],
      });
      const [result] = (await post(main, 'visits', { rows: [row] })).results;
      expect(result).toMatchObject({ ref: 'VIS-1', status: 'created' });
      const visit = await ok<Visit>(main.owner.get(`/api/v1/visits/${result?.id ?? ''}`));
      expect(visit).toMatchObject({
        status: 'completed',
        notes: 'Treatment plan: BL3',
        startedAt: '2026-01-02T10:53:00.000Z',
        durationMinutes: 11,
        money: { total: '80.00' },
      });
      expect(visit.services.map((line) => [line.code, line.toothCode])).toEqual([
        ['CMP', '36'],
        ['EXT', '46'],
      ]);

      // No charge: the opening balance already holds the money.
      const [balance] = await ok<PatientBalance[]>(
        main.owner.get(`/api/v1/billing/balances?patientIds=${visit.patientId}`),
      );
      expect(balance?.balances).toEqual([{ amount: '300.00', currency: 'USD' }]);

      const chart = await ok<PatientChart>(
        main.owner.get(`/api/v1/clinical/patients/${visit.patientId}/chart`),
      );
      expect(chart.presence.map((row) => [row.toothCode, row.presence])).toEqual([
        ['46', 'missing'],
      ]);
      const [plan] = chart.plans;
      expect(plan).toMatchObject({
        code: 'ZIR',
        toothCode: '25',
        status: 'in_progress',
        price: { amount: '0.00' },
        note: 'Charged 350 before the migration',
      });

      const again = await post(main, 'visits', { rows: [row] });
      expect(again.results[0]).toMatchObject({ status: 'exists', id: result?.id });

      // An imported visit was never charged here: amend and void do not apply (I9).
      const refused = await main.dentistAgent
        .post(`/api/v1/visits/${visit.id}/void`)
        .send({ expectedUpdatedAt: visit.updatedAt, reason: 'Wrong patient' });
      expect(refused.status).toBe(409);
      expect((refused.body as ProblemDetails).code).toBe('visit.imported');
    });

    it('reports a row on its own: an unknown patient, a target its service cannot have', async () => {
      const results = (
        await post(main, 'visits', {
          rows: [
            visitRow(main, 'VIS-2', { patientExternalId: 'PAT-NONE' }),
            visitRow(main, 'VIS-3', { lines: [{ serviceCode: 'CMP', amount: '50' }] }),
            visitRow(main, 'VIS-4', { lines: [], notes: 'tooth 36: GIC' }),
            visitRow(main, 'VIS-6', { startTime: null }),
            visitRow(main, 'VIS-7', { endTime: '12:00' }),
            // Ended within the minute it started: a visit of 1 minute.
            visitRow(main, 'VIS-9', { endTime: '12:53' }),
          ],
        })
      ).results;
      expect(results.map(({ status }) => status)).toEqual([
        'failed',
        'failed',
        'created',
        'failed',
        'failed',
        'created',
      ]);
      expect(results[3]?.issues).toMatchObject([{ path: 'startTime', code: 'required' }]);
      expect(results[4]?.issues).toMatchObject([{ path: 'endTime', code: 'before_start' }]);
      expect(results[0]?.issues).toMatchObject([
        { code: 'import.unknown_patient', path: 'patientExternalId' },
      ]);
      expect(results[1]?.issues).toMatchObject([
        { path: 'lines.0.tooth', code: 'target_mismatch' },
      ]);
    });

    it('takes a dentist who has left: a past visit is still theirs', async () => {
      const email = uniqueEmail('dentist');
      const leaver = await ok<StaffUser>(
        main.owner.post('/api/v1/users').send({
          displayName: 'Former Dentist',
          email,
          practitionerType: 'dentist',
          roleKeys: ['dentist'],
          branchIds: [main.branch.id],
          temporaryPassword: TEMPORARY,
        }),
        201,
      );
      await ok(main.owner.post(`/api/v1/users/${leaver.id}/deactivate`).send({ reason: 'Left' }));
      const [result] = (
        await post(main, 'visits', {
          rows: [visitRow(main, 'VIS-8', { dentistId: leaver.profileId })],
        })
      ).results;
      expect(result).toMatchObject({ status: 'created' });
    });

    it('dry-runs without writing', async () => {
      const [dry] = (await post(main, 'visits', { dryRun: true, rows: [visitRow(main, 'VIS-5')] }))
        .results;
      expect(dry).toMatchObject({ status: 'created', id: null });
      const [real] = (await post(main, 'visits', { rows: [visitRow(main, 'VIS-5')] })).results;
      expect(real).toMatchObject({ status: 'created' });
    });
  });

  it('needs import:run, and never reaches another clinic’s records', async () => {
    const denied = await main.dentistAgent
      .post('/api/v1/imports/patients')
      .send({ rows: [patientRow('PAT-X')] });
    expect(denied.status).toBe(403);

    const other = await provision('Other Clinic');
    const [visit] = (await post(other, 'visits', { rows: [visitRow(other, 'VIS-1')] })).results;
    expect(visit?.issues[0]?.code).toBe('import.unknown_patient');
    const [patient] = (await post(other, 'patients', { rows: [patientRow('PAT-A')] })).results;
    expect(patient).toMatchObject({ status: 'created' });
  });
});
