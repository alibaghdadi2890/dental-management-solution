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
import { grant } from '../support/clinic';

const TEMPORARY = 'temporary-pw-1';

/** Three clinic days, at 09:00 UTC (noon in Beirut). Everyone signs in on `LATER`, so the visits
 * are in the past: going back in time never idles a session. */
const DAY_1 = '2026-06-01';
const DAY_2 = '2026-06-08';
const DAY_3 = '2026-06-15';
const LATER = '2026-06-20';
const at = (day: string) => new Date(`${day}T09:00:00Z`);

const problem = (body: unknown) => body as ProblemDetails;

describe('clinical: work over several visits, charged when it starts (ADR-0032, ADR-0064)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let owner: TestAgent;
  let tenant: Tenant;
  let dentist: { agent: TestAgent; user: StaffUser };
  let rootCanal: ServiceItem;

  const createPatient = async (fullName: string): Promise<Patient> => {
    const response = await owner
      .post('/api/v1/patients')
      .set('Idempotency-Key', newId())
      .send({ fullName, phone: '71 000 000' });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as Patient;
  };

  const startVisit = async (patient: Patient, day: string): Promise<Visit> => {
    testApp.clock.set(at(day));
    const response = await dentist.agent
      .post('/api/v1/visits')
      .send({ type: 'treatment', patientId: patient.id, dentistId: dentist.user.profileId });
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

  /** Continue today: this visit's session on work in progress. */
  const continueToday = (visit: Visit, planId: string) =>
    ok<PlanResult>(dentist.agent.put(path(visit, `plans/${planId}/session`)).send({}));

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
    await grant(owner, dentist.user.id);
  });

  afterEach(() => {
    testApp.clock.set(at(LATER));
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  it('a service not finished in one visit is charged there, continued in the next and completed in a third at no charge', async () => {
    const patient = await createPatient('Three Visits');

    const first = await startVisit(patient, DAY_1);
    const service = await addService(first, '36');
    await ok(
      dentist.agent.patch(path(first, `services/${service.id}`)).send({ baseAmount: '250.00' }),
    );
    const { record: plan, visit: afterStart } = await markUnfinished(first, service.id);
    expect(plan).toMatchObject({
      status: 'in_progress',
      toothCode: '36',
      recordedInVisitId: first.id,
      startedInVisitId: first.id,
      sessions: [{ visitId: first.id, date: DAY_1, note: null }],
      chargedIn: { visitId: first.id, number: first.displayNumber },
    });
    // The line stays, at its edited price, and charges the work here (ADR-0064).
    expect(afterStart.services).toMatchObject([
      { id: service.id, planId: plan.id, final: { amount: '250.00', currency: 'USD' } },
    ]);
    expect((await chartOf(patient)).teeth).toMatchObject([{ code: '36', state: 'in_progress' }]);
    const firstDone = await complete(first);
    expect(firstDone.money.total).toBe('250.00');
    expect(await charges(patient)).toEqual([[first.id, '250.00']]);

    const second = await startVisit(patient, DAY_2);
    await continueToday(second, plan.id);
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
    // Continuing twice is still one session.
    await continueToday(second, plan.id);
    expect((await chartOf(patient)).plans[0]?.sessions).toHaveLength(2);
    // Only work completed here can be reopened here.
    await expectProblem(
      dentist.agent.post(path(second, `plans/${plan.id}/reopen`)),
      409,
      'plan.not_open',
    );
    // The middle visit worked on it and charges nothing.
    expect((await complete(second)).money.total).toBe('0.00');

    const third = await startVisit(patient, DAY_3);
    const done = await ok<PlanResult>(dentist.agent.post(path(third, `plans/${plan.id}/perform`)));
    expect(done.record).toMatchObject({
      status: 'performed',
      performedInVisitId: third.id,
      chargedIn: { visitId: first.id },
    });
    // Completing adds no line: the first visit charged it.
    expect(done.visit.services).toEqual([]);
    // Its Undo puts the work back in progress; done again.
    const reopened = await ok<PlanResult>(
      dentist.agent.post(path(third, `plans/${plan.id}/reopen`)),
    );
    expect(reopened.record).toMatchObject({ status: 'in_progress', performedInVisitId: null });
    await ok<PlanResult>(dentist.agent.post(path(third, `plans/${plan.id}/perform`)));
    expect((await complete(third)).money.total).toBe('0.00');
    expect(await charges(patient)).toEqual([[first.id, '250.00']]);
    // The charge of work a later visit completed can't be corrected away.
    await expectProblem(
      dentist.agent.post(path(first, 'amend')).send({
        expectedUpdatedAt: firstDone.updatedAt,
        reason: 'Charged by mistake',
        discount: { mode: firstDone.discountMode, value: firstDone.discountValue },
        services: [{ procedureId: rootCanal.id, toothCode: '37' }],
      }),
      422,
      'visit.amend_plan_linked',
    );
    expect(await actionsOn(plan.id)).toEqual([
      'treatment_plan.create',
      'treatment_plan.perform',
      'treatment_plan.perform',
      'treatment_plan.session',
      'treatment_plan.start',
      'treatment_plan.unperform',
    ]);
    // Nothing is left open on the plan, and nothing is left to charge.
    const open = (await chartOf(patient)).plans.filter(
      ({ status }) => status === 'planned' || status === 'in_progress',
    );
    expect(open).toEqual([]);
  });

  it('a visit that does not continue the work records nothing and can still be discarded', async () => {
    const patient = await createPatient('Not Today');
    const first = await startVisit(patient, DAY_1);
    const { record: plan } = await started(first, '37');
    await complete(first);

    const second = await startVisit(patient, DAY_2);
    expect((await chartOf(patient)).plans).toMatchObject([
      { id: plan.id, status: 'in_progress', sessions: [{ visitId: first.id }] },
    ]);
    // Only work in progress can be continued.
    const third = await startVisit(await createPatient('Someone Else'), DAY_2);
    await expectProblem(
      dentist.agent.put(path(third, `plans/${plan.id}/session`)).send({}),
      404,
      'record.not_found',
    );
    const discarded = await dentist.agent.post(path(second, 'discard'));
    expect(discarded.status, JSON.stringify(discarded.body)).toBeLessThan(300);
  });

  it('removing the service of work first added in the same visit leaves nothing', async () => {
    const patient = await createPatient('Changed Mind');
    const visit = await startVisit(patient, DAY_1);
    const { record: plan } = await started(visit, '47');
    const done = await ok<PlanResult>(dentist.agent.post(path(visit, `plans/${plan.id}/perform`)));
    const [line] = done.visit.services;
    if (!line) throw new Error('the work has no line');
    expect(line.planId).toBe(plan.id);
    await ok(dentist.agent.delete(path(visit, `services/${line.id}`)));
    expect((await chartOf(patient)).plans).toEqual([]);
    const discarded = await dentist.agent.post(path(visit, 'discard'));
    expect(discarded.status, JSON.stringify(discarded.body)).toBeLessThan(300);
  });

  it('undoes a start, a continue and a done', async () => {
    const patient = await createPatient('Undo Steps');
    const { chart: planned } = await ok<PatientChartResult>(
      dentist.agent
        .post(`/api/v1/clinical/patients/${patient.id}/plans`)
        .send({ procedureId: rootCanal.id, toothCode: '46', priority: 'high' }),
      201,
    );
    const [plan] = planned.plans;
    if (!plan) throw new Error('no plan');
    const first = await startVisit(patient, DAY_1);

    // A session on a plan that is only planned starts the work here (feature 10) and charges it.
    const restarted = await ok<PlanResult>(
      dentist.agent.put(path(first, `plans/${plan.id}/session`)).send({}),
    );
    expect(restarted.record).toMatchObject({
      status: 'in_progress',
      startedInVisitId: first.id,
      sessions: [{ visitId: first.id }],
      chargedIn: { visitId: first.id },
    });
    expect(restarted.record.acceptedAt).not.toBeNull();
    const [charge] = restarted.visit.services;
    if (!charge) throw new Error('starting added no line');
    expect(charge).toMatchObject({ planId: plan.id, final: { amount: '200.00' } });
    // The visit that charges the work takes it back by removing its line, not its session.
    await expectProblem(
      dentist.agent.delete(path(first, `plans/${plan.id}/session`)),
      409,
      'record.not_removable',
    );
    await ok(dentist.agent.delete(path(first, `services/${charge.id}`)));
    // The acceptance that start recorded goes with it: the patient never gave one.
    expect((await chartOf(patient)).plans).toMatchObject([
      { id: plan.id, status: 'planned', acceptedAt: null, sessions: [], chargedIn: null },
    ]);

    // Performed, then marked not finished: the same plan is in progress again, its line kept.
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
      chargedIn: { visitId: first.id },
    });
    expect(reopened.visit.services).toMatchObject([{ id: line.id, planId: plan.id }]);
    expect((await complete(first)).money.total).toBe('200.00');

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
    expect(await charges(patient)).toEqual([[first.id, '200.00']]);
  });

  it('a correction that takes the starting charge off leaves the work in progress, charged when it is completed', async () => {
    const patient = await createPatient('Amend Start');
    const first = await startVisit(patient, DAY_1);
    const { record: plan } = await started(first, '16');
    const other = await addService(first, '17');
    const completed = await complete(first);
    expect(completed.money.total).toBe('400.00');

    const amended = await ok<VisitResult>(
      dentist.agent.post(path(first, 'amend')).send({
        expectedUpdatedAt: completed.updatedAt,
        reason: 'Charge it when it is done',
        discount: { mode: completed.discountMode, value: completed.discountValue },
        services: [{ id: other.id }],
      }),
    );
    expect(amended.visit.money.total).toBe('200.00');
    expect((await chartOf(patient)).plans).toMatchObject([
      { id: plan.id, status: 'in_progress', chargedIn: null },
    ]);

    const second = await startVisit(patient, DAY_2);
    const done = await ok<PlanResult>(dentist.agent.post(path(second, `plans/${plan.id}/perform`)));
    expect(done.visit.services).toMatchObject([{ planId: plan.id, final: { amount: '200.00' } }]);
    expect((await complete(second)).money.total).toBe('200.00');
    expect(await charges(patient)).toEqual([
      [first.id, '400.00'],
      [second.id, '200.00'],
    ]);
  });

  it('cancelled work keeps its charge; a voided start is never charged again', async () => {
    const patient = await createPatient('Abandoned');
    const first = await startVisit(patient, DAY_1);
    const { record: inVisit } = await started(first, '26');
    const { record: afterVoid } = await started(first, '27');
    const { record: fromRecord } = await started(first, '28');
    const completed = await complete(first);
    expect(await charges(patient)).toEqual([[first.id, '600.00']]);

    const second = await startVisit(patient, DAY_2);
    const cancelled = await ok<PlanResult>(
      dentist.agent.post(path(second, `plans/${inVisit.id}/cancel`)),
    );
    expect(cancelled.record).toMatchObject({
      status: 'cancelled',
      cancelledInVisitId: second.id,
      chargedIn: { visitId: first.id },
    });
    await expectProblem(
      dentist.agent.put(path(second, `plans/${inVisit.id}/session`)).send({}),
      409,
      'plan.not_in_progress',
    );
    // The cancelled work's line is a charge, not treatment.
    expect((await chartOf(patient)).teeth.find((tooth) => tooth.code === '26')).toBeUndefined();

    // Voiding the visit that started it leaves the work in progress, the session marked voided.
    await ok(
      dentist.agent
        .post(path(first, 'void'))
        .send({ expectedUpdatedAt: completed.updatedAt, reason: 'Recorded on the wrong day' }),
    );
    const chart = await chartOf(patient);
    expect(chart.voidedVisitIds).toEqual([first.id]);
    expect(chart.plans.find((plan) => plan.id === afterVoid.id)).toMatchObject({
      status: 'in_progress',
      sessions: [{ visitId: first.id }],
    });
    // Completing it charges nothing: the voided line still stands for it.
    const done = await ok<PlanResult>(
      dentist.agent.post(path(second, `plans/${afterVoid.id}/perform`)),
    );
    expect(done.visit.services).toEqual([]);
    expect((await complete(second)).money.total).toBe('0.00');

    const { chart: after } = await ok<PatientChartResult>(
      dentist.agent.post(`/api/v1/clinical/patients/${patient.id}/plans/${fromRecord.id}/cancel`),
    );
    expect(after.plans.find((plan) => plan.id === fromRecord.id)).toMatchObject({
      status: 'cancelled',
      cancelledInVisitId: null,
    });
    expect(await charges(patient)).toEqual([[first.id, '600.00']]);
  });
});
