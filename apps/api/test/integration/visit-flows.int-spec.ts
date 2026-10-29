import type {
  AuditEntry,
  AuditPage,
  Branch,
  DiagnosisItem,
  DiagnosisResult,
  FileCitation,
  LastVisit,
  LiveVisitRef,
  Patient,
  PatientChartResult,
  PatientFile,
  PatientFiles,
  PatientHistoryConfirmation,
  PlanResult,
  ProblemDetails,
  ServiceItem,
  ServiceResult,
  StaffUser,
  StartOptions,
  StartVisitResult,
  Tenant,
  UploadTarget,
  Visit,
  VisitPage,
  VisitResult,
} from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../src/platform/kernel/id';
import { FakeObjectStorage, sampleStart } from '../support/fake-storage';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { createPlatformAdmin, signIn, signInAndSetPassword, uniqueEmail } from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';

const TEMPORARY = 'temporary-pw-1';
/** Beirut is UTC+3 in June: the tenant's today is 2026-06-10 all day at this instant. */
const NOON = '2026-06-10T09:00:00Z';

interface Staff {
  agent: TestAgent;
  user: StaffUser;
}

interface Clinic {
  tenant: Tenant;
  owner: TestAgent;
  branch: Branch;
  dentist: Staff;
}

const problem = (body: unknown) => body as ProblemDetails;

/**
 * Feature 10: visit types and their flow, the worklist, the automatic service, the treatment
 * plan's priority and acceptance, what a diagnosis was seen on, and the reads around them. The
 * clinics use the default catalog (EXAM, EMX, SCL, RCT, CMP, ZIR…).
 */
