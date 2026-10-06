import type {
  Branch,
  ClinicalSummary,
  DiagnosisItem,
  DiagnosisResult,
  LastVisit,
  Patient,
  PatientChart,
  PlanResult,
  ProblemDetails,
  ServiceItem,
  ServiceResult,
  StaffUser,
  StartVisitResult,
  Tenant,
  ToothHistory,
  Visit,
  VisitResult,
} from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../src/platform/kernel/id';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { createPlatformAdmin, signIn, signInAndSetPassword, uniqueEmail } from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';

const TEMPORARY = 'temporary-pw-1';

/** Beirut is UTC+3 in June: the tenant's today is 2026-06-10 all day at this instant. */
const NOON = '2026-06-10T09:00:00Z';
const TODAY = '2026-06-10';
/**
 * The dates of the earlier completed visits: made through the API by `completedOn` where the
 * test is about what a completion leaves behind, else written directly as fixtures.
 */
const EARLIER = '2026-06-01';
const EARLIEST = '2026-05-01';

interface Staff {
  agent: TestAgent;
  user: StaffUser;
}

interface CompletedVisit {
  localDate: string;
  notes?: string;
  total?: string;
  durationMinutes?: number;
}

interface CompletedService {
  item: ServiceItem;
  toothCode?: string;
  surfaces?: string[];
  base?: string;
  discount?: string;
  removed?: boolean;
}

const problem = (body: unknown) => body as ProblemDetails;

