import type {
  AuditEntry,
  AuditPage,
  Branch,
  Patient,
  PatientChart,
  PatientChartResult,
  PlanResult,
  ProblemDetails,
  ServiceItem,
  ServiceResult,
  StaffUser,
  StartVisitResult,
  Tenant,
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

/** Three clinic days, at 09:00 UTC (noon in Beirut). Everyone signs in on `LATER`, so the visits
 * are in the past: going back in time never idles a session. */
const DAY_1 = '2026-06-01';
const DAY_2 = '2026-06-08';
const DAY_3 = '2026-06-15';
const LATER = '2026-06-20';
const at = (day: string) => new Date(`${day}T09:00:00Z`);

const problem = (body: unknown) => body as ProblemDetails;

describe('clinical: work over several visits, charged when done (ADR-0032)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let owner: TestAgent;
  let tenant: Tenant;
  let dentist: { agent: TestAgent; user: StaffUser };
  let rootCanal: ServiceItem;

  const createPatient = async (fullName: string): Promise<Patient> => {
    const response = await owner.post('/api/v1/patients').send({ fullName, phone: '71 000 000' });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as Patient;
  };

  const startVisit = async (patient: Patient, day: string): Promise<Visit> => {
    testApp.clock.set(at(day));
    const response = await dentist.agent
      .post('/api/v1/visits')
      .send({ patientId: patient.id, dentistId: dentist.user.profileId });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return (response.body as StartVisitResult).visit;
  };

  const path = (visit: Visit, rest: string) => `/api/v1/visits/${visit.id}/${rest}`;

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

  const addService = async (visit: Visit, toothCode: string) =>
    (
      await ok<ServiceResult>(
        dentist.agent.post(path(visit, 'services')).send({ procedureId: rootCanal.id, toothCode }),
        201,
      )
    ).record;

  const markUnfinished = (visit: Visit, serviceId: string) =>
    ok<PlanResult>(dentist.agent.post(path(visit, `services/${serviceId}/unfinished`)));

  /** Adds a root canal on `toothCode` and marks it not finished. */
  const started = async (visit: Visit, toothCode: string) =>
    markUnfinished(visit, (await addService(visit, toothCode)).id);

  const answer = async (visit: Visit, planIds: string[]) =>
    (
      await ok<VisitResult>(
        dentist.agent.post(path(visit, 'unfinished-answer')).send({ continue: planIds }),
      )
    ).visit;

  const complete = async (visit: Visit): Promise<Visit> => {
    testApp.clock.advance({ minutes: 30 });
    return (await ok<VisitResult>(dentist.agent.post(path(visit, 'complete')))).visit;
  };

  const chartOf = async (patient: Patient): Promise<PatientChart> =>
    ok<PatientChart>(dentist.agent.get(`/api/v1/clinical/patients/${patient.id}/chart`));

  /** The visit charges on the patient's ledger: `[visit id, amount]`, oldest first. */
  const charges = async (patient: Patient) =>
    (
      await database.ownerPool.query<{ visit_id: string; amount: string }>(
        `select visit_id, amount from ledger_entries
          where tenant_id = $1 and patient_id = $2 and kind = 'visit_charge' order by created_at`,
        [tenant.id, patient.id],
      )
    ).rows.map((row) => [row.visit_id, row.amount]);

  const actionsOn = async (planId: string) =>
    (
      (await owner.get(`/api/v1/audit?resourceType=treatment_plan&resourceId=${planId}&limit=100`))
        .body as AuditPage
    ).items
      .map((entry: AuditEntry) => entry.action)
      .sort();

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    testApp.clock.set(at(LATER));
    const admin = await signIn(testApp.app, await createPlatformAdmin(testApp.app), undefined, {
      rememberMe: true,
    });
    const ownerEmail = uniqueEmail('owner');
    const provisioned = await admin.post('/api/v1/platform/tenants').send({
      clinic: { name: 'Sessions Clinic', slug: `sess-${newId().slice(-12)}` },
      firstBranch: { name: 'Sessions Main' },
      owner: { displayName: 'Sessions Owner', email: ownerEmail, temporaryPassword: TEMPORARY },
    });
    expect(provisioned.status, JSON.stringify(provisioned.body)).toBe(201);
    tenant = provisioned.body as Tenant;
    owner = await signInAndSetPassword(testApp.app, ownerEmail, TEMPORARY);
    const [branch] = (await owner.get('/api/v1/branches')).body as Branch[];
    if (!branch) throw new Error('provisioning created no branch');
    // No rooms, so several visits can be live at once in this suite.
    const rooms = (await owner.get(`/api/v1/branches/${branch.id}/rooms`)).body as { id: string }[];
    for (const room of Array.isArray(rooms) ? rooms : []) {
      await owner.delete(`/api/v1/branches/${branch.id}/rooms/${room.id}`);
    }

    const services = await owner.put('/api/v1/catalog/services').send({
      items: [{ code: 'ZRCT', name: 'Test root canal', chargeUnit: 'per_tooth', price: '200' }],
    });
    expect(services.status, JSON.stringify(services.body)).toBe(200);
    const found = (services.body as ServiceItem[]).find((item) => item.code === 'ZRCT');
    if (!found) throw new Error('the catalog was not saved');
    rootCanal = found;

    const email = uniqueEmail('dentist');
    const created = await owner.post('/api/v1/users').send({
      displayName: 'The dentist',
      email,
      practitionerType: 'dentist',
      roleKeys: ['dentist'],
      branchIds: [branch.id],
      temporaryPassword: TEMPORARY,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    dentist = {
      agent: await signInAndSetPassword(testApp.app, email, TEMPORARY),
      user: created.body as StaffUser,
    };
  });

  afterEach(() => {
    testApp.clock.set(at(LATER));
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  it('a service not finished in one visit is continued in the next and charged only by the visit that completes it', async () => {
    const patient = await createPatient('Three Visits');

    const first = await startVisit(patient, DAY_1);
    const service = await addService(first, '36');
    await ok(
      dentist.agent.patch(path(first, `services/${service.id}`)).send({ baseAmount: '250.00' }),
    );
    const { record: plan, visit: afterStart } = await markUnfinished(first, service.id);
    // The plan behind it keeps the service's edited price.
    expect(plan).toMatchObject({
      status: 'in_progress',
      toothCode: '36',
      price: { amount: '250.00', currency: 'USD' },
      recordedInVisitId: first.id,
      startedInVisitId: first.id,
      sessions: [{ visitId: first.id, date: DAY_1, note: null }],
    });
    expect(afterStart.services).toEqual([]);
    expect((await chartOf(patient)).teeth).toMatchObject([{ code: '36', state: 'in_progress' }]);
    // A session is visit content: the visit can't be discarded, and completes at nothing.
    await expectProblem(dentist.agent.post(path(first, 'discard')), 409, 'visit.not_empty');
    expect((await complete(first)).money.total).toBe('0.00');
    // A visit that charges nothing posts no ledger entry.
    expect(await charges(patient)).toEqual([]);

    const second = await startVisit(patient, DAY_2);
    expect(second.unfinishedAnsweredAt).toBeNull();
    const answered = await answer(second, [plan.id]);
    expect(answered.unfinishedAnsweredAt).toBe(at(DAY_2).toISOString());
    expect((await chartOf(patient)).plans).toMatchObject([
      {
        id: plan.id,
        status: 'in_progress',
        sessions: [
          { visitId: first.id, date: DAY_1 },
          { visitId: second.id, date: DAY_2 },
        ],
      },
    ]);
    // A second answer keeps the first stamp, and continuing twice is still one session.
    testApp.clock.advance({ minutes: 5 });
    expect((await answer(second, [plan.id])).unfinishedAnsweredAt).toBe(
      answered.unfinishedAnsweredAt,
    );
    expect((await chartOf(patient)).plans[0]?.sessions).toHaveLength(2);
    // The middle visit worked on it and charges nothing.
    expect((await complete(second)).money.total).toBe('0.00');

    const third = await startVisit(patient, DAY_3);
    const done = await ok<PlanResult>(dentist.agent.post(path(third, `plans/${plan.id}/perform`)));
    expect(done.record).toMatchObject({ status: 'performed', performedInVisitId: third.id });
    expect(done.visit.services).toMatchObject([
      { planId: plan.id, toothCode: '36', final: { amount: '250.00', currency: 'USD' } },
    ]);
    expect((await complete(third)).money.total).toBe('250.00');
    expect(await charges(patient)).toEqual([[third.id, '250.00']]);
    expect(await actionsOn(plan.id)).toEqual([
      'treatment_plan.create',
      'treatment_plan.perform',
      'treatment_plan.session',
      'treatment_plan.start',
    ]);
    const summary = await ok<{ plannedProcedures: number }>(
      dentist.agent.get(`/api/v1/clinical/patients/${patient.id}/summary`),
    );
    expect(summary.plannedProcedures).toBe(0);
  });

  it('a visit that answers "not today" records nothing and can still be discarded', async () => {
    const patient = await createPatient('Not Today');
    const first = await startVisit(patient, DAY_1);
    const { record: plan } = await started(first, '37');
    await complete(first);

    const second = await startVisit(patient, DAY_2);
    expect((await answer(second, [])).unfinishedAnsweredAt).toBe(at(DAY_2).toISOString());
    expect((await chartOf(patient)).plans).toMatchObject([
      { id: plan.id, status: 'in_progress', sessions: [{ visitId: first.id }] },
    ]);
    // Only work in progress can be continued.
    const third = await startVisit(await createPatient('Someone Else'), DAY_2);
    await expectProblem(
      dentist.agent.post(path(third, 'unfinished-answer')).send({ continue: [plan.id] }),
      404,
      'record.not_found',
    );
    const discarded = await dentist.agent.post(path(second, 'discard'));
    expect(discarded.status, JSON.stringify(discarded.body)).toBeLessThan(300);
  });

  it('removing the service that completed work first added in the same visit leaves nothing', async () => {
    const patient = await createPatient('Changed Mind');
    const visit = await startVisit(patient, DAY_1);
    const { record: plan } = await started(visit, '47');
    const done = await ok<PlanResult>(dentist.agent.post(path(visit, `plans/${plan.id}/perform`)));
    const [line] = done.visit.services;
    if (!line) throw new Error('completing added no service');
    await ok(dentist.agent.delete(path(visit, `services/${line.id}`)));
    expect((await chartOf(patient)).plans).toEqual([]);
    const discarded = await dentist.agent.post(path(visit, 'discard'));
    expect(discarded.status, JSON.stringify(discarded.body)).toBeLessThan(300);
  });

  it('undoes a start, a continue and a done', async () => {
    const patient = await createPatient('Undo Steps');
    const first = await startVisit(patient, DAY_1);
    const { record: plan } = await started(first, '46');

    // The only session removed: the plan was never started.
    const unstarted = await ok<PlanResult>(
      dentist.agent.delete(path(first, `plans/${plan.id}/session`)),
    );
    expect(unstarted.record).toMatchObject({
      status: 'planned',
      startedInVisitId: null,
      startedAt: null,
      sessions: [],
    });
    await expectProblem(
      dentist.agent.delete(path(first, `plans/${plan.id}/session`)),
      409,
      'plan.not_in_progress',
    );
    await expectProblem(
      dentist.agent.put(path(first, `plans/${plan.id}/session`)).send({}),
      409,
      'plan.not_in_progress',
    );

    // Performed, then marked not finished: the same plan is in progress again.
    const performed = await ok<PlanResult>(
      dentist.agent.post(path(first, `plans/${plan.id}/perform`)),
    );
    const [line] = performed.visit.services;
    if (!line) throw new Error('performing added no service');
    const reopened = await markUnfinished(first, line.id);
    expect(reopened.record).toMatchObject({
      id: plan.id,
      status: 'in_progress',
      performedInVisitId: null,
      startedInVisitId: first.id,
    });
    expect(reopened.visit.services).toEqual([]);
    await complete(first);

    const second = await startVisit(patient, DAY_2);
    await expectProblem(
      dentist.agent.delete(path(second, `plans/${plan.id}/session`)),
      404,
      'record.not_found',
    );
    await ok<PlanResult>(dentist.agent.put(path(second, `plans/${plan.id}/session`)).send({}));
    const uncontinued = await ok<PlanResult>(
      dentist.agent.delete(path(second, `plans/${plan.id}/session`)),
    );
    expect(uncontinued.record).toMatchObject({
      status: 'in_progress',
      sessions: [{ visitId: first.id }],
    });

    // Mark done, then remove the service: back in progress, not back to planned.
    const done = await ok<PlanResult>(dentist.agent.post(path(second, `plans/${plan.id}/perform`)));
    const service = done.visit.services[0];
    if (!service) throw new Error('marking done added no service');
    await ok(dentist.agent.delete(path(second, `services/${service.id}`)));
    const chart = await chartOf(patient);
    expect(chart.plans).toMatchObject([
      { id: plan.id, status: 'in_progress', performedInVisitId: null, startedInVisitId: first.id },
    ]);
  });

  it('an amendment that removes the done service puts the plan back in progress', async () => {
    const patient = await createPatient('Amend Done');
    const first = await startVisit(patient, DAY_1);
    const { record: plan } = await started(first, '16');
    await complete(first);
    const second = await startVisit(patient, DAY_2);
    await ok<PlanResult>(dentist.agent.post(path(second, `plans/${plan.id}/perform`)));
    const other = await ok<{ record: { id: string } }>(
      dentist.agent
        .post(path(second, 'services'))
        .send({ procedureId: rootCanal.id, toothCode: '17' }),
      201,
    );
    const completed = await complete(second);

    const amended = await ok<VisitResult>(
      dentist.agent.post(path(second, 'amend')).send({
        expectedUpdatedAt: completed.updatedAt,
        reason: 'Not finished after all',
        discount: { mode: completed.discountMode, value: completed.discountValue },
        services: [{ id: other.record.id }],
      }),
    );
    expect(amended.visit.money.total).toBe('200.00');
    expect((await chartOf(patient)).plans).toMatchObject([
      { id: plan.id, status: 'in_progress', performedInVisitId: null },
    ]);
  });

  it('cancels abandoned work at no charge, in a visit and from the record; a void leaves it in progress', async () => {
    const patient = await createPatient('Abandoned');
    const first = await startVisit(patient, DAY_1);
    const { record: inVisit } = await started(first, '26');
    const { record: fromRecord } = await started(first, '27');
    const completed = await complete(first);

    const second = await startVisit(patient, DAY_2);
    const cancelled = await ok<PlanResult>(
      dentist.agent.post(path(second, `plans/${inVisit.id}/cancel`)),
    );
    expect(cancelled.record).toMatchObject({ status: 'cancelled', cancelledInVisitId: second.id });
    await expectProblem(
      dentist.agent.put(path(second, `plans/${inVisit.id}/session`)).send({}),
      409,
      'plan.not_in_progress',
    );

    // Voiding the visit that started it leaves the work in progress, the session marked voided.
    await ok(
      dentist.agent
        .post(path(first, 'void'))
        .send({ expectedUpdatedAt: completed.updatedAt, reason: 'Recorded on the wrong day' }),
    );
    const chart = await chartOf(patient);
    expect(chart.voidedVisitIds).toEqual([first.id]);
    expect(chart.plans.find((plan) => plan.id === fromRecord.id)).toMatchObject({
      status: 'in_progress',
      sessions: [{ visitId: first.id }],
    });

    const { chart: after } = await ok<PatientChartResult>(
      dentist.agent.post(`/api/v1/clinical/patients/${patient.id}/plans/${fromRecord.id}/cancel`),
    );
    expect(after.plans.find((plan) => plan.id === fromRecord.id)).toMatchObject({
      status: 'cancelled',
      cancelledInVisitId: null,
    });
    expect(await charges(patient)).toEqual([]);
  });
});