describe('clinical: visit flows (feature 10)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let storage: FakeObjectStorage;
  let admin: TestAgent;
  let main: Clinic;
  let assistant: Staff;
  let frontdesk: Staff;
  let services: Map<string, ServiceItem>;
  let deepCaries: DiagnosisItem;

  const createStaff = async (
    clinic: Pick<Clinic, 'owner' | 'branch'>,
    role: 'dentist' | 'assistant' | 'frontdesk',
  ): Promise<Staff> => {
    const email = uniqueEmail(role);
    const response = await clinic.owner.post('/api/v1/users').send({
      displayName: `The ${role} ${newId().slice(-6)}`,
      email,
      practitionerType: role,
      roleKeys: [role],
      branchIds: [clinic.branch.id],
      temporaryPassword: TEMPORARY,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return {
      agent: await signInAndSetPassword(testApp.app, email, TEMPORARY),
      user: response.body as StaffUser,
    };
  };

  const provision = async (name: string): Promise<Clinic> => {
    const ownerEmail = uniqueEmail('owner');
    const provisioned = await admin.post('/api/v1/platform/tenants').send({
      clinic: { name, slug: `flow-${newId().slice(-12)}` },
      firstBranch: { name: `${name} Main` },
      owner: { displayName: `${name} Owner`, email: ownerEmail, temporaryPassword: TEMPORARY },
    });
    expect(provisioned.status, JSON.stringify(provisioned.body)).toBe(201);
    const owner = await signInAndSetPassword(testApp.app, ownerEmail, TEMPORARY);
    const [branch] = (await owner.get('/api/v1/branches')).body as Branch[];
    if (!branch) throw new Error('provisioning created no branch');
    // The subscriber seeds after the provisioning commit; the button is idempotent.
    await owner.post('/api/v1/catalog/seed-default');
    return {
      tenant: provisioned.body as Tenant,
      owner,
      branch,
      dentist: await createStaff({ owner, branch }, 'dentist'),
    };
  };

  const ok = async <TResult>(
    request: Promise<{ status: number; body: unknown }>,
    status = 200,
  ): Promise<TResult> => {
    const response = await request;
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    return response.body as TResult;
  };

  const expectProblem = async (
    request: Promise<{ status: number; body: unknown }>,
    status: number,
    code: string,
  ) => {
    const response = await request;
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    expect(problem(response.body).code).toBe(code);
  };

  const createPatient = async (
    fullName: string,
    extra: Record<string, unknown> = {},
    clinic: Clinic = main,
  ): Promise<Patient> =>
    ok<Patient>(
      clinic.owner
        .post('/api/v1/patients')
        .set('Idempotency-Key', newId())
        .send({ fullName, phone: '71 000 000', ...extra }),
      201,
    );

  const start = (
    patient: Patient,
    body: Record<string, unknown>,
    clinic: Clinic = main,
    agent: TestAgent = clinic.dentist.agent,
  ) =>
    agent
      .post('/api/v1/visits')
      .send({ patientId: patient.id, dentistId: clinic.dentist.user.profileId, ...body });

  const started = async (
    patient: Patient,
    body: Record<string, unknown>,
    clinic: Clinic = main,
  ): Promise<Visit> => (await ok<StartVisitResult>(start(patient, body, clinic), 201)).visit;

  const path = (visit: { id: string }, rest: string) => `/api/v1/visits/${visit.id}/${rest}`;
  const record = (patient: Patient, rest: string) =>
    `/api/v1/clinical/patients/${patient.id}/${rest}`;
  const service = (code: string): ServiceItem => {
    const item = services.get(code);
    if (!item) throw new Error(`no service ${code} in the default catalog`);
    return item;
  };

  const complete = async (visit: Visit): Promise<Visit> => {
    // Under the idle timeout; then back to noon (going back in time never idles a session).
    testApp.clock.advance({ minutes: 10 });
    const { visit: completed } = await ok<VisitResult>(
      main.dentist.agent.post(path(visit, 'complete')),
    );
    testApp.clock.set(new Date(NOON));
    return completed;
  };

  /** Plans a treatment on the patient record; answers the plan it made. */
  const planOnRecord = async (patient: Patient, body: Record<string, unknown>) => {
    const { chart } = await ok<PatientChartResult>(
      main.dentist.agent.post(record(patient, 'plans')).send(body),
      201,
    );
    const plan = chart.plans.at(-1);
    if (!plan) throw new Error('no plan was made');
    return plan;
  };

  const auditOf = async (query: string): Promise<AuditEntry[]> =>
    ((await main.owner.get(`/api/v1/audit?${query}&limit=100`)).body as AuditPage).items;

  /** One saved file of `patient`: an X-ray, or with another `filename` what that is. */
  const savedFile = async (
    patient: Patient,
    clinic: Clinic = main,
    filename = 'pano.jpg',
  ): Promise<PatientFile> => {
    const agent = clinic.dentist.agent;
    const target = await ok<UploadTarget>(
      agent.post('/api/v1/files/uploads').send({
        patientId: patient.id,
        filename,
        mimeType: '',
        sizeBytes: 2048,
        preview: false,
      }),
      201,
    );
    storage.put(
      `tenants/${clinic.tenant.id}/uploads/${target.id}/original`,
      2048,
      sampleStart(filename),
    );
    const category = filename.endsWith('.pdf') ? 'other' : 'xray';
    const saved = await ok<PatientFiles>(
      agent
        .post('/api/v1/files')
        .send({ patientId: patient.id, files: [{ id: target.id, category }] }),
      201,
    );
    const [file] = saved.items;
    if (!file) throw new Error('save returned no file');
    return file;
  };

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    testApp.clock.set(new Date(NOON));
    storage = testApp.app.get(FakeObjectStorage);
    admin = await signIn(testApp.app, await createPlatformAdmin(testApp.app), undefined, {
      rememberMe: true,
    });
    main = await provision('Flows Clinic');
    assistant = await createStaff(main, 'assistant');
    frontdesk = await createStaff(main, 'frontdesk');
    const catalog = (await main.owner.get('/api/v1/catalog/services')).body as ServiceItem[];
    services = new Map(catalog.map((item) => [item.code, item]));
    const diagnoses = (await main.owner.get('/api/v1/catalog/diagnoses')).body as DiagnosisItem[];
    const deep = diagnoses.find((item) => item.code === 'DX-DEEP');
    if (!deep) throw new Error('no deep caries in the default catalog');
    deepCaries = deep;
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  describe('starting a visit', () => {
    it('opens each type on its first step with the service the catalog adds on it', async () => {
      const expectations = [
        ['examination', 'intake', ['EXAM']],
        ['emergency', 'complaint', ['EMX']],
        ['hygiene', 'perform', ['SCL']],
        ['consultation', 'intake', []],
        ['treatment', 'today', []],
      ] as const;
      for (const [type, step, codes] of expectations) {
        const visit = await started(await createPatient(`Type ${type}`), { type });
        expect(visit).toMatchObject({ type, currentStep: step, viewMode: 'steps', worklist: [] });
        expect(visit.services.map((line) => [line.code, line.autoAdded])).toEqual(
          codes.map((code) => [code, true]),
        );
      }
    });

    it('charges the automatic service at its catalog price, lets it be removed, and needs a type', async () => {
      const patient = await createPatient('Automatic Service');
      await expectProblem(start(patient, {}), 400, 'validation_failed');
      const visit = await started(patient, { type: 'examination', reason: '  Check-up  ' });
      expect(visit.reason).toBe('Check-up');
      const [exam] = visit.services;
      expect(exam).toMatchObject({
        code: 'EXAM',
        final: { amount: '25.00', currency: 'USD' },
        toothCode: null,
      });
      expect(visit.money.total).toBe('25.00');
      const removed = await ok<ServiceResult>(
        main.dentist.agent.delete(path(visit, `services/${exam?.id ?? ''}`)),
      );
      expect(removed.visit.services).toEqual([]);
    });

    it('lets a visit with only its untouched automatic service be discarded, not one someone priced', async () => {
      const untouched = await started(await createPatient('Wrong Patient'), { type: 'hygiene' });
      await ok(main.dentist.agent.post(path(untouched, 'discard')));

      const priced = await started(await createPatient('Priced Scaling'), { type: 'hygiene' });
      const [scaling] = priced.services;
      // Pricing a line is discounting (ADR-0055): the owner does it.
      await ok(
        main.owner
          .patch(path(priced, `services/${scaling?.id ?? ''}`))
          .send({ discountAmount: '10' }),
      );
      await expectProblem(main.dentist.agent.post(path(priced, 'discard')), 409, 'visit.not_empty');
    });

    it('stops adding a service once its Added on is cleared, and only takes a per-mouth one', async () => {
      const cons = service('CONS');
      const input = (item: ServiceItem, patch: Record<string, unknown>) => ({
        id: item.id,
        code: item.code,
        name: item.name,
        category: item.category,
        chargeUnit: item.chargeUnit,
        price: item.price.amount,
        frequent: item.frequent,
        active: item.active,
        toothEffect: item.toothEffect,
        addedOnVisitType: item.addedOnVisitType,
        typicalSessions: item.typicalSessions,
        ...patch,
      });
      await ok(
        main.owner
          .put('/api/v1/catalog/services')
          .send({ items: [input(cons, { addedOnVisitType: 'consultation' })] }),
      );
      const added = await started(await createPatient('Consult One'), { type: 'consultation' });
      expect(added.services.map((line) => line.code)).toEqual(['CONS']);

      await ok(
        main.owner
          .put('/api/v1/catalog/services')
          .send({ items: [input(cons, { addedOnVisitType: null })] }),
      );
      const none = await started(await createPatient('Consult Two'), { type: 'consultation' });
      expect(none.services).toEqual([]);

      const perTooth = await main.owner
        .put('/api/v1/catalog/services')
        .send({ items: [input(service('CMP'), { addedOnVisitType: 'examination' })] });
      expect(perTooth.status).toBe(400);
    });
  });

  describe('the worklist', () => {
    it('suggests Treatment; the visit starts with what is in progress and urgent, and the rest is ticked in it', async () => {
      const patient = await createPatient('Returning Patient', { firstVisitType: 'hygiene' });
      const before = await ok<StartOptions>(
        main.dentist.agent.get(`/api/v1/visits/start-options?patientId=${patient.id}`),
      );
      // No visit yet and nothing planned: what the patient was registered for.
      expect(before).toEqual({ suggestedType: 'hygiene' });

      const first = await started(patient, { type: 'treatment' });
      const rootCanal = await ok<ServiceResult>(
        main.dentist.agent
          .post(path(first, 'services'))
          .send({ procedureId: service('RCT').id, toothCode: '26' }),
        201,
      );
      const unfinished = await ok<PlanResult>(
        main.dentist.agent.post(path(first, `services/${rootCanal.record.id}/unfinished`)),
      );
      await complete(first);
      const elective = await planOnRecord(patient, {
        procedureId: service('CMP').id,
        toothCode: '24',
        priority: 'elective',
      });
      const crown = await planOnRecord(patient, {
        procedureId: service('ZIR').id,
        toothCode: '46',
        priority: 'urgent',
      });

      const options = await ok<StartOptions>(
        assistant.agent.get(`/api/v1/visits/start-options?patientId=${patient.id}`),
      );
      expect(options).toEqual({ suggestedType: 'treatment' });
      await expectProblem(
        frontdesk.agent.get(`/api/v1/visits/start-options?patientId=${patient.id}`),
        403,
        'forbidden',
      );

      // Nobody chose: the work in progress and the urgent crown; the elective filling waits.
      const visit = await started(patient, { type: 'treatment' });
      expect(visit.worklist).toEqual([{ planId: unfinished.record.id }, { planId: crown.id }]);
      // Picking work in progress logs nothing: the session comes from Not finished (ADR-0048).
      const picked = unfinished.visit.id;
      expect(picked).toBe(first.id);
      const chart = await ok<{ plans: { id: string; sessions: unknown[] }[] }>(
        main.dentist.agent.get(record(patient, 'chart')),
      );
      expect(chart.plans.find((plan) => plan.id === unfinished.record.id)?.sessions).toHaveLength(
        1,
      );

      // Today's work: the filling is ticked onto the list, the crown off it; twice changes
      // nothing.
      const ticked = await ok<VisitResult>(
        assistant.agent.put(path(visit, `worklist/${elective.id}`)),
      );
      expect(ticked.visit.worklist.map((item) => item.planId)).toEqual([
        unfinished.record.id,
        crown.id,
        elective.id,
      ]);
      await ok(main.dentist.agent.put(path(visit, `worklist/${elective.id}`)));
      const unticked = await ok<VisitResult>(
        main.dentist.agent.delete(path(visit, `worklist/${crown.id}`)),
      );
      expect(unticked.visit.worklist.map((item) => item.planId)).toEqual([
        unfinished.record.id,
        elective.id,
      ]);
      await ok(main.dentist.agent.delete(path(visit, `worklist/${crown.id}`)));
      const worklistRows = (await auditOf(`resourceType=visit&resourceId=${visit.id}`))
        .map((entry) => entry.action)
        .filter((action) => action.startsWith('visit.worklist'));
      expect(worklistRows.sort()).toEqual(['visit.worklist_add', 'visit.worklist_remove']);
      // Only an open plan of this patient goes on the list, and the front desk cannot tick.
      await expectProblem(
        main.dentist.agent.put(path(visit, `worklist/${newId()}`)),
        422,
        'visit.plan_invalid',
      );
      await expectProblem(
        frontdesk.agent.put(path(visit, `worklist/${crown.id}`)),
        403,
        'forbidden',
      );
      // A visit with only a worklist is still empty.
      await ok(main.dentist.agent.post(path(visit, 'discard')));
    });

    it('takes plans only in a treatment visit, and only the patient’s open ones', async () => {
      const patient = await createPatient('Plan Rules');
      const other = await createPatient('Someone Else');
      const theirs = await planOnRecord(other, {
        procedureId: service('CMP').id,
        toothCode: '16',
        priority: 'high',
      });
      const mine = await planOnRecord(patient, {
        procedureId: service('CMP').id,
        toothCode: '16',
        priority: 'high',
      });
      await expectProblem(
        start(patient, { type: 'examination', planIds: [mine.id] }),
        422,
        'visit.plans_not_allowed',
      );
      await expectProblem(
        start(patient, { type: 'treatment', planIds: [theirs.id] }),
        422,
        'visit.plan_invalid',
      );
      await ok(main.dentist.agent.post(record(patient, `plans/${mine.id}/cancel`)));
      await expectProblem(
        start(patient, { type: 'treatment', planIds: [mine.id] }),
        422,
        'visit.plan_invalid',
      );
    });

    it('gives a hygiene visit the patient’s open whole-mouth plans by itself', async () => {
      const patient = await createPatient('Hygiene Plans');
      const scaling = await planOnRecord(patient, {
        procedureId: service('SCL').id,
        priority: 'elective',
      });
      await planOnRecord(patient, {
        procedureId: service('CMP').id,
        toothCode: '16',
        priority: 'high',
      });
      const visit = await started(patient, { type: 'hygiene' });
      expect(visit.worklist).toEqual([{ planId: scaling.id }]);
      // An examination keeps no list.
      const other = await createPatient('No List');
      const mine = await planOnRecord(other, {
        procedureId: service('CMP').id,
        toothCode: '16',
        priority: 'high',
      });
      const examination = await started(other, { type: 'examination' });
      await expectProblem(
        main.dentist.agent.put(path(examination, `worklist/${mine.id}`)),
        422,
        'visit.plans_not_allowed',
      );
    });
  });

  describe('the flow of a live visit', () => {
    it('remembers the step and the view, and refuses a step the type never has', async () => {
      const patient = await createPatient('Paused On Findings');
      const visit = await started(patient, { type: 'examination' });
      const onFindings = await ok<VisitResult>(
        main.dentist.agent.patch(path(visit, 'step')).send({ step: 'findings' }),
      );
      expect(onFindings.visit.currentStep).toBe('findings');
      const all = await ok<VisitResult>(
        assistant.agent.patch(path(visit, 'view')).send({ viewMode: 'all' }),
      );
      expect(all.visit).toMatchObject({ currentStep: 'findings', viewMode: 'all' });
      await expectProblem(
        main.dentist.agent.patch(path(visit, 'step')).send({ step: 'today' }),
        422,
        'visit.step_invalid',
      );
      await expectProblem(
        frontdesk.agent.patch(path(visit, 'step')).send({ step: 'plan' }),
        403,
        'forbidden',
      );

      // Paused and read from elsewhere: the Today board's pill and the visits list agree.
      await ok(main.dentist.agent.post(path(visit, 'pause')));
      const [ref] = await ok<LiveVisitRef[]>(
        frontdesk.agent.get(`/api/v1/visits/live?patientId=${patient.id}`),
      );
      expect(ref).toMatchObject({ type: 'examination', currentStep: 'findings', status: 'paused' });
      const listed = await ok<VisitPage>(
        frontdesk.agent.get('/api/v1/visits?tab=in_progress&type=examination&limit=50'),
      );
      expect(listed.items.find((item) => item.id === visit.id)).toMatchObject({
        type: 'examination',
        currentStep: 'findings',
      });
      const hygieneOnly = await ok<VisitPage>(
        frontdesk.agent.get('/api/v1/visits?tab=in_progress&type=hygiene&limit=50'),
      );
      expect(hygieneOnly.items.map((item) => item.id)).not.toContain(visit.id);

      // Steps and the view are navigation: in the visit's own log, out of the Activity feed.
      const own = await auditOf(`resourceType=visit&resourceId=${visit.id}`);
      expect(own.map((entry) => entry.action)).toEqual(
        expect.arrayContaining(['visit.step', 'visit.view']),
      );
      const feed = await auditOf(`feed=true&visitId=${visit.id}`);
      expect(feed.map((entry) => entry.action)).not.toContain('visit.step');
    });

    it('opens an examination on its Perform step, with nothing performed yet', async () => {
      const patient = await createPatient('Treated On The Spot');
      const visit = await started(patient, { type: 'examination' });
      await ok(main.dentist.agent.patch(path(visit, 'step')).send({ step: 'perform' }));
      const [live] = await ok<LiveVisitRef[]>(
        main.dentist.agent.get(`/api/v1/visits/live?patientId=${patient.id}`),
      );
      expect(live?.currentStep).toBe('perform');
    });

    it('takes a reason on any visit, and a complaint on an emergency only', async () => {
      const emergency = await started(await createPatient('In Pain'), { type: 'emergency' });
      const reasoned = await ok<VisitResult>(
        main.dentist.agent
          .patch(path(emergency, 'reason'))
          .send({ reason: 'Throbbing pain lower left' }),
      );
      expect(reasoned.visit.reason).toBe('Throbbing pain lower left');
      const complained = await ok<VisitResult>(
        main.dentist.agent
          .patch(path(emergency, 'complaint'))
          .send({ painScore: 8, painSince: 'days_1_3' }),
      );
      expect(complained.visit).toMatchObject({ painScore: 8, painSince: 'days_1_3' });
      expect(
        (
          await main.dentist.agent
            .patch(path(emergency, 'complaint'))
            .send({ painScore: 11, painSince: null })
        ).status,
      ).toBe(400);

      const exam = await started(await createPatient('No Pain Score'), { type: 'examination' });
      await expectProblem(
        main.dentist.agent.patch(path(exam, 'complaint')).send({ painScore: 3, painSince: null }),
        422,
        'visit.complaint_not_allowed',
      );
      const cleared = await ok<VisitResult>(
        main.dentist.agent.patch(path(exam, 'reason')).send({ reason: '  ' }),
      );
      expect(cleared.visit.reason).toBeNull();
    });

    it('lets a dentist confirm the medical history in the visit, and says so on the record', async () => {
      const patient = await createPatient('Registered By Front Desk');
      const none = await ok<PatientHistoryConfirmation>(
        frontdesk.agent.get(record(patient, 'history-confirmation')),
      );
      expect(none).toEqual({ confirmation: null });

      const visit = await started(patient, { type: 'examination' });
      // An assistant charts in the visit but does not confirm the history.
      await expectProblem(
        assistant.agent.put(path(visit, 'history-confirmation')),
        403,
        'forbidden',
      );
      const confirmed = await ok<VisitResult>(
        main.dentist.agent.put(path(visit, 'history-confirmation')),
      );
      expect(confirmed.visit.historyConfirmation).toEqual({
        at: NOON.replace('Z', '.000Z'),
        by: main.dentist.user.id,
        byName: main.dentist.user.displayName,
      });
      // A second confirmation keeps the first.
      testApp.clock.advance({ minutes: 5 });
      const again = await ok<VisitResult>(
        main.dentist.agent.put(path(visit, 'history-confirmation')),
      );
      expect(again.visit.historyConfirmation?.at).toBe(confirmed.visit.historyConfirmation?.at);
      testApp.clock.set(new Date(NOON));

      expect(
        await ok<PatientHistoryConfirmation>(
          frontdesk.agent.get(record(patient, 'history-confirmation')),
        ),
      ).toEqual({
        confirmation: {
          at: NOON.replace('Z', '.000Z'),
          byName: main.dentist.user.displayName,
          visitId: visit.id,
        },
      });
      expect(
        (await auditOf(`resourceType=visit&resourceId=${visit.id}`)).map((entry) => entry.action),
      ).toContain('visit.history_confirm');

      const taken = await ok<VisitResult>(
        main.dentist.agent.delete(path(visit, 'history-confirmation')),
      );
      expect(taken.visit.historyConfirmation).toBeNull();
    });
  });

  describe('the treatment plan', () => {
    it('needs a priority, moves a plan between phases and records the patient’s acceptance', async () => {
      const patient = await createPatient('Phases');
      const noPriority = await main.dentist.agent
        .post(record(patient, 'plans'))
        .send({ procedureId: service('ZIR').id, toothCode: '46' });
      expect(noPriority.status).toBe(400);

      const crown = await planOnRecord(patient, {
        procedureId: service('ZIR').id,
        toothCode: '46',
        priority: 'high',
      });
      expect(crown).toMatchObject({ priority: 'high', acceptedAt: null, estimatedSessions: null });

      const urgent = await ok<PatientChartResult>(
        main.dentist.agent.patch(record(patient, `plans/${crown.id}`)).send({ priority: 'urgent' }),
      );
      expect(urgent.chart.plans[0]?.priority).toBe('urgent');

      await expectProblem(
        assistant.agent.put(record(patient, `plans/${crown.id}/acceptance`)),
        403,
        'forbidden',
      );
      const accepted = await ok<PatientChartResult>(
        main.dentist.agent.put(record(patient, `plans/${crown.id}/acceptance`)),
      );
      expect(accepted.chart.plans[0]?.acceptedAt).toBe(NOON.replace('Z', '.000Z'));
      const withdrawn = await ok<PatientChartResult>(
        main.dentist.agent.delete(record(patient, `plans/${crown.id}/acceptance`)),
      );
      expect(withdrawn.chart.plans[0]?.acceptedAt).toBeNull();

      const actions = (await auditOf(`resourceType=treatment_plan&resourceId=${crown.id}`)).map(
        (entry) => entry.action,
      );
      expect(actions).toEqual(
        expect.arrayContaining([
          'treatment_plan.prioritise',
          'treatment_plan.accept',
          'treatment_plan.unaccept',
        ]),
      );

      // Performing a plan nobody formally accepted accepts it; the acceptance then stands.
      const visit = await started(patient, { type: 'treatment', planIds: [crown.id] });
      const performed = await ok<PlanResult>(
        main.dentist.agent.post(path(visit, `plans/${crown.id}/perform`)),
      );
      expect(performed.record.acceptedAt).not.toBeNull();
      await expectProblem(
        main.dentist.agent.delete(record(patient, `plans/${crown.id}/acceptance`)),
        409,
        'plan.acceptance_locked',
      );
      await expectProblem(
        main.dentist.agent.patch(record(patient, `plans/${crown.id}`)).send({ priority: 'high' }),
        409,
        'plan.not_open',
      );
    });

    it('plans for the diagnosis named, and prioritises in a visit only that visit’s plans', async () => {
      const patient = await createPatient('For A Diagnosis');
      const older = await planOnRecord(patient, {
        procedureId: service('CMP').id,
        toothCode: '36',
        priority: 'elective',
      });
      const visit = await started(patient, { type: 'examination' });
      const first = await ok<DiagnosisResult>(
        main.dentist.agent
          .post(path(visit, 'diagnoses'))
          .send({ diagnosisId: deepCaries.id, toothCode: '24' }),
        201,
      );
      const second = await ok<DiagnosisResult>(
        main.dentist.agent
          .post(path(visit, 'diagnoses'))
          .send({ diagnosisId: deepCaries.id, toothCode: '24', surfaces: ['O'] }),
        201,
      );
      // Without a name the tooth's latest diagnosis is linked; with one, that one.
      const plan = await ok<PlanResult>(
        assistant.agent.post(path(visit, 'plans')).send({
          procedureId: service('CMP').id,
          toothCode: '24',
          priority: 'high',
          diagnosisRecordId: first.record.id,
        }),
        201,
      );
      expect(plan.record.diagnosisRecordId).toBe(first.record.id);
      expect(second.record.id).not.toBe(first.record.id);
      await expectProblem(
        main.dentist.agent.post(path(visit, 'plans')).send({
          procedureId: service('CMP').id,
          toothCode: '25',
          priority: 'high',
          diagnosisRecordId: first.record.id,
        }),
        422,
        'record.diagnosis_link_invalid',
      );

      const moved = await ok<PlanResult>(
        assistant.agent
          .patch(path(visit, `plans/${plan.record.id}/priority`))
          .send({ priority: 'urgent' }),
      );
      expect(moved.record.priority).toBe('urgent');
      await expectProblem(
        assistant.agent
          .patch(path(visit, `plans/${older.id}/priority`))
          .send({ priority: 'urgent' }),
        409,
        'plan.not_of_visit',
      );
    });
  });

  describe('what a diagnosis was seen on', () => {
    it('cites the clinical exam or one of the patient’s images, and lists the citations per file', async () => {
      const patient = await createPatient('Seen On');
      const stranger = await createPatient('Stranger Files');
      const panoramic = await savedFile(patient);
      const foreign = await savedFile(stranger);
      const visit = await started(patient, { type: 'examination' });

      const recorded = await ok<DiagnosisResult>(
        main.dentist.agent.post(path(visit, 'diagnoses')).send({
          diagnosisId: deepCaries.id,
          toothCode: '24',
          seenOn: { kind: 'image', fileId: panoramic.id },
        }),
        201,
      );
      expect(recorded.record.seenOn).toEqual({ kind: 'image', fileId: panoramic.id });

      // Another patient's file is refused, and nothing is written.
      await expectProblem(
        main.dentist.agent.post(path(visit, 'diagnoses')).send({
          diagnosisId: deepCaries.id,
          toothCode: '25',
          seenOn: { kind: 'image', fileId: foreign.id },
        }),
        422,
        'record.evidence_invalid',
      );
      await expectProblem(
        main.dentist.agent
          .patch(path(visit, `diagnoses/${recorded.record.id}/seen-on`))
          .send({ seenOn: { kind: 'image', fileId: foreign.id } }),
        422,
        'record.evidence_invalid',
      );
      // So is a document: a diagnosis is seen on an image.
      const consent = await savedFile(patient, main, 'consent.pdf');
      expect(consent.kind).toBe('document');
      await expectProblem(
        main.dentist.agent
          .patch(path(visit, `diagnoses/${recorded.record.id}/seen-on`))
          .send({ seenOn: { kind: 'image', fileId: consent.id } }),
        422,
        'record.evidence_invalid',
      );
      const chart = await ok<{ diagnoses: { toothCode: string }[] }>(
        main.dentist.agent.get(record(patient, 'chart')),
      );
      expect(chart.diagnoses.map((item) => item.toothCode)).toEqual(['24']);

      expect(
        await ok<FileCitation[]>(frontdesk.agent.get(record(patient, 'file-citations'))),
      ).toEqual([
        {
          fileId: panoramic.id,
          diagnoses: [
            {
              recordId: recorded.record.id,
              toothCode: '24',
              jaw: null,
              name: 'Deep caries',
              status: 'active',
            },
          ],
        },
      ]);

      // An archived file stays cited; the citation can be changed to the exam, or unsaid.
      await ok(
        main.dentist.agent
          .post('/api/v1/files/archive')
          .send({ ids: [panoramic.id], reason: 'Retaken' }),
      );
      expect(
        await ok<FileCitation[]>(frontdesk.agent.get(record(patient, 'file-citations'))),
      ).toHaveLength(1);
      const exam = await ok<DiagnosisResult>(
        main.dentist.agent
          .patch(path(visit, `diagnoses/${recorded.record.id}/seen-on`))
          .send({ seenOn: { kind: 'clinical_exam' } }),
      );
      expect(exam.record.seenOn).toEqual({ kind: 'clinical_exam' });
      const unsaid = await ok<PatientChartResult>(
        main.dentist.agent
          .patch(record(patient, `diagnoses/${recorded.record.id}/seen-on`))
          .send({ seenOn: null }),
      );
      expect(unsaid.chart.diagnoses[0]?.seenOn).toBeNull();
      expect(
        (await auditOf(`resourceType=diagnosis_record&resourceId=${recorded.record.id}`)).filter(
          (entry) => entry.action === 'diagnosis_record.seen_on',
        ),
      ).toHaveLength(2);
    });
  });

  describe('reads', () => {
    it('answers the last visit of a type: the last hygiene visit', async () => {
      const patient = await createPatient('Hygiene History');
      const none = await main.dentist.agent.get(record(patient, 'last-visit?type=hygiene'));
      expect(none.body).toBeNull();
      const hygiene = await complete(await started(patient, { type: 'hygiene' }));
      const exam = await complete(await started(patient, { type: 'examination' }));
      const lastHygiene = await ok<LastVisit>(
        main.dentist.agent.get(record(patient, 'last-visit?type=hygiene')),
      );
      expect(lastHygiene).toMatchObject({ id: hygiene.id, type: 'hygiene' });
      const last = await ok<LastVisit>(main.dentist.agent.get(record(patient, 'last-visit')));
      expect(last).toMatchObject({ id: exam.id, type: 'examination' });
    });
  });

  describe('tenant isolation', () => {
    it("keeps another clinic's visit, plans and files out of every new write", async () => {
      const other = await provision('Other Flows Clinic');
      const theirPatient = await createPatient('Their Patient', {}, other);
      const theirVisit = await started(theirPatient, { type: 'examination' }, other);
      const theirFile = await savedFile(theirPatient, other);
      const theirPlan = (
        await ok<PatientChartResult>(
          other.dentist.agent.post(record(theirPatient, 'plans')).send({
            procedureId: (
              (await other.owner.get('/api/v1/catalog/services')).body as ServiceItem[]
            ).find((item) => item.code === 'CMP')?.id,
            toothCode: '16',
            priority: 'high',
          }),
          201,
        )
      ).chart.plans[0];
      if (!theirPlan) throw new Error('no plan in the other clinic');
      const before = await ok<Visit>(other.dentist.agent.get(`/api/v1/visits/${theirVisit.id}`));

      const agent = main.dentist.agent;
      const visitWrites = [
        agent.patch(path(theirVisit, 'step')).send({ step: 'plan' }),
        agent.patch(path(theirVisit, 'view')).send({ viewMode: 'all' }),
        agent.patch(path(theirVisit, 'reason')).send({ reason: 'Not yours' }),
        agent.patch(path(theirVisit, 'complaint')).send({ painScore: 1, painSince: null }),
        agent.put(path(theirVisit, 'history-confirmation')),
        agent.delete(path(theirVisit, 'history-confirmation')),
        agent.put(path(theirVisit, `worklist/${theirPlan.id}`)),
        agent.delete(path(theirVisit, `worklist/${theirPlan.id}`)),
        agent
          .patch(path(theirVisit, `plans/${theirPlan.id}/priority`))
          .send({ priority: 'urgent' }),
        agent
          .patch(path(theirVisit, `diagnoses/${newId()}/seen-on`))
          .send({ seenOn: { kind: 'clinical_exam' } }),
      ];
      for (const response of await Promise.all(visitWrites)) {
        expect(response.status, JSON.stringify(response.body)).toBe(404);
      }
      const patientRoutes = [
        agent.get(`/api/v1/visits/start-options?patientId=${theirPatient.id}`),
        agent.get(record(theirPatient, 'history-confirmation')),
        agent.get(record(theirPatient, 'file-citations')),
        agent.patch(record(theirPatient, `plans/${theirPlan.id}`)).send({ priority: 'urgent' }),
        agent.put(record(theirPatient, `plans/${theirPlan.id}/acceptance`)),
        agent.delete(record(theirPatient, `plans/${theirPlan.id}/acceptance`)),
      ];
      for (const response of await Promise.all(patientRoutes)) {
        expect(response.status, JSON.stringify(response.body)).toBe(404);
      }

      // Their plan is no plan of my patient, and their file no file of hers.
      const mine = await createPatient('My Patient');
      await expectProblem(
        start(mine, { type: 'treatment', planIds: [theirPlan.id] }),
        422,
        'visit.plan_invalid',
      );
      const myVisit = await started(mine, { type: 'examination' });
      await expectProblem(
        agent.post(path(myVisit, 'diagnoses')).send({
          diagnosisId: deepCaries.id,
          toothCode: '16',
          seenOn: { kind: 'image', fileId: theirFile.id },
        }),
        422,
        'record.evidence_invalid',
      );

      const after = await ok<Visit>(other.dentist.agent.get(`/api/v1/visits/${theirVisit.id}`));
      expect({ ...after, serverNow: null }).toEqual({ ...before, serverNow: null });
      const theirChart = await ok<{ plans: { priority: string; acceptedAt: string | null }[] }>(
        other.dentist.agent.get(record(theirPatient, 'chart')),
      );
      expect(theirChart.plans).toMatchObject([{ priority: 'high', acceptedAt: null }]);
    });
  });
});