describe('clinical: the patient chart, tooth history, last visit and summary', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let admin: TestAgent;
  let tenant: Tenant;
  let owner: TestAgent;
  let branch: Branch;
  let dentist: Staff;
  let frontdesk: Staff;
  let service: Record<'fill' | 'crown' | 'clean', ServiceItem>;
  let diagnosis: Record<'caries' | 'fracture', DiagnosisItem>;

  const createStaff = async (role: 'dentist' | 'frontdesk'): Promise<Staff> => {
    const email = uniqueEmail(role);
    const response = await owner.post('/api/v1/users').send({
      displayName: `The ${role} ${newId().slice(-6)}`,
      email,
      practitionerType: role,
      roleKeys: [role],
      branchIds: [branch.id],
      temporaryPassword: TEMPORARY,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const agent = await signInAndSetPassword(testApp.app, email, TEMPORARY);
    return { agent, user: response.body as StaffUser };
  };

  const createPatient = async (fullName: string, dateOfBirth?: string): Promise<Patient> => {
    const response = await owner
      .post('/api/v1/patients')
      .send({ fullName, phone: '71 000 000', ...(dateOfBirth && { dateOfBirth }) });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as Patient;
  };

  const startVisit = async (patient: Patient): Promise<Visit> => {
    const response = await dentist.agent
      .post('/api/v1/visits')
      .send({ patientId: patient.id, dentistId: dentist.user.profileId });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return (response.body as StartVisitResult).visit;
  };

  /**
   * A visit of `patient` started at 09:00 UTC on `date` (noon in Beirut) and completed through the
   * API `minutes` later, with `work` done while it is live; the clock then returns to `NOON`. Going
   * back in time never idles a session, so the agents stay signed in.
   */
  const completedOn = async (
    patient: Patient,
    date: string,
    work: (visit: Visit) => Promise<void>,
    minutes = 30,
  ): Promise<Visit> => {
    testApp.clock.set(new Date(`${date}T09:00:00Z`));
    const visit = await startVisit(patient);
    await work(visit);
    testApp.clock.advance({ minutes });
    const response = await dentist.agent.post(visitPath(visit.id, 'complete'));
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    testApp.clock.set(new Date(NOON));
    return (response.body as VisitResult).visit;
  };

  /** A completed visit written directly, completed at 10:00 UTC on its local date. */
  const completedVisit = async (patient: Patient, visit: CompletedVisit): Promise<string> => {
    const id = newId();
    const total = visit.total ?? '0';
    await database.ownerPool.query(
      `with minted as (
         insert into visit_counters (tenant_id, last_value) values ($2, 1)
         on conflict (tenant_id) do update set last_value = visit_counters.last_value + 1
         returning last_value
       )
       insert into visits (id, tenant_id, display_number, patient_id, branch_id, dentist_id,
                           started_by, status, local_date, started_at, completed_at, completed_by,
                           duration_minutes, notes, currency, subtotal, discount_amount, total)
       select $1, $2, minted.last_value, $3, $4, $5, $6, 'completed', $7::date, $8::timestamptz,
              $9::timestamptz, $6, $10, $11, 'USD', $12::numeric, 0, $12::numeric
       from minted`,
      [
        id,
        tenant.id,
        patient.id,
        branch.id,
        dentist.user.profileId,
        dentist.user.id,
        visit.localDate,
        `${visit.localDate}T09:30:00Z`,
        `${visit.localDate}T10:00:00Z`,
        visit.durationMinutes ?? 30,
        visit.notes ?? '',
        total,
      ],
    );
    return id;
  };

  /** A service of a visit written directly, in the order the calls are made. */
  const completedService = async (visitId: string, line: CompletedService): Promise<string> => {
    const id = newId();
    await database.ownerPool.query(
      `insert into visit_services (id, tenant_id, visit_id, procedure_id, code, name, charge_unit,
                                   tooth_code, surfaces, base_amount, discount_amount, recorded_by,
                                   deleted_at, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               case when $13 then now() end, clock_timestamp())`,
      [
        id,
        tenant.id,
        visitId,
        line.item.id,
        line.item.code,
        line.item.name,
        line.item.chargeUnit,
        line.toothCode ?? null,
        line.surfaces ?? [],
        line.base ?? line.item.price.amount,
        line.discount ?? '0',
        dentist.user.id,
        line.removed ?? false,
      ],
    );
    return id;
  };

  const olderDiagnosis = async (patient: Patient, visitId: string, toothCode: string) => {
    const id = newId();
    await database.ownerPool.query(
      `insert into patient_diagnoses (id, tenant_id, patient_id, tooth_code, diagnosis_id, code, name,
                                      dentist_id, recorded_by, recorded_in_visit_id, recorded_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        tenant.id,
        patient.id,
        toothCode,
        diagnosis.caries.id,
        diagnosis.caries.code,
        diagnosis.caries.name,
        dentist.user.profileId,
        dentist.user.id,
        visitId,
        `${EARLIER}T09:40:00Z`,
      ],
    );
    return id;
  };

  const visitPath = (visitId: string, rest: string) => `/api/v1/visits/${visitId}/${rest}`;
  const patientPath = (patientId: string, rest: string) =>
    `/api/v1/clinical/patients/${patientId}/${rest}`;

  const created = async <TResult>(request: Promise<{ status: number; body: unknown }>) => {
    const response = await request;
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as TResult;
  };

  const read = async <TResult>(path: string, agent: TestAgent = dentist.agent) => {
    const response = await agent.get(path);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body as TResult;
  };

  const chartOf = (patient: Patient) => read<PatientChart>(patientPath(patient.id, 'chart'));

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    testApp.clock.set(new Date(NOON));
    admin = await signIn(testApp.app, await createPlatformAdmin(testApp.app), undefined, {
      rememberMe: true,
    });
    const ownerEmail = uniqueEmail('owner');
    const provisioned = await admin.post('/api/v1/platform/tenants').send({
      clinic: { name: 'Chart Clinic', slug: `chart-${newId().slice(-12)}` },
      firstBranch: { name: 'Chart Main' },
      owner: { displayName: 'Chart Owner', email: ownerEmail, temporaryPassword: TEMPORARY },
    });
    expect(provisioned.status, JSON.stringify(provisioned.body)).toBe(201);
    tenant = provisioned.body as Tenant;
    owner = await signInAndSetPassword(testApp.app, ownerEmail, TEMPORARY);
    const [first] = (await owner.get('/api/v1/branches')).body as Branch[];
    if (!first) throw new Error('provisioning created no branch');
    branch = first;

    const services = await owner.put('/api/v1/catalog/services').send({
      items: [
        { code: 'ZFILL', name: 'Test filling', chargeUnit: 'per_tooth', price: '50' },
        { code: 'ZCROWN', name: 'Test crown', chargeUnit: 'per_tooth', price: '120' },
        { code: 'ZCLEAN', name: 'Test cleaning', chargeUnit: 'per_mouth', price: '30' },
      ],
    });
    expect(services.status, JSON.stringify(services.body)).toBe(200);
    const byCode = (code: string) => {
      const found = (services.body as ServiceItem[]).find((item) => item.code === code);
      if (!found) throw new Error(`no service ${code}`);
      return found;
    };
    service = { fill: byCode('ZFILL'), crown: byCode('ZCROWN'), clean: byCode('ZCLEAN') };

    const diagnoses = await owner.put('/api/v1/catalog/diagnoses').send({
      items: [
        { code: 'ZCAR', name: 'Test caries' },
        { code: 'ZFRAC', name: 'Test fracture' },
      ],
    });
    expect(diagnoses.status, JSON.stringify(diagnoses.body)).toBe(200);
    const diagnosisByCode = (code: string) => {
      const found = (diagnoses.body as DiagnosisItem[]).find((item) => item.code === code);
      if (!found) throw new Error(`no diagnosis ${code}`);
      return found;
    };
    diagnosis = { caries: diagnosisByCode('ZCAR'), fracture: diagnosisByCode('ZFRAC') };

    dentist = await createStaff('dentist');
    frontdesk = await createStaff('frontdesk');
  });

  afterEach(() => {
    testApp.clock.set(new Date(NOON));
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  describe('chart', () => {
    it("derives the dentition from the age on the tenant's today, unless overridden", async () => {
      const child = await createPatient('Chart Child', '2018-01-15');
      const auto = await chartOf(child);
      expect(auto).toEqual({
        dentition: { stage: 'primary', source: 'auto', ageYears: 8 },
        toothStatus: [],
        diagnoses: [],
        plans: [],
        planGroups: [],
        history: [],
        liveVisitId: null,
        voidedVisitIds: [],
        teeth: [],
      });

      const override = await dentist.agent
        .put(`/api/v1/patients/${child.id}/dentition`)
        .send({ override: 'permanent' });
      expect(override.status, JSON.stringify(override.body)).toBe(200);
      expect((await chartOf(child)).dentition).toEqual({
        stage: 'permanent',
        source: 'override',
        ageYears: 8,
      });
    });

    it("counts the age on the tenant's date, not the UTC one", async () => {
      // 22:00 UTC on 06-09 is already 06-10 in Beirut: the patient's sixth birthday.
      testApp.clock.set(new Date('2026-06-09T22:00:00Z'));
      const child = await createPatient('Chart Sixth Birthday', '2020-06-10');
      expect((await chartOf(child)).dentition).toEqual({
        stage: 'primary',
        source: 'auto',
        ageYears: 6,
      });
    });

    it("reads a date of birth on the tenant's tomorrow as a newborn", async () => {
      const newborn = await createPatient('Chart Newborn', TODAY);
      testApp.clock.set(new Date('2026-06-09T09:00:00Z'));
      expect((await chartOf(newborn)).dentition).toEqual({
        stage: 'primary',
        source: 'auto',
        ageYears: 0,
      });
    });

    it('treats a patient without a date of birth as permanent', async () => {
      const adult = await createPatient('Chart No Birth Date');
      expect((await chartOf(adult)).dentition).toEqual({
        stage: 'permanent',
        source: 'auto',
        ageYears: null,
      });
    });

    it('lists the records, the completed history and the latest live visit, and derives the teeth', async () => {
      const patient = await createPatient('Chart Records');
      const earlier = await completedVisit(patient, { localDate: EARLIER, total: '75' });
      const filled = await completedService(earlier, {
        item: service.fill,
        toothCode: '16',
        surfaces: ['O'],
        discount: '5',
      });
      await completedService(earlier, { item: service.fill, toothCode: '17', removed: true });
      const cleaned = await completedService(earlier, { item: service.clean });
      const older = await olderDiagnosis(patient, earlier, '36');

      const visit = await startVisit(patient);
      // An older live visit (a merge can leave two): the chart follows the latest one.
      await database.ownerPool.query(
        `insert into visits (id, tenant_id, display_number, patient_id, branch_id, dentist_id,
                             started_by, status, local_date, started_at, currency)
         values ($1, $2, 1000000, $3, $4, $5, $6, 'in_progress', $7, $8, 'USD')`,
        [
          newId(),
          tenant.id,
          patient.id,
          branch.id,
          dentist.user.profileId,
          dentist.user.id,
          '2026-06-10',
          '2026-06-10T08:00:00Z',
        ],
      );
      const caries = await created<DiagnosisResult>(
        dentist.agent
          .post(visitPath(visit.id, 'diagnoses'))
          .send({ diagnosisId: diagnosis.caries.id, toothCode: '26', surfaces: ['O'] }),
      );
      const plan = await created<PlanResult>(
        dentist.agent
          .post(visitPath(visit.id, 'plans'))
          .send({ procedureId: service.fill.id, toothCode: '26', surfaces: ['O'] }),
      );
      await created<ServiceResult>(
        dentist.agent
          .post(visitPath(visit.id, 'services'))
          .send({ procedureId: service.crown.id, toothCode: '46' }),
      );
      const removed = await created<DiagnosisResult>(
        dentist.agent
          .post(visitPath(visit.id, 'diagnoses'))
          .send({ diagnosisId: diagnosis.fracture.id, toothCode: '27' }),
      );
      expect(
        (await dentist.agent.delete(visitPath(visit.id, `diagnoses/${removed.record.id}`))).status,
      ).toBe(200);
      expect(
        (await dentist.agent.put(visitPath(visit.id, 'teeth/14')).send({ present: 'primary' }))
          .status,
      ).toBe(200);

      const chart = await chartOf(patient);
      expect(chart.liveVisitId).toBe(visit.id);
      expect(chart.toothStatus).toEqual([{ position: '14', present: 'primary' }]);
      expect(chart.diagnoses.map((record) => record.id)).toEqual([older, caries.record.id]);
      expect(chart.diagnoses[0]).toMatchObject({
        recordedInVisitId: earlier,
        recordedDate: EARLIER,
        dentistName: dentist.user.displayName,
      });
      expect(chart.plans).toEqual([plan.record]);
      expect(chart.history).toEqual([
        {
          id: cleaned,
          visitId: earlier,
          visitDate: EARLIER,
          dentistName: dentist.user.displayName,
          code: 'ZCLEAN',
          name: 'Test cleaning',
          toothCode: null,
          jaw: null,
          surfaces: [],
          final: { amount: '30.00', currency: 'USD' },
          planId: null,
        },
        {
          id: filled,
          visitId: earlier,
          visitDate: EARLIER,
          dentistName: dentist.user.displayName,
          code: 'ZFILL',
          name: 'Test filling',
          toothCode: '16',
          jaw: null,
          surfaces: ['O'],
          final: { amount: '45.00', currency: 'USD' },
          planId: null,
        },
      ]);

      const tooth = (code: string) => chart.teeth.find((entry) => entry.code === code);
      expect(tooth('16')).toMatchObject({
        state: 'treated',
        surfaces: { O: 'treated' },
        historyCount: 1,
      });
      expect(tooth('26')).toMatchObject({
        state: 'planned',
        hasActiveDiagnosis: true,
        openPlanIds: [plan.record.id],
      });
      expect(tooth('46')).toMatchObject({ state: 'treated_today', wholeTooth: 'treated_today' });
      expect(tooth('36')).toMatchObject({ state: 'none', hasActiveDiagnosis: true });
      expect(tooth('17')).toBeUndefined();
      expect(tooth('27')).toBeUndefined();
    });

    it('lists the history across completed visits, the most recent visit first', async () => {
      const patient = await createPatient('Chart Two Visits');
      const addService = async (visit: Visit, toothCode: string) =>
        (
          await created<ServiceResult>(
            dentist.agent
              .post(visitPath(visit.id, 'services'))
              .send({ procedureId: service.fill.id, toothCode }),
          )
        ).record;
      let recent: ServiceResult['record'] | undefined;
      let older: ServiceResult['record'] | undefined;
      // The more recent visit is completed first, so only the completion time orders them.
      const recentVisit = await completedOn(patient, EARLIER, async (visit) => {
        recent = await addService(visit, '16');
      });
      const olderVisit = await completedOn(patient, EARLIEST, async (visit) => {
        older = await addService(visit, '26');
      });

      const { history } = await chartOf(patient);
      expect(history.map((line) => [line.id, line.visitId, line.visitDate])).toEqual([
        [recent?.id, recentVisit.id, EARLIER],
        [older?.id, olderVisit.id, EARLIEST],
      ]);
    });
  });

  describe('tooth history', () => {
    it("lists one tooth's diagnoses, then plans, then completed services", async () => {
      const patient = await createPatient('Tooth History');
      const fill = (visit: Visit, toothCode: string) =>
        created<ServiceResult>(
          dentist.agent
            .post(visitPath(visit.id, 'services'))
            .send({ procedureId: service.fill.id, toothCode }),
        );
      let done: ServiceResult | undefined;
      const earlier = await completedOn(patient, EARLIER, async (visit) => {
        done = await fill(visit, '46');
        await fill(visit, '45');
      });
      const visit = await startVisit(patient);
      const finding = await created<DiagnosisResult>(
        dentist.agent
          .post(visitPath(visit.id, 'diagnoses'))
          .send({ diagnosisId: diagnosis.caries.id, toothCode: '46' }),
      );
      testApp.clock.advance({ seconds: 10 });
      await created<DiagnosisResult>(
        dentist.agent
          .post(visitPath(visit.id, 'diagnoses'))
          .send({ diagnosisId: diagnosis.caries.id, toothCode: '47' }),
      );
      const plan = await created<PlanResult>(
        dentist.agent
          .post(visitPath(visit.id, 'plans'))
          .send({ procedureId: service.crown.id, toothCode: '46' }),
      );

      const history = await read<ToothHistory>(patientPath(patient.id, 'teeth/46/history'));
      expect(history.toothCode).toBe('46');
      expect(history.diagnoses.map((record) => record.id)).toEqual([finding.record.id]);
      expect(history.plans).toEqual([plan.record]);
      expect(history.plans[0]?.diagnosisRecordId).toBe(finding.record.id);
      expect(history.services.map((line) => [line.id, line.visitId, line.visitDate])).toEqual([
        [done?.record.id, earlier.id, EARLIER],
      ]);

      for (const code of ['19', '59', 'x']) {
        const response = await dentist.agent.get(patientPath(patient.id, `teeth/${code}/history`));
        expect(response.status, code).toBe(400);
        expect(problem(response.body).errors?.[0]?.path).toBe('toothCode');
      }
    });

    it('follows a plan recorded in one completed visit and performed in the next', async () => {
      const patient = await createPatient('Tooth Across Visits');
      let finding: DiagnosisResult | undefined;
      let plan: PlanResult | undefined;
      const first = await completedOn(patient, EARLIER, async (visit) => {
        finding = await created<DiagnosisResult>(
          dentist.agent
            .post(visitPath(visit.id, 'diagnoses'))
            .send({ diagnosisId: diagnosis.caries.id, toothCode: '36', surfaces: ['O'] }),
        );
        plan = await created<PlanResult>(
          dentist.agent
            .post(visitPath(visit.id, 'plans'))
            .send({ procedureId: service.crown.id, toothCode: '36' }),
        );
      });
      if (!finding || !plan) throw new Error('visit 1 recorded nothing');
      const planId = plan.record.id;

      const second = await startVisit(patient);
      const performed = await dentist.agent.post(visitPath(second.id, `plans/${planId}/perform`));
      expect(performed.status, JSON.stringify(performed.body)).toBe(200);
      const [line] = (performed.body as PlanResult).visit.services;
      expect(line).toMatchObject({ planId, toothCode: '36', final: { amount: '120.00' } });
      const done = await dentist.agent.post(visitPath(second.id, 'complete'));
      expect(done.status, JSON.stringify(done.body)).toBe(200);

      const history = await read<ToothHistory>(patientPath(patient.id, 'teeth/36/history'));
      expect(history.diagnoses).toEqual([
        expect.objectContaining({
          id: finding.record.id,
          recordedInVisitId: first.id,
          recordedDate: EARLIER,
        }),
      ]);
      expect(history.plans).toEqual([
        expect.objectContaining({
          id: planId,
          status: 'performed',
          diagnosisRecordId: finding.record.id,
          recordedInVisitId: first.id,
          performedInVisitId: second.id,
          performedAt: new Date(NOON).toISOString(),
        }),
      ]);
      expect(history.services).toEqual([
        expect.objectContaining({ id: line?.id, visitId: second.id, visitDate: TODAY }),
      ]);
      expect(await read<LastVisit>(patientPath(patient.id, 'last-visit'))).toMatchObject({
        id: second.id,
        date: TODAY,
        total: { amount: '120.00', currency: 'USD' },
      });
    });
  });

  describe('last visit', () => {
    it('is null without a completed visit, then the most recently completed one', async () => {
      const patient = await createPatient('Last Visit');
      const none = await dentist.agent.get(patientPath(patient.id, 'last-visit'));
      expect(none.status).toBe(200);
      expect(none.type).toBe('application/json');
      expect(none.body).toBeNull();

      const addService = async (visit: Visit, body: Record<string, unknown>) =>
        (
          await created<ServiceResult>(
            dentist.agent.post(visitPath(visit.id, 'services')).send(body),
          )
        ).record;
      const writeNotes = async (visit: Visit, notes: string) => {
        const response = await dentist.agent.patch(visitPath(visit.id, 'notes')).send({ notes });
        expect(response.status, JSON.stringify(response.body)).toBe(200);
      };
      // The most recent visit is completed first.
      const latest = await completedOn(
        patient,
        EARLIER,
        async (visit) => {
          await addService(visit, {
            procedureId: service.fill.id,
            toothCode: '16',
            surfaces: ['O'],
          });
          const removed = await addService(visit, {
            procedureId: service.fill.id,
            toothCode: '17',
          });
          const removal = await dentist.agent.delete(visitPath(visit.id, `services/${removed.id}`));
          expect(removal.status, JSON.stringify(removal.body)).toBe(200);
          const clean = await addService(visit, { procedureId: service.clean.id });
          const repriced = await dentist.agent
            .patch(visitPath(visit.id, `services/${clean.id}`))
            .send({ baseAmount: '25' });
          expect(repriced.status, JSON.stringify(repriced.body)).toBe(200);
          await writeNotes(visit, 'Check again in six months');
        },
        42,
      );
      // Completed after the latest one, so the order can only come from the completion time.
      await completedOn(patient, EARLIEST, async (visit) => {
        await addService(visit, { procedureId: service.clean.id });
        await writeNotes(visit, 'First');
      });
      await startVisit(patient);

      expect(await read<LastVisit>(patientPath(patient.id, 'last-visit'))).toEqual({
        id: latest.id,
        date: EARLIER,
        dentistName: dentist.user.displayName,
        durationMinutes: 42,
        total: { amount: '75.00', currency: 'USD' },
        services: [
          { name: 'Test filling', toothCode: '16', jaw: null },
          { name: 'Test cleaning', toothCode: null, jaw: null },
        ],
        notes: 'Check again in six months',
      });
    });
  });

  describe('summary', () => {
    it('counts completed visits, open records, treated teeth and performed services', async () => {
      const patient = await createPatient('Summary Counts');
      const first = await completedVisit(patient, { localDate: EARLIEST });
      const second = await completedVisit(patient, { localDate: EARLIER });
      await completedService(first, { item: service.fill, toothCode: '16' });
      await completedService(second, { item: service.fill, toothCode: '16' });
      await completedService(second, { item: service.crown, toothCode: '21' });
      await completedService(second, { item: service.clean });
      await completedService(second, { item: service.fill, toothCode: '31', removed: true });

      const visit = await startVisit(patient);
      const post = (rest: string, body: object = {}) =>
        dentist.agent.post(visitPath(visit.id, rest)).send(body);
      await created(post('services', { procedureId: service.fill.id, toothCode: '41' }));
      await created(post('diagnoses', { diagnosisId: diagnosis.caries.id, toothCode: '36' }));
      const resolved = await created<DiagnosisResult>(
        post('diagnoses', { diagnosisId: diagnosis.caries.id, toothCode: '37' }),
      );
      expect((await post(`diagnoses/${resolved.record.id}/resolve`)).status).toBe(200);
      const dropped = await created<DiagnosisResult>(
        post('diagnoses', { diagnosisId: diagnosis.caries.id, toothCode: '38' }),
      );
      expect(
        (await dentist.agent.delete(visitPath(visit.id, `diagnoses/${dropped.record.id}`))).status,
      ).toBe(200);
      await created(post('plans', { procedureId: service.fill.id, toothCode: '26' }));
      const performed = await created<PlanResult>(
        post('plans', { procedureId: service.fill.id, toothCode: '25' }),
      );
      expect((await post(`plans/${performed.record.id}/perform`)).status).toBe(200);
      const removedPlan = await created<PlanResult>(
        post('plans', { procedureId: service.fill.id, toothCode: '24' }),
      );
      expect(
        (await dentist.agent.delete(visitPath(visit.id, `plans/${removedPlan.record.id}`))).status,
      ).toBe(200);

      expect(await read<ClinicalSummary>(patientPath(patient.id, 'summary'))).toEqual({
        visits: 2,
        activeDiagnoses: 1,
        plannedProcedures: 1,
        teethTreated: 2,
        servicesPerformed: 4,
      });
    });
  });

  describe('catalog rows in use', () => {
    it('refuses to delete a catalog row a record uses (409 catalog.in_use) until it is removed', async () => {
      const catalog = await owner.put('/api/v1/catalog/services').send({
        items: [
          { code: 'ZUSED', name: 'Used service', chargeUnit: 'per_mouth', price: '10' },
          { code: 'ZFREE', name: 'Unused service', chargeUnit: 'per_mouth', price: '10' },
        ],
      });
      expect(catalog.status, JSON.stringify(catalog.body)).toBe(200);
      const find = (code: string) => {
        const found = (catalog.body as ServiceItem[]).find((item) => item.code === code);
        if (!found) throw new Error(`no service ${code}`);
        return found;
      };
      const used = find('ZUSED');
      const free = find('ZFREE');
      const patient = await createPatient('Catalog In Use');
      const visit = await startVisit(patient);
      const added = await created<ServiceResult>(
        dentist.agent.post(visitPath(visit.id, 'services')).send({ procedureId: used.id }),
      );

      const refused = await owner.delete(`/api/v1/catalog/services/${used.id}`);
      expect(refused.status, JSON.stringify(refused.body)).toBe(409);
      expect(problem(refused.body).code).toBe('catalog.in_use');
      expect((await owner.delete(`/api/v1/catalog/services/${free.id}`)).status).toBe(204);

      expect(
        (await dentist.agent.delete(visitPath(visit.id, `services/${added.record.id}`))).status,
      ).toBe(200);
      expect((await owner.delete(`/api/v1/catalog/services/${used.id}`)).status).toBe(204);
    });
  });

  describe('access', () => {
    it('lets front desk read every view', async () => {
      const patient = await createPatient('Chart Front Desk');
      for (const rest of ['chart', 'summary', 'last-visit', 'teeth/16/history']) {
        const response = await frontdesk.agent.get(patientPath(patient.id, rest));
        expect(response.status, rest).toBe(200);
      }
    });

    it("answers 404 patient.not_found for another tenant's patient", async () => {
      const otherOwnerEmail = uniqueEmail('owner');
      const other = await admin.post('/api/v1/platform/tenants').send({
        clinic: { name: 'Other Chart Clinic', slug: `chart-${newId().slice(-12)}` },
        firstBranch: { name: 'Other Main' },
        owner: { displayName: 'Other Owner', email: otherOwnerEmail, temporaryPassword: TEMPORARY },
      });
      expect(other.status, JSON.stringify(other.body)).toBe(201);
      const otherOwner = await signInAndSetPassword(testApp.app, otherOwnerEmail, TEMPORARY);
      const theirs = await otherOwner
        .post('/api/v1/patients')
        .send({ fullName: 'Someone Else', phone: '71 000 001' });
      expect(theirs.status, JSON.stringify(theirs.body)).toBe(201);
      const theirId = (theirs.body as Patient).id;

      for (const rest of ['chart', 'summary', 'last-visit', 'teeth/16/history']) {
        const response = await dentist.agent.get(patientPath(theirId, rest));
        expect(response.status, rest).toBe(404);
        expect(problem(response.body).code, rest).toBe('patient.not_found');
      }
    });
  });
});
