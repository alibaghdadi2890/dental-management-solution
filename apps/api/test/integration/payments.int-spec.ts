import type {
  AuditPage,
  Family,
  FamilyStatement,
  OutstandingPage,
  PatientAccount,
  Receipt,
  Receivables,
  Statement,
  TransactionPage,
  Branch,
  OpeningBalanceResult,
  Patient,
  PatientBalance,
  PaymentPreview,
  ProblemDetails,
  RecordPaymentResult,
  ServiceItem,
  ServiceResult,
  StaffUser,
  StartVisitResult,
  Visit,
  VisitBalance,
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

interface Staff {
  agent: TestAgent;
  user: StaffUser;
}

const problem = (body: unknown) => body as ProblemDetails;

describe('billing: payments, refunds, voids and credit (feature 5)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let owner: TestAgent;
  let dentist: Staff;
  let frontdesk: Staff;
  let procedure: ServiceItem;

  const ok = async <T>(request: Promise<{ status: number; body: unknown }>, status = 200) => {
    const response = await request;
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    return response.body as T;
  };

  const createStaff = async (role: 'dentist' | 'frontdesk', branch: Branch): Promise<Staff> => {
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

  const newPatient = (fullName: string) =>
    ok<Patient>(owner.post('/api/v1/patients').send({ fullName, phone: '71 000 000' }), 201);

  const patientOwing = async (fullName: string, amount: string, asOf: string) =>
    (
      await ok<OpeningBalanceResult>(
        owner.post('/api/v1/billing/opening-balances').send({
          patient: { fullName, phone: '71 000 000' },
          openingBalance: { amount, asOf },
        }),
        201,
      )
    ).patient;

  /** A completed visit of `total`, charged on `date` (the clock is left there). */
  const completedVisit = async (patient: Patient, total: string, date: string): Promise<Visit> => {
    testApp.clock.set(at(date));
    const { visit } = await ok<StartVisitResult>(
      dentist.agent
        .post('/api/v1/visits')
        .send({ patientId: patient.id, dentistId: dentist.user.profileId }),
      201,
    );
    const added = await ok<ServiceResult>(
      dentist.agent
        .post(`/api/v1/visits/${visit.id}/services`)
        .send({ procedureId: procedure.id, toothCode: '16' }),
      201,
    );
    await ok(
      dentist.agent
        .patch(`/api/v1/visits/${visit.id}/services/${added.record.id}`)
        .send({ baseAmount: total }),
    );
    return (await ok<VisitResult>(dentist.agent.post(`/api/v1/visits/${visit.id}/complete`))).visit;
  };

  const pay = (agent: TestAgent, body: Record<string, unknown>, key = newId()) =>
    agent
      .post('/api/v1/billing/payments')
      .set('Idempotency-Key', key)
      .send({ method: 'cash', paidAt: TODAY, ...body });

  const paid = async (agent: TestAgent, body: Record<string, unknown>) =>
    ok<RecordPaymentResult>(pay(agent, body), 201);

  const balanceOf = async (patientId: string) =>
    (await ok<PatientBalance>(owner.get(`/api/v1/billing/patients/${patientId}/balance`))).balances;

  const visitBalances = async (...visits: Visit[]) => {
    const rows = await ok<VisitBalance[]>(
      owner.get(`/api/v1/billing/visits/balances?visitIds=${visits.map((v) => v.id).join(',')}`),
    );
    return visits.map((visit) => rows.find((row) => row.visitId === visit.id)?.outstanding);
  };

  const unpaidIds = async (patientId: string) =>
    (
      await ok<{ items: { id: string }[] }>(
        owner.get(`/api/v1/billing/visits/unpaid?range=all&patientId=${patientId}`),
      )
    ).items.map((item) => item.id);

  const allocationKinds = async (patientId: string) =>
    (
      await database.ownerPool.query<{ kind: string; amount: string }>(
        `select a.kind, a.amount::text from payment_allocations a
         join ledger_entries s on s.id = a.source_entry_id
         where s.patient_id = $1 order by a.seq`,
        [patientId],
      )
    ).rows;

  const visitEntryId = async (visit: Visit) => {
    const { rows } = await database.ownerPool.query<{ id: string }>(
      `select id from ledger_entries where visit_id = $1 and kind = 'visit_charge'`,
      [visit.id],
    );
    return rows[0]?.id;
  };

  const amendDiscount = async (visit: Visit, value: string) => {
    const services = (
      await database.ownerPool.query<{ id: string }>(
        'select id from visit_services where visit_id = $1',
        [visit.id],
      )
    ).rows.map((row) => ({ id: row.id }));
    return ok<VisitResult>(
      dentist.agent.post(`/api/v1/visits/${visit.id}/amend`).send({
        expectedUpdatedAt: visit.updatedAt,
        reason: 'Price agreed after the visit',
        discount: { mode: 'amount', value },
        services,
      }),
    );
  };

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
        clinic: { name: 'Payments Clinic', slug: `pay-${newId().slice(-12)}` },
        firstBranch: { name: 'Payments Main' },
        owner: { displayName: 'Payments Owner', email: ownerEmail, temporaryPassword: TEMPORARY },
      }),
      201,
    );
    owner = await signInAndSetPassword(testApp.app, ownerEmail, TEMPORARY);
    const [branch] = (await owner.get('/api/v1/branches')).body as Branch[];
    if (!branch) throw new Error('provisioning created no branch');
    const [service] = await ok<ServiceItem[]>(
      owner.put('/api/v1/catalog/services').send({
        items: [{ code: 'ZANY', name: 'Any treatment', chargeUnit: 'per_tooth', price: '1' }],
      }),
    );
    if (!service) throw new Error('no service');
    procedure = service;
    dentist = await createStaff('dentist', branch);
    frontdesk = await createStaff('frontdesk', branch);
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  /** Opening balance $200 (May), then visits of $300, $400 and $100 in June. */
  const acceptanceAccount = async (name: string) => {
    const patient = await patientOwing(name, '200', '2026-05-01');
    const v1 = await completedVisit(patient, '300', '2026-06-01');
    const v2 = await completedVisit(patient, '400', '2026-06-05');
    const v3 = await completedVisit(patient, '100', TODAY);
    return { patient, v1, v2, v3 };
  };

  it('a $500 payment covers the opening balance and the oldest visit (acceptance 1)', async () => {
    const { patient, v1, v2, v3 } = await acceptanceAccount('Oldest First');
    const preview = await ok<PaymentPreview>(
      frontdesk.agent
        .post('/api/v1/billing/payments/preview')
        .send({ patientId: patient.id, amount: '500', method: 'cash', paidAt: TODAY }),
    );
    expect(preview).toMatchObject({ outstanding: '1000.00', remaining: '500.00', error: null });
    expect(preview.allocations.map((line) => [line.kind, line.amount])).toEqual([
      ['opening_balance', '200.00'],
      ['visit_charge', '300.00'],
    ]);
    expect(await allocationKinds(patient.id)).toEqual([]);

    const result = await paid(frontdesk.agent, { patientId: patient.id, amount: '500' });
    expect(result).toMatchObject({ amount: '500.00', remaining: '500.00', householdGroupId: null });
    expect(result.allocations.map((line) => [line.visitNumber, line.amount])).toEqual([
      [null, '200.00'],
      [v1.displayNumber, '300.00'],
    ]);
    expect(await balanceOf(patient.id)).toEqual([{ amount: '500.00', currency: 'USD' }]);
    expect(await visitBalances(v1, v2, v3)).toEqual(['0.00', '400.00', '100.00']);
    expect((await unpaidIds(patient.id)).sort()).toEqual([v2.id, v3.id].sort());

    const second = await paid(owner, { patientId: patient.id, amount: '1' });
    expect(second.receiptNumber).toBe(result.receiptNumber + 1);
  });

  it('from the post-visit summary the visit comes first, then the oldest; over the cap is refused (acceptance 2)', async () => {
    const { patient, v1, v2, v3 } = await acceptanceAccount('Context First');
    const result = await paid(owner, {
      patientId: patient.id,
      amount: '650',
      contextVisitId: v3.id,
    });
    expect(result.allocations.map((line) => [line.visitId, line.amount])).toEqual([
      [v3.id, '100.00'],
      [null, '200.00'],
      [v1.id, '300.00'],
      [v2.id, '50.00'],
    ]);
    const over = await pay(owner, { patientId: patient.id, amount: '350.01' });
    expect(over.status).toBe(422);
    expect(problem(over.body).code).toBe('payment.over_outstanding');

    await paid(owner, { patientId: patient.id, amount: '350' });
    expect(await balanceOf(patient.id)).toEqual([]);
    const nothing = await pay(owner, { patientId: patient.id, amount: '1' });
    expect(nothing.status).toBe(422);
    expect(problem(nothing.body).code).toBe('payment.nothing_outstanding');
  });

  it('caps a chosen visit at its outstanding and lets the rest follow the order (B4)', async () => {
    const { patient, v2 } = await acceptanceAccount('Chosen Visit');
    const targetEntryId = await visitEntryId(v2);
    const result = await paid(owner, { patientId: patient.id, amount: '500', targetEntryId });
    expect(result.allocations.map((line) => [line.visitId, line.amount])).toEqual([
      [v2.id, '400.00'],
      [null, '100.00'],
    ]);
    const manual = await database.ownerPool.query<{ manual: boolean }>(
      'select manual from payment_allocations where target_entry_id = $1',
      [targetEntryId],
    );
    expect(manual.rows).toEqual([{ manual: true }]);
  });

  it('a paid visit cannot be voided until refunded; a refund reopens it (acceptance 3, B6, B7)', async () => {
    const patient = await newPatient('Refund First');
    const visit = await completedVisit(patient, '300', TODAY);
    const payment = await paid(frontdesk.agent, { patientId: patient.id, amount: '300' });
    const paymentId = payment.paymentIds[0] ?? '';

    const refused = await dentist.agent
      .post(`/api/v1/visits/${visit.id}/void`)
      .send({ expectedUpdatedAt: visit.updatedAt, reason: 'Wrong patient' });
    expect(refused.status).toBe(409);
    expect(problem(refused.body).code).toBe('visit.has_payments');

    const forbidden = await frontdesk.agent
      .post(`/api/v1/billing/payments/${paymentId}/refund`)
      .send({ amount: '300', reason: 'Charged the wrong patient' });
    expect(forbidden.status).toBe(403);

    const tooMuch = await dentist.agent
      .post(`/api/v1/billing/payments/${paymentId}/refund`)
      .send({ amount: '300.01', reason: 'Charged the wrong patient' });
    expect(tooMuch.status).toBe(409);
    expect(problem(tooMuch.body).code).toBe('payment.over_refund');

    await ok(
      dentist.agent
        .post(`/api/v1/billing/payments/${paymentId}/refund`)
        .send({ amount: '300', reason: 'Charged the wrong patient' }),
      201,
    );
    expect(await visitBalances(visit)).toEqual(['300.00']);
    expect(await balanceOf(patient.id)).toEqual([{ amount: '300.00', currency: 'USD' }]);

    const audit = await ok<AuditPage>(
      owner.get(`/api/v1/audit?resourceType=payment&resourceId=${paymentId}&limit=10`),
    );
    const refundEntry = audit.items.find((entry) => entry.action === 'payment.refund');
    expect(refundEntry?.reason).toBe('Charged the wrong patient');
    expect(refundEntry?.after).toMatchObject({
      releases: [{ amount: '-300.00' }],
    });

    await ok(
      dentist.agent
        .post(`/api/v1/visits/${visit.id}/void`)
        .send({ expectedUpdatedAt: visit.updatedAt, reason: 'Wrong patient' }),
    );
    expect(await balanceOf(patient.id)).toEqual([]);
  });

  it('a partial refund reopens part of the visit; a void is then refused (P6, P7)', async () => {
    const patient = await newPatient('Partial Refund');
    const visit = await completedVisit(patient, '200', TODAY);
    const payment = await paid(owner, { patientId: patient.id, amount: '200' });
    const paymentId = payment.paymentIds[0] ?? '';
    await ok(
      owner
        .post(`/api/v1/billing/payments/${paymentId}/refund`)
        .send({ amount: '50', reason: 'Goodwill refund' }),
      201,
    );
    expect(await visitBalances(visit)).toEqual(['50.00']);
    const voided = await owner
      .post(`/api/v1/billing/payments/${paymentId}/void`)
      .send({ reason: 'Entered twice' });
    expect(voided.status).toBe(409);
    expect(problem(voided.body).code).toBe('payment.has_refunds');
  });

  it('voids a mis-entered payment: everything it covered reopens', async () => {
    const patient = await newPatient('Void Payment');
    const visit = await completedVisit(patient, '120', TODAY);
    const payment = await paid(owner, { patientId: patient.id, amount: '120' });
    await ok(
      owner
        .post(`/api/v1/billing/payments/${payment.paymentIds[0] ?? ''}/void`)
        .send({ reason: 'Entered on the wrong patient' }),
      201,
    );
    expect(await visitBalances(visit)).toEqual(['120.00']);
    expect(await balanceOf(patient.id)).toEqual([{ amount: '120.00', currency: 'USD' }]);
    const again = await owner
      .post(`/api/v1/billing/payments/${payment.paymentIds[0] ?? ''}/void`)
      .send({ reason: 'Entered on the wrong patient' });
    expect(again.status).toBe(409);
  });

  it('credit from amending a paid visit covers open charges at once, then the next visit (B3)', async () => {
    const patient = await newPatient('Credit Flow');
    const covered = await completedVisit(patient, '200', '2026-06-01');
    await paid(owner, { patientId: patient.id, amount: '200', paidAt: '2026-06-01' });
    const open = await completedVisit(patient, '30', '2026-06-02');

    // $80 off the paid visit: $30 covers the open visit at once, $50 stays as credit.
    await amendDiscount(covered, '80');
    expect(await visitBalances(covered, open)).toEqual(['0.00', '0.00']);
    expect(await balanceOf(patient.id)).toEqual([{ amount: '-50.00', currency: 'USD' }]);

    const next = await completedVisit(patient, '100', TODAY);
    expect(await visitBalances(next)).toEqual(['50.00']);
    expect(await balanceOf(patient.id)).toEqual([{ amount: '50.00', currency: 'USD' }]);
    expect((await allocationKinds(patient.id)).map((row) => row.kind)).toEqual([
      'allocation',
      'release',
      'credit_applied',
      'credit_applied',
    ]);
  });

  it('a write-off covers the oldest charges, so visit statuses agree with the balance', async () => {
    const patient = await patientOwing('Write Off', '40', '2026-05-01');
    const visit = await completedVisit(patient, '100', TODAY);
    await ok(
      owner
        .post(`/api/v1/billing/patients/${patient.id}/adjustments`)
        .send({ amount: '-90', effectiveDate: TODAY, reason: 'Hardship write-off' }),
      201,
    );
    expect(await visitBalances(visit)).toEqual(['50.00']);
    expect(await balanceOf(patient.id)).toEqual([{ amount: '50.00', currency: 'USD' }]);
  });

  it('a household payment pays each account oldest charge first under one receipt (B5)', async () => {
    const father = await patientOwing('Household Father', '30', '2026-05-01');
    const child2 = await patientOwing('Household Younger', '80', '2026-05-02');
    const child1 = await patientOwing('Household Elder', '120', '2026-05-03');
    for (const child of [child1, child2]) {
      await ok(
        owner.post(`/api/v1/patients/${child.id}/contacts`).send({
          target: { patientId: father.id },
          relationship: 'parent',
          isBillingContact: true,
        }),
        201,
      );
    }
    const preview = await ok<PaymentPreview>(
      owner.post('/api/v1/billing/payments/preview').send({
        patientId: child1.id,
        amount: '150',
        method: 'card',
        paidAt: TODAY,
        scope: 'household',
      }),
    );
    expect(preview.outstanding).toBe('230.00');

    const result = await paid(owner, {
      patientId: child1.id,
      amount: '150',
      method: 'card',
      scope: 'household',
    });
    expect(result.paymentIds).toHaveLength(3);
    expect(result.householdGroupId).not.toBeNull();
    expect(result.allocations.map((line) => [line.patientId, line.amount])).toEqual([
      [father.id, '30.00'],
      [child2.id, '80.00'],
      [child1.id, '40.00'],
    ]);
    const rows = await database.ownerPool.query<{ patient_id: string; receipt_number: number }>(
      'select patient_id, receipt_number from payments where household_group_id = $1',
      [result.householdGroupId],
    );
    expect(new Set(rows.rows.map((row) => row.receipt_number))).toEqual(
      new Set([result.receiptNumber]),
    );
    expect(await balanceOf(child1.id)).toEqual([{ amount: '80.00', currency: 'USD' }]);
    expect(await balanceOf(child2.id)).toEqual([]);
  });

  it('replays an Idempotency-Key and refuses it for another payment (P11)', async () => {
    const patient = await patientOwing('Idempotent', '100', '2026-05-01');
    const key = newId();
    const first = await pay(owner, { patientId: patient.id, amount: '40' }, key);
    const replay = await pay(owner, { patientId: patient.id, amount: '40' }, key);
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect((replay.body as RecordPaymentResult).receiptNumber).toBe(
      (first.body as RecordPaymentResult).receiptNumber,
    );
    expect(await balanceOf(patient.id)).toEqual([{ amount: '60.00', currency: 'USD' }]);

    const other = await pay(owner, { patientId: patient.id, amount: '41' }, key);
    expect(other.status).toBe(409);
    expect(problem(other.body).code).toBe('payment.idempotency_mismatch');
    const missing = await owner
      .post('/api/v1/billing/payments')
      .send({ patientId: patient.id, amount: '1', method: 'cash', paidAt: TODAY });
    expect(missing.status).toBe(422);
  });

  it('two payments of the whole balance at once: one succeeds, the other is over the cap', async () => {
    const patient = await patientOwing('Race', '70', '2026-05-01');
    const responses = await Promise.all([
      pay(owner, { patientId: patient.id, amount: '70' }),
      pay(frontdesk.agent, { patientId: patient.id, amount: '70' }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 422]);
    expect(await balanceOf(patient.id)).toEqual([]);
  });

  it('settles an account written before payments existed before capping a payment', async () => {
    const patient = await patientOwing('Legacy Write Off', '100', '2026-05-01');
    // A feature 3 write-off, as it sits in a database migrated from before payments: no
    // allocations, so the opening balance still looks wholly unpaid.
    const tenantId = (
      await database.ownerPool.query<{ tenant_id: string }>(
        'select tenant_id from patients where id = $1',
        [patient.id],
      )
    ).rows[0]?.tenant_id;
    await database.ownerPool.query(
      `insert into ledger_entries (id, tenant_id, patient_id, kind, amount, currency,
         effective_date, reason, created_by)
       values (gen_random_uuid(), $1, $2, 'adjustment', -40, 'USD', '2026-05-02', 'Old write-off',
         gen_random_uuid())`,
      [tenantId, patient.id],
    );
    const over = await pay(owner, { patientId: patient.id, amount: '60.01' });
    expect(over.status).toBe(422);
    expect(problem(over.body).code).toBe('payment.over_outstanding');
    await paid(owner, { patientId: patient.id, amount: '60' });
    expect(await balanceOf(patient.id)).toEqual([]);
  });

  it('a retry sent while the first request runs replays it instead of failing the cap', async () => {
    const patient = await patientOwing('Retry In Flight', '90', '2026-05-01');
    const key = newId();
    const responses = await Promise.all([
      pay(owner, { patientId: patient.id, amount: '90' }, key),
      pay(owner, { patientId: patient.id, amount: '90' }, key),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const [first, second] = responses.map((response) => response.body as RecordPaymentResult);
    expect(second?.receiptNumber).toBe(first?.receiptNumber);
    expect(await balanceOf(patient.id)).toEqual([]);
  });

  it('replays a household payment that paid only a sibling', async () => {
    const parent = await newPatient('Replay Parent');
    const older = await patientOwing('Replay Older Child', '200', '2026-05-01');
    const younger = await patientOwing('Replay Younger Child', '50', TODAY);
    for (const child of [older, younger]) {
      await ok(
        owner.post(`/api/v1/patients/${child.id}/contacts`).send({
          target: { patientId: parent.id },
          relationship: 'parent',
          isBillingContact: true,
        }),
        201,
      );
    }
    const key = newId();
    const body = { patientId: younger.id, amount: '100', scope: 'household' };
    const first = await pay(owner, body, key);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect((first.body as RecordPaymentResult).allocations.map((line) => line.patientId)).toEqual([
      older.id,
    ]);
    const replay = await pay(owner, body, key);
    expect(replay.status, JSON.stringify(replay.body)).toBe(201);
    expect((replay.body as RecordPaymentResult).receiptNumber).toBe(
      (first.body as RecordPaymentResult).receiptNumber,
    );
  });

  it('shows a billing contact’s family: members, total, statement, and Outstanding by payer', async () => {
    const parent = await patientOwing('Family Parent', '30', '2026-05-01');
    const elder = await patientOwing('Family Elder', '120', '2026-05-03');
    const younger = await patientOwing('Family Younger', '80', '2026-05-02');
    for (const child of [elder, younger]) {
      await ok(
        owner.post(`/api/v1/patients/${child.id}/contacts`).send({
          target: { patientId: parent.id },
          relationship: 'parent',
          isBillingContact: true,
        }),
        201,
      );
    }
    const [link] = await ok<{ contact: { id: string } }[]>(
      owner.get(`/api/v1/patients/${elder.id}/contacts`),
    );
    const contactId = link?.contact.id ?? '';

    const family = await ok<Family>(
      frontdesk.agent.get(`/api/v1/billing/contacts/${contactId}/family`),
    );
    expect(family).toMatchObject({
      payer: { contactId, name: 'Family Parent', patientId: parent.id },
      total: '230.00',
    });
    expect(
      family.members.map((member) => [member.fullName, member.balance, member.isPayer]),
    ).toEqual([
      ['Family Parent', '30.00', true],
      ['Family Elder', '120.00', false],
      ['Family Younger', '80.00', false],
    ]);
    expect([elder.id, younger.id]).toContain(family.payFor);

    const statement = await ok<FamilyStatement>(
      owner.get(`/api/v1/billing/contacts/${contactId}/family/statement`),
    );
    expect(statement.members.map((member) => member.outstanding)).toEqual([
      '30.00',
      '120.00',
      '80.00',
    ]);
    expect(statement.total).toBe('230.00');

    const parentAccount = await ok<PatientAccount>(
      owner.get(`/api/v1/billing/patients/${parent.id}/account`),
    );
    expect(parentAccount.payerFor).toEqual({
      contactId,
      name: 'Family Parent',
      patientId: parent.id,
    });
    const viaPayer = await ok<PatientAccount>(
      owner.get(`/api/v1/billing/patients/${younger.id}/account?payerContactId=${contactId}`),
    );
    expect(viaPayer.household?.total).toBe('230.00');

    const q = encodeURIComponent('Family');
    const byPayer = await ok<OutstandingPage>(
      owner.get(`/api/v1/billing/outstanding?group=payer&q=${q}`),
    );
    expect(byPayer.items).toHaveLength(1);
    expect(byPayer.items[0]).toMatchObject({
      payer: { contactId, name: 'Family Parent' },
      oldestUnpaid: '2026-05-01',
      balance: '230.00',
    });
    expect(byPayer.items[0]?.members.map((member) => member.fullName)).toEqual([
      'Family Parent',
      'Family Younger',
      'Family Elder',
    ]);
    expect([elder.id, younger.id]).toContain(byPayer.items[0]?.payFor);
    const byPatient = await ok<OutstandingPage>(owner.get(`/api/v1/billing/outstanding?q=${q}`));
    expect(
      byPatient.items.map((item) => [item.patient.fullName, item.payer?.name ?? null]),
    ).toEqual([
      ['Family Parent', null],
      ['Family Younger', 'Family Parent'],
      ['Family Elder', 'Family Parent'],
    ]);
  });

  it('serves the account, history, receipt, statement, transactions, aging and outstanding (smoke)', async () => {
    const { patient, v1, v2, v3 } = await acceptanceAccount('Read Views');
    const result = await paid(owner, { patientId: patient.id, amount: '500', reference: 'POS 1' });
    const paymentId = result.paymentIds[0] ?? '';
    const q = encodeURIComponent('Read Views');

    const account = await ok<PatientAccount>(
      frontdesk.agent.get(`/api/v1/billing/patients/${patient.id}/account`),
    );
    expect(account).toMatchObject({
      balance: '500.00',
      credit: '0.00',
      lastVisit: { visitId: v3.id, total: '100.00', outstanding: '100.00' },
      previousOutstanding: '400.00',
      payer: { contactId: null, name: 'Read Views' },
      household: null,
    });
    expect(account.openCharges.map((charge) => charge.visitId)).toEqual([v2.id, v3.id]);
    expect(account.history).toHaveLength(1);
    expect(account.history[0]).toMatchObject({
      amount: '500.00',
      remaining: '500.00',
      partial: true,
      visits: [{ visitId: v1.id, visitNumber: v1.displayNumber }],
    });

    const receipt = await ok<Receipt>(owner.get(`/api/v1/billing/payments/${paymentId}/receipt`));
    expect(receipt).toMatchObject({ receiptNumber: result.receiptNumber, total: '500.00' });
    expect(receipt.rows[0]?.allocations.map((line) => line.amount)).toEqual(['200.00', '300.00']);

    const statement = await ok<Statement>(
      owner.get(`/api/v1/billing/patients/${patient.id}/statement`),
    );
    expect(statement.lines.map((line) => [line.kind, line.balance])).toEqual([
      ['opening_balance', '200.00'],
      ['charge', '500.00'],
      ['charge', '900.00'],
      ['charge', '1000.00'],
      ['payment', '500.00'],
    ]);
    expect(statement).toMatchObject({ charged: '1000.00', paid: '500.00', outstanding: '500.00' });

    const byPatient = await ok<TransactionPage>(
      owner.get(`/api/v1/billing/payments?range=all&q=${q}`),
    );
    expect(byPatient.items.map((item) => item.id)).toEqual([paymentId]);
    const byReceipt = await ok<TransactionPage>(
      owner.get(`/api/v1/billing/payments?range=all&q=RCT-${result.receiptNumber}`),
    );
    expect(byReceipt.items.map((item) => item.id)).toContain(paymentId);
    const byVisit = await ok<TransactionPage>(
      owner.get(`/api/v1/billing/payments?range=all&q=V-${v1.displayNumber}`),
    );
    expect(byVisit.items.map((item) => item.id)).toEqual([paymentId]);
    const firstPage = await ok<TransactionPage>(
      owner.get('/api/v1/billing/payments?range=all&limit=1'),
    );
    expect(firstPage.nextCursor).not.toBeNull();
    const secondPage = await ok<TransactionPage>(
      owner.get(`/api/v1/billing/payments?range=all&limit=1&cursor=${firstPage.nextCursor ?? ''}`),
    );
    expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);

    const csv = await owner.get('/api/v1/billing/payments/export?range=all&lang=en');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('Date,Receipt,Patient');
    expect(csv.text).toContain('POS 1');

    const aging = await ok<Receivables>(owner.get('/api/v1/billing/aging'));
    expect(aging.buckets.map((bucket) => bucket.bucket)).toEqual([
      'd0_30',
      'd31_60',
      'd61_90',
      'd90_plus',
    ]);
    expect(Number(aging.collected30d)).toBeGreaterThanOrEqual(500);

    const outstanding = await ok<OutstandingPage>(owner.get(`/api/v1/billing/outstanding?q=${q}`));
    expect(outstanding.items).toEqual([
      expect.objectContaining({
        oldestUnpaid: '2026-06-05',
        openVisits: 2,
        bucket: 'd0_30',
        balance: '500.00',
      }),
    ]);
    const noneOld = await ok<OutstandingPage>(
      owner.get(`/api/v1/billing/outstanding?bucket=d90_plus&q=${q}`),
    );
    expect(noneOld.items).toEqual([]);
  });
});
