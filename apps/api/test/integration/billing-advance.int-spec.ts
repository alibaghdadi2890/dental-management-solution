import type {
  AuditPage,
  Branch,
  Patient,
  PatientAccount,
  PatientChartResult,
  PaymentPreview,
  PlanResult,
  ProblemDetails,
  RecordPaymentResult,
  ServiceItem,
  ServiceResult,
  StaffUser,
  StartVisitResult,
  Visit,
  VisitFinancialSummary,
  VisitResult,
} from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../src/platform/kernel/id';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { createPlatformAdmin, signIn, signInAndSetPassword, uniqueEmail } from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';

const TEMPORARY = 'temporary-pw-1';

/** 09:00 UTC is noon in Beirut: the tenant's local date is the UTC date. */
const at = (date: string) => new Date(`${date}T09:00:00Z`);
const TODAY = '2026-06-10';

const problem = (body: unknown) => body as ProblemDetails;

describe('billing: advance payments held for the treatment plan (ADR-0051)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let owner: TestAgent;
  let dentist: { agent: TestAgent; user: StaffUser };
  let frontdesk: TestAgent;
  let crown: ServiceItem;
  let filling: ServiceItem;
  let cleaning: ServiceItem;

  const ok = async <T>(request: Promise<{ status: number; body: unknown }>, status = 200) => {
    const response = await request;
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    return response.body as T;
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

  const newPatient = (fullName: string) =>
    ok<Patient>(
      owner
        .post('/api/v1/patients')
        .set('Idempotency-Key', newId())
        .send({ fullName, phone: '71 000 000' }),
      201,
    );

  /** Plans `service` on `toothCode` from the patient record; returns the plan id. */
  const plan = async (patient: Patient, service: ServiceItem, toothCode: string) => {
    const { chart } = await ok<PatientChartResult>(
      dentist.agent.post(`/api/v1/clinical/patients/${patient.id}/plans`).send({
        procedureId: service.id,
        toothCode,
        priority: 'high',
        dentistId: dentist.user.profileId,
      }),
      201,
    );
    const made = chart.plans.find(
      (candidate) => candidate.toothCode === toothCode && candidate.status === 'planned',
    );
    if (!made) throw new Error('planning made no plan');
    return made.id;
  };

  const startVisit = async (patient: Patient) =>
    (
      await ok<StartVisitResult>(
        dentist.agent
          .post('/api/v1/visits')
          .send({ type: 'treatment', patientId: patient.id, dentistId: dentist.user.profileId }),
        201,
      )
    ).visit;

  const perform = (visit: Visit, planId: string) =>
    ok<PlanResult>(dentist.agent.post(`/api/v1/visits/${visit.id}/plans/${planId}/perform`));

  const addCleaning = (visit: Visit, toothCode = '11') =>
    ok<ServiceResult>(
      dentist.agent
        .post(`/api/v1/visits/${visit.id}/services`)
        .send({ procedureId: cleaning.id, toothCode }),
      201,
    );

  const complete = async (visit: Visit) =>
    (await ok<VisitResult>(dentist.agent.post(`/api/v1/visits/${visit.id}/complete`))).visit;

  /** A completed visit that performs `planIds` (and, with `withCleaning`, a $50 cleaning too). */
  const planVisit = async (patient: Patient, planIds: string[], withCleaning = false) => {
    const visit = await startVisit(patient);
    for (const planId of planIds) await perform(visit, planId);
    if (withCleaning) await addCleaning(visit);
    return complete(visit);
  };

  /** A completed visit with only a $50 cleaning, not plan work. */
  const cleaningVisit = async (patient: Patient) => {
    const visit = await startVisit(patient);
    await addCleaning(visit);
    return complete(visit);
  };

  const pay = (agent: TestAgent, body: Record<string, unknown>, key = newId()) =>
    agent
      .post('/api/v1/billing/payments')
      .set('Idempotency-Key', key)
      .send({ method: 'cash', paidAt: TODAY, ...body });

  const paid = (agent: TestAgent, body: Record<string, unknown>) =>
    ok<RecordPaymentResult>(pay(agent, body), 201);

  const preview = (body: Record<string, unknown>) =>
    ok<PaymentPreview>(
      owner
        .post('/api/v1/billing/payments/preview')
        .send({ method: 'cash', paidAt: TODAY, ...body }),
    );

  const account = (patient: Patient) =>
    ok<PatientAccount>(owner.get(`/api/v1/billing/patients/${patient.id}/account`));

  const summary = (visit: Visit) =>
    ok<VisitFinancialSummary>(owner.get(`/api/v1/billing/visits/${visit.id}/summary`));

  const money = async (patient: Patient) => {
    const view = await account(patient);
    return {
      balance: view.balance,
      held: view.held,
      credit: view.credit,
      open: view.openCharges.map((charge) => charge.outstanding),
    };
  };

  const releases = async (paymentId: string) =>
    (
      await ok<AuditPage>(
        owner.get(`/api/v1/audit?resourceType=payment&resourceId=${paymentId}&limit=100`),
      )
    ).items
      .filter((entry) => entry.action === 'payment.release')
      .map((entry) => entry.after as { kind: string; released: string });

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    testApp.clock.set(at(TODAY));
    const admin = await signIn(testApp.app, await createPlatformAdmin(testApp.app), undefined, {
      rememberMe: true,
    });
    const ownerEmail = uniqueEmail('owner');
    await ok(
      admin.post('/api/v1/platform/tenants').send({
        clinic: { name: 'Advance Clinic', slug: `adv-${newId().slice(-12)}` },
        firstBranch: { name: 'Advance Main' },
        owner: { displayName: 'Advance Owner', email: ownerEmail, temporaryPassword: TEMPORARY },
      }),
      201,
    );
    owner = await signInAndSetPassword(testApp.app, ownerEmail, TEMPORARY);
    const [branch] = (await owner.get('/api/v1/branches')).body as Branch[];
    if (!branch) throw new Error('provisioning created no branch');
    const items = await ok<ServiceItem[]>(
      owner.put('/api/v1/catalog/services').send({
        items: [
          { code: 'ZCRN', name: 'Crown', chargeUnit: 'per_tooth', price: '600' },
          { code: 'ZFIL', name: 'Filling', chargeUnit: 'per_tooth', price: '300' },
          { code: 'ZCLN', name: 'Cleaning', chargeUnit: 'per_tooth', price: '50' },
        ],
      }),
    );
    const byCode = (code: string) => {
      const item = items.find((candidate) => candidate.code === code);
      if (!item) throw new Error(`no ${code}`);
      return item;
    };
    crown = byCode('ZCRN');
    filling = byCode('ZFIL');
    cleaning = byCode('ZCLN');
    const staff = async (role: 'dentist' | 'frontdesk') => {
      const email = uniqueEmail(role);
      const user = await ok<StaffUser>(
        owner.post('/api/v1/users').send({
          displayName: `The ${role} ${newId().slice(-6)}`,
          email,
          practitionerType: role,
          roleKeys: [role],
          branchIds: [branch.id],
          temporaryPassword: TEMPORARY,
        }),
        201,
      );
      return { agent: await signInAndSetPassword(testApp.app, email, TEMPORARY), user };
    };
    dentist = await staff('dentist');
    frontdesk = (await staff('frontdesk')).agent;
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  it('holds the advance for the plan: plan visits are covered, other charges stay open', async () => {
    const patient = await newPatient('Held Patient');
    const crownPlan = await plan(patient, crown, '16');
    const fillingPlan = await plan(patient, filling, '26');

    expect(await preview({ patientId: patient.id, amount: '1000', advance: 'plan' })).toMatchObject(
      {
        advance: 'plan',
        held: '0.00',
        planRemaining: '900.00',
        error: 'payment.over_plan_remaining',
      },
    );
    await expectProblem(
      pay(frontdesk, { patientId: patient.id, amount: '1000', advance: 'plan' }),
      422,
      'payment.over_plan_remaining',
    );
    expect(await preview({ patientId: patient.id, amount: '850', advance: 'plan' })).toMatchObject({
      held: '850.00',
      allocations: [],
      error: null,
    });
    const advance = await paid(frontdesk, {
      patientId: patient.id,
      amount: '850',
      advance: 'plan',
    });
    expect(advance.allocations).toEqual([]);
    expect(await money(patient)).toEqual({
      balance: '-850.00',
      held: '850.00',
      credit: '0.00',
      open: [],
    });

    // An unrelated charge is not paid from the advance.
    const clean = await cleaningVisit(patient);
    expect(await money(patient)).toMatchObject({
      balance: '-800.00',
      held: '850.00',
      open: ['50.00'],
    });
    expect(await summary(clean)).toMatchObject({
      visit: { outstanding: '50.00' },
      totalOutstanding: '50.00',
      held: '850.00',
    });

    // The crown visit is covered by the advance at completion.
    const crownVisit = await planVisit(patient, [crownPlan]);
    expect(await summary(crownVisit)).toMatchObject({
      visit: { total: '600.00', paid: '600.00', outstanding: '0.00' },
      held: '250.00',
      payments: [{ fromAdvance: true, amount: '600.00' }],
    });
    expect(
      (await preview({ patientId: patient.id, amount: '100', advance: 'plan' })).planRemaining,
    ).toBe('50.00');

    // The last plan item done: the advance covers what it can, the hold ends, and the rest has
    // nothing left to cover, so the filling owes 50 and the cleaning 50.
    const fillingVisit = await planVisit(patient, [fillingPlan]);
    expect(await summary(fillingVisit)).toMatchObject({
      visit: { paid: '250.00', outstanding: '50.00' },
    });
    expect(await money(patient)).toEqual({
      balance: '100.00',
      held: '0.00',
      credit: '0.00',
      open: ['50.00', '50.00'],
    });
    const paymentId = advance.paymentIds[0] ?? '';
    expect(await releases(paymentId)).toEqual([{ kind: 'plan_closed', released: '0.00' }]);
    const history = (await account(patient)).history.find((row) => row.id === paymentId);
    expect(history).toMatchObject({ advance: 'plan', heldUnspent: '0.00' });
    expect(history?.releasedAt).not.toBeNull();
    expect(history?.allocations.every((line) => line.fromAdvance)).toBe(true);
  });

  it('gives the rest of the advance to other charges once the plan is done', async () => {
    const patient = await newPatient('Leftover Patient');
    const crownPlan = await plan(patient, crown, '16');
    const fillingPlan = await plan(patient, filling, '26');
    await cleaningVisit(patient);
    await paid(owner, { patientId: patient.id, amount: '900', advance: 'plan' });
    expect(await money(patient)).toMatchObject({ held: '900.00', open: ['50.00'] });

    // The crown is dropped; the filling is still to do, so the money stays held.
    await ok(
      dentist.agent.post(`/api/v1/clinical/patients/${patient.id}/plans/${crownPlan}/cancel`),
    );
    expect(await money(patient)).toMatchObject({ held: '900.00', open: ['50.00'] });

    await planVisit(patient, [fillingPlan]);
    expect(await money(patient)).toEqual({
      balance: '-550.00',
      held: '0.00',
      credit: '550.00',
      open: [],
    });
  });

  it('ends the hold when the last plan item is cancelled or removed', async () => {
    const cancelled = await newPatient('Cancelled Plan');
    const cancelledPlan = await plan(cancelled, filling, '26');
    const first = await paid(owner, { patientId: cancelled.id, amount: '300', advance: 'plan' });
    await ok(
      dentist.agent.post(`/api/v1/clinical/patients/${cancelled.id}/plans/${cancelledPlan}/cancel`),
    );
    expect(await money(cancelled)).toMatchObject({ held: '0.00', credit: '300.00' });
    expect(await releases(first.paymentIds[0] ?? '')).toEqual([
      { kind: 'plan_closed', released: '300.00' },
    ]);

    const removed = await newPatient('Removed Plan');
    const removedPlan = await plan(removed, filling, '26');
    await paid(owner, { patientId: removed.id, amount: '300', advance: 'plan' });
    await ok(dentist.agent.delete(`/api/v1/clinical/patients/${removed.id}/plans/${removedPlan}`));
    expect(await money(removed)).toMatchObject({ held: '0.00', credit: '300.00' });
  });

  it('releases a held advance by hand, with a reason, to the open charges', async () => {
    const patient = await newPatient('Released Patient');
    await plan(patient, filling, '26');
    const advance = await paid(frontdesk, {
      patientId: patient.id,
      amount: '200',
      advance: 'plan',
    });
    await cleaningVisit(patient);
    const paymentId = advance.paymentIds[0] ?? '';

    await ok(
      frontdesk
        .post(`/api/v1/billing/payments/${paymentId}/release`)
        .send({ reason: 'The patient asked to use it for the cleaning' }),
      201,
    );
    expect(await money(patient)).toEqual({
      balance: '-150.00',
      held: '0.00',
      credit: '150.00',
      open: [],
    });
    expect(await releases(paymentId)).toEqual([{ kind: 'manual', released: '200.00' }]);
    await expectProblem(
      frontdesk
        .post(`/api/v1/billing/payments/${paymentId}/release`)
        .send({ reason: 'Again please' }),
      409,
      'payment.not_held',
    );

    const ordinary = await paid(owner, { patientId: patient.id, amount: '10', advance: 'credit' });
    await expectProblem(
      owner
        .post(`/api/v1/billing/payments/${ordinary.paymentIds[0] ?? ''}/release`)
        .send({ reason: 'Not an advance' }),
      409,
      'payment.not_held',
    );
  });

  it('refunds and voids what a held advance has not spent', async () => {
    const patient = await newPatient('Refunded Patient');
    await plan(patient, crown, '16');
    const refunded = await paid(owner, { patientId: patient.id, amount: '300', advance: 'plan' });
    await ok(
      owner
        .post(`/api/v1/billing/payments/${refunded.paymentIds[0] ?? ''}/refund`)
        .send({ amount: '300', reason: 'The patient changed their mind' }),
      201,
    );
    const voided = await paid(owner, { patientId: patient.id, amount: '200', advance: 'plan' });
    await ok(
      owner
        .post(`/api/v1/billing/payments/${voided.paymentIds[0] ?? ''}/void`)
        .send({ reason: 'Entered on the wrong patient' }),
      201,
    );
    expect(await money(patient)).toEqual({
      balance: '0.00',
      held: '0.00',
      credit: '0.00',
      open: [],
    });
    // Neither holds anything any more: there is nothing to release.
    for (const payment of [refunded, voided]) {
      await expectProblem(
        owner
          .post(`/api/v1/billing/payments/${payment.paymentIds[0] ?? ''}/release`)
          .send({ reason: 'Nothing left' }),
        409,
        'payment.not_held',
      );
      expect(await releases(payment.paymentIds[0] ?? '')).toEqual([]);
    }
  });

  it('takes the advance back when an amendment removes the plan service, and keeps it held', async () => {
    const patient = await newPatient('Amended Patient');
    const fillingPlan = await plan(patient, filling, '26');
    await plan(patient, crown, '16');
    await paid(owner, { patientId: patient.id, amount: '300', advance: 'plan' });
    const visit = await planVisit(patient, [fillingPlan], true);
    expect(await money(patient)).toMatchObject({ held: '0.00', open: ['50.00'] });

    const kept = (
      await database.ownerPool.query<{ id: string }>(
        'select id from visit_services where visit_id = $1 and plan_id is null',
        [visit.id],
      )
    ).rows;
    await ok(
      dentist.agent.post(`/api/v1/visits/${visit.id}/amend`).send({
        expectedUpdatedAt: visit.updatedAt,
        reason: 'The filling was recorded on the wrong visit',
        discount: { mode: 'amount', value: '0' },
        services: kept,
      }),
    );
    expect(await money(patient)).toEqual({
      balance: '-250.00',
      held: '300.00',
      credit: '0.00',
      open: ['50.00'],
    });
  });

  it('keeps an advance held through a merge, with the plan it was paid for', async () => {
    const kept = await newPatient('Kept Patient');
    const dropped = await newPatient('Dropped Patient');
    await plan(dropped, filling, '26');
    const advance = await paid(owner, { patientId: dropped.id, amount: '300', advance: 'plan' });
    await ok(
      owner
        .post('/api/v1/patients/merge')
        .send({ keepId: kept.id, dropId: dropped.id, reason: 'Same person' }),
    );
    expect(await money(kept)).toEqual({
      balance: '-300.00',
      held: '300.00',
      credit: '0.00',
      open: [],
    });
    expect(await releases(advance.paymentIds[0] ?? '')).toEqual([]);
  });

  it('refuses a plan advance without plan work, and lets a credit advance pay ahead', async () => {
    const patient = await newPatient('No Plan Patient');
    expect((await preview({ patientId: patient.id, amount: '100', advance: 'plan' })).error).toBe(
      'payment.no_open_plan',
    );
    await expectProblem(
      pay(owner, { patientId: patient.id, amount: '100', advance: 'plan' }),
      422,
      'payment.no_open_plan',
    );
    await expectProblem(
      pay(owner, { patientId: patient.id, amount: '100' }),
      422,
      'payment.nothing_outstanding',
    );

    await cleaningVisit(patient);
    const credit = await paid(owner, { patientId: patient.id, amount: '200', advance: 'credit' });
    expect(credit.allocations).toMatchObject([{ amount: '50.00', fromAdvance: false }]);
    expect(await money(patient)).toEqual({
      balance: '-150.00',
      held: '0.00',
      credit: '150.00',
      open: [],
    });
    expect((await account(patient)).history[0]).toMatchObject({
      advance: 'credit',
      heldUnspent: '0.00',
      releasedAt: null,
    });

    const household = await pay(owner, {
      patientId: patient.id,
      amount: '10',
      advance: 'credit',
      scope: 'household',
    });
    expect(household.status).toBe(400);
  });

  it('replays an advance under its key and refuses the key for another kind of payment', async () => {
    const patient = await newPatient('Replay Patient');
    await plan(patient, filling, '26');
    const key = newId();
    const body = { patientId: patient.id, amount: '100', advance: 'plan' };
    const first = await ok<RecordPaymentResult>(pay(owner, body, key), 201);
    const again = await ok<RecordPaymentResult>(pay(owner, body, key), 201);
    expect(again.receiptNumber).toBe(first.receiptNumber);
    await expectProblem(
      pay(owner, { ...body, advance: 'credit' }, key),
      409,
      'payment.idempotency_mismatch',
    );
    expect((await money(patient)).held).toBe('100.00');
  });
});
