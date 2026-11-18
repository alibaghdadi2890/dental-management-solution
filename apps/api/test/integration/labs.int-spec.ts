import type {
  Appointment,
  AuditPage,
  ExpensePage,
  Lab,
  LabAccounts,
  LabOrder,
  LabOrderPage,
  LabOrderSummary,
  LabPayment,
  LabReport,
  LabService,
  LabStatement,
  LabToday,
  Patient,
  PatientPage,
  Role,
  StaffUser,
  StartVisitResult,
} from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../src/platform/kernel/id';
import { ok, provisionClinic, type StaffMember, type TestClinic } from '../support/clinic';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { signIn } from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';

/**
 * Feature 18 through the HTTP API: the prompt's acceptance in a USD clinic in Asia/Beirut (UTC+2
 * in November), open Monday to Saturday, with the owner, Dr. A and Jamie at the front desk. The app
 * clock moves across days, so everyone signs in as trusted (no idle timeout).
 */
describe('lab orders and lab accounts (feature 18)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let clinic: TestClinic;
  let owner: TestAgent;
  let drA: StaffMember;
  let jamie: StaffMember;
  let viewer: StaffMember;
  let drAId: string;
  let smile: Lab;
  let crownService: LabService;
  let guardService: LabService;

  /** `HH:MM` on `day` in Beirut. */
  const beirut = (day: string, time = '10:00') => `${day}T${time}:00+02:00`;
  const on = (day: string, time = '10:00') => {
    testApp.clock.set(new Date(beirut(day, time)));
  };

  const newPatient = async (name: string): Promise<Patient> =>
    ok<Patient>(
      owner
        .post('/api/v1/patients')
        .set('Idempotency-Key', newId())
        .send({ fullName: `${name} ${newId().slice(-6)}`, phone: '+96170123456' }),
      201,
    );

  const create = (agent: TestAgent, body: Record<string, unknown>, key = newId()) =>
    agent
      .post('/api/v1/lab-orders')
      .set('Idempotency-Key', key)
      .send({ dentistId: drAId, labId: smile.id, branchId: clinic.branch.id, ...body });

  const crown = (patientId: string, extra: Record<string, unknown> = {}) =>
    ok<LabOrder>(
      create(drA.agent, {
        patientId,
        items: [{ serviceId: crownService.id, target: 'teeth', teeth: ['26'], shade: 'A2' }],
        ...extra,
      }),
      201,
    );

  const act = (agent: TestAgent, id: string, action: string, body: object = {}, status = 200) =>
    ok<LabOrder>(agent.post(`/api/v1/lab-orders/${id}/${action}`).send(body), status);

  const send = (id: string, sentOn: string) =>
    act(jamie.agent, id, 'send', { sentOn, via: 'courier' });

  const receive = (ids: string[], receivedOn: string) =>
    ok<LabOrder[]>(
      jamie.agent.post('/api/v1/lab-orders/receive').send({ orderIds: ids, receivedOn }),
    );

  const order = (id: string, agent: TestAgent = owner) =>
    ok<LabOrder>(agent.get(`/api/v1/lab-orders/${id}`));

  const book = (patientId: string, startsAt: string) =>
    ok<Appointment>(
      jamie.agent.post('/api/v1/scheduling/appointments').set('Idempotency-Key', newId()).send({
        branchId: clinic.branch.id,
        patientId,
        dentistId: drAId,
        startsAt,
        durationMin: 30,
        reason: 'Crown fit',
        roomId: 'auto',
        override: true,
      }),
      201,
    );

  const today = () =>
    ok<LabToday>(jamie.agent.get(`/api/v1/lab-orders/today?branchId=${clinic.branch.id}`));

  const problem = async (request: PromiseLike<{ status: number; body: unknown }>) => {
    const response = await request;
    return { status: response.status, code: (response.body as { code?: string }).code };
  };

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    on('2026-11-09');
    clinic = await provisionClinic(testApp, 'Labs');
    await ok(
      clinic.owner.patch('/api/v1/tenant').send({ timeZone: 'Asia/Beirut', currency: 'USD' }),
    );
    const session = await ok<{ user: { email: string } }>(clinic.owner.get('/api/v1/session'));
    owner = await signIn(testApp.app, session.user.email, undefined, { rememberMe: true });
    const remembered = async (member: StaffMember): Promise<StaffMember> => ({
      ...member,
      agent: await signIn(testApp.app, member.user.email, undefined, { rememberMe: true }),
    });
    drA = await remembered(await clinic.staff(['dentist'], 'Dr. A'));
    jamie = await remembered(await clinic.staff(['frontdesk'], 'Jamie', 'assistant'));
    const role = await ok<Role>(owner.post('/api/v1/roles').send({ name: 'Lab viewer' }), 201);
    await ok(owner.patch(`/api/v1/roles/${role.id}`).send({ permissions: ['lab:read'] }));
    viewer = await remembered(await clinic.staff([role.key], 'Viewer', 'other'));
    const users = await ok<StaffUser[]>(owner.get('/api/v1/users'));
    drAId = users.find((user) => user.id === drA.user.id)?.profileId ?? '';

    smile = await ok<Lab>(
      owner.post('/api/v1/labs').send({
        name: 'Smile Lab',
        phone: '+9611222333',
        deliveryMethods: ['courier', 'email'],
        turnaroundDays: 7,
      }),
      201,
    );
    crownService = await ok<LabService>(
      owner.post(`/api/v1/labs/${smile.id}/services`).send({ name: 'Zirconia crown', price: '60' }),
      201,
    );
    guardService = await ok<LabService>(
      owner
        .post(`/api/v1/labs/${smile.id}/services`)
        .send({ name: 'Night guard', price: '35', turnaroundDays: 4 }),
      201,
    );
  }, 120_000);

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  describe('labs and prices (Part A)', () => {
    it('keeps names unique and hides prices from those without lab money', async () => {
      expect(
        await problem(
          owner.post('/api/v1/labs').send({
            name: 'smile LAB',
            deliveryMethods: ['courier'],
            turnaroundDays: 5,
          }),
        ),
      ).toEqual({ status: 409, code: 'lab.name_taken' });
      const seen = await ok<Lab[]>(drA.agent.get('/api/v1/labs'));
      const lab = seen.find((row) => row.id === smile.id);
      expect(lab?.services.map((service) => service.price)).toEqual([null, null]);
      expect((await problem(drA.agent.post('/api/v1/labs').send({}))).status).toBe(403);
    });

    it('applies a new price to new orders only, and deactivates a used service', async () => {
      on('2026-11-09');
      const patient = await newPatient('Price');
      const before = await crown(patient.id);
      await ok(
        owner.patch(`/api/v1/labs/${smile.id}/services/${crownService.id}`).send({ price: '70' }),
      );
      const after = await crown(patient.id);
      expect((await order(before.id)).cost).toBe('60.00');
      expect((await order(after.id)).cost).toBe('70.00');
      await ok(
        owner.patch(`/api/v1/labs/${smile.id}/services/${crownService.id}`).send({ price: '60' }),
      );
      const temp = await ok<LabService>(
        owner.post(`/api/v1/labs/${smile.id}/services`).send({ name: 'Temp', price: '5' }),
        201,
      );
      await ok(owner.patch(`/api/v1/labs/${smile.id}/services/${temp.id}`).send({ active: false }));
      expect(
        await problem(
          create(drA.agent, {
            patientId: patient.id,
            items: [{ serviceId: temp.id, target: 'upper' }],
          }),
        ),
      ).toEqual({ status: 422, code: 'lab.service_inactive' });
      for (const id of [before.id, after.id]) {
        await act(owner, id, 'cancel', { reason: 'test order' });
      }
    });
  });

  describe('the acceptance flow (Parts B, C)', () => {
    let rami: Patient;
    let crownOrder: LabOrder;
    let guardOrder: LabOrder;

    it('creates in a visit without prices, numbered, To send; a guard for the upper arch', async () => {
      on('2026-11-11', '09:00');
      rami = await newPatient('Rami');
      const visit = await ok<StartVisitResult>(
        drA.agent.post('/api/v1/visits').send({
          patientId: rami.id,
          dentistId: drAId,
          roomId: clinic.spareRoom.id,
          type: 'examination',
        }),
        201,
      );
      crownOrder = await crown(rami.id, { visitId: visit.visit.id });
      expect(crownOrder).toMatchObject({
        status: 'to_send',
        cost: null,
        expectedDays: 7,
        visitId: visit.visit.id,
        label: { kind: 'to_send' },
      });
      expect(crownOrder.items[0]).toMatchObject({ unitPrice: null, teeth: ['26'], shade: 'A2' });
      expect(crownOrder.displayNumber).toBeGreaterThan(0);
      guardOrder = await ok<LabOrder>(
        create(drA.agent, {
          patientId: rami.id,
          items: [{ serviceId: guardService.id, target: 'upper' }],
        }),
        201,
      );
      expect(guardOrder).toMatchObject({ expectedDays: 4 });
      expect(guardOrder.items[0]?.teeth).toEqual([]);
      expect(
        await problem(
          create(jamie.agent, {
            patientId: rami.id,
            items: [{ description: 'Splint', target: 'lower' }],
            cost: '12',
          }),
        ),
      ).toMatchObject({ status: 403 });
    });

    it('sends, links itself to the next booking, follows a move and drops a cancel', async () => {
      const sent = await send(crownOrder.id, '2026-11-11');
      expect(sent).toMatchObject({
        status: 'at_lab',
        expectedOn: '2026-11-18',
        promisedOn: '2026-11-18',
        label: { kind: 'at_lab', due: '2026-11-18' },
      });
      const tuesday = await book(rami.id, beirut('2026-11-17', '14:00'));
      expect((await order(crownOrder.id)).appointment).toMatchObject({ id: tuesday.id });
      expect((await order(crownOrder.id)).label?.tone).toBe('at_risk');
      const moved = await ok<Appointment>(
        jamie.agent
          .post(`/api/v1/scheduling/appointments/${tuesday.id}/reschedule`)
          .set('Idempotency-Key', newId())
          .send({ startsAt: beirut('2026-11-19', '14:00'), override: true }),
      );
      expect((await order(crownOrder.id)).appointment).toMatchObject({ id: moved.id });
      await ok(
        jamie.agent
          .post(`/api/v1/scheduling/appointments/${moved.id}/cancel`)
          .send({ reason: 'Travelling' }),
      );
      expect((await order(crownOrder.id)).appointment).toBeNull();
    });

    it('shows the same label in the patients list, the open orders and the filter', async () => {
      const open = await ok<LabOrderSummary[]>(jamie.agent.get('/api/v1/lab-orders/open'));
      expect(open.find((row) => row.id === crownOrder.id)?.label?.kind).toBe('at_lab');
      const filtered = await ok<PatientPage>(jamie.agent.get('/api/v1/labs/patients?lab=open'));
      expect(filtered.items.map((row) => row.id)).toContain(rami.id);
      expect((await problem(jamie.agent.get('/api/v1/patients?lab=open'))).status).toBe(422);
    });

    it('lists late work on Today once, received with an undo; not sent; arrived to book', async () => {
      on('2026-11-17');
      const fresh = await newPatient('Fresh');
      const unsent = await crown(fresh.id);
      const nextWeek = await newPatient('Later');
      const onTrack = await crown(nextWeek.id);
      await send(onTrack.id, '2026-11-17');
      const soonPatient = await newPatient('Soon');
      const soon = await crown(soonPatient.id);
      await send(soon.id, '2026-11-14');
      await send(guardOrder.id, '2026-11-12');
      await receive([guardOrder.id], '2026-11-16');
      const appointment = await book(rami.id, beirut('2026-11-19', '14:00'));
      on('2026-11-19', '08:00');
      const lane = await today();
      const reason = (id: string) =>
        lane.rows.filter((row) => row.order.id === id).map((row) => row.reason);
      expect(reason(crownOrder.id)).toEqual(['late']);
      expect(lane.rows.find((row) => row.order.id === crownOrder.id)?.order).toMatchObject({
        label: { kind: 'late', daysLate: 1 },
        appointment: { id: appointment.id },
      });
      expect(reason(unsent.id)).toEqual(['not_sent']);
      // Expected on the 24th: five days ahead, not yet. Expected on the 21st: two days ahead.
      expect(reason(onTrack.id)).toEqual([]);
      expect(reason(soon.id)).toEqual(['expected']);
      // The guard arrived, but the booking linked it to the 19th: not "to book".
      expect(reason(guardOrder.id)).toEqual([]);

      const [arrived] = await receive([crownOrder.id], '2026-11-19');
      expect(arrived?.label?.kind).toBe('arrived');
      expect((await today()).rows.some((row) => row.order.id === crownOrder.id)).toBe(false);
      const undone = await act(jamie.agent, crownOrder.id, 'undo', { step: 'received' });
      expect(undone.status).toBe('at_lab');
      expect((await today()).rows.find((row) => row.order.id === crownOrder.id)?.reason).toBe(
        'late',
      );
      await receive([crownOrder.id], '2026-11-19');
      for (const id of [unsent.id, onTrack.id, soon.id])
        await act(owner, id, 'cancel', { reason: 'test order' });
    });

    it('treats Monday as the next open day on a Saturday', async () => {
      on('2026-11-21');
      const patient = await newPatient('Monday');
      const placed = await crown(patient.id);
      await send(placed.id, '2026-11-21');
      await book(patient.id, beirut('2026-11-23', '09:00'));
      const lane = await today();
      expect(lane.nextOpenDay).toBe('2026-11-23');
      expect(lane.rows.find((row) => row.order.id === placed.id)?.reason).toBe('due');
      await act(owner, placed.id, 'cancel', { reason: 'test order' });
    });

    it('finishes with Fitted; sends back for a next stage as a second trip; remakes', async () => {
      on('2026-11-19', '15:00');
      const fitted = await act(drA.agent, crownOrder.id, 'outcome', { choice: 'fitted' });
      expect(fitted).toMatchObject({ status: 'done', label: null, undoable: ['done'] });

      const other = await newPatient('Stage');
      const staged = await crown(other.id);
      await send(staged.id, '2026-11-12');
      await receive([staged.id], '2026-11-18');
      const back = await act(drA.agent, staged.id, 'outcome', {
        choice: 'next_stage',
        note: 'Try-in ok',
      });
      expect(back).toMatchObject({ status: 'to_send', tripCount: 1 });
      const again = await send(staged.id, '2026-11-19');
      expect(again).toMatchObject({
        status: 'at_lab',
        tripCount: 2,
        displayNumber: staged.displayNumber,
      });
      expect(again.trips.map((trip) => trip.outcome)).toEqual(['next_stage', null]);
      await receive([staged.id], '2026-11-19');
      const remade = await act(drA.agent, staged.id, 'outcome', {
        choice: 'remake',
        reason: 'shade',
        borneBy: 'lab',
      });
      expect(remade.status).toBe('remake');
      expect((await order(staged.id)).cost).toBe('60.00');
    });

    it('raises no late alert on hold, resumes where it was, and asks a sent cancel what it costs', async () => {
      on('2026-11-25');
      const patient = await newPatient('Hold');
      const held = await crown(patient.id);
      await send(held.id, '2026-11-12');
      const paused = await act(jamie.agent, held.id, 'hold', { reason: 'Patient travelling' });
      expect(paused.label?.kind).toBe('on_hold');
      expect((await today()).rows.some((row) => row.order.id === held.id)).toBe(false);
      expect((await act(jamie.agent, held.id, 'resume')).status).toBe('at_lab');
      expect(
        (
          await problem(
            jamie.agent
              .post(`/api/v1/lab-orders/${held.id}/cancel`)
              .send({ reason: 'No longer needed', charge: '20' }),
          )
        ).status,
      ).toBe(403);
      const cancelled = await act(owner, held.id, 'cancel', {
        reason: 'No longer needed',
        charge: '20',
      });
      expect(cancelled).toMatchObject({ status: 'cancelled', cancelCharge: '20.00' });
    });
  });

  describe('lab money (Part D) and the expense mirror', () => {
    let money: Lab;

    it('owes the opening balance and the delivered work; a payment is an expense; a credit is not', async () => {
      on('2026-11-20');
      money = await ok<Lab>(
        owner.post('/api/v1/labs').send({
          name: 'Money Lab',
          deliveryMethods: ['courier'],
          turnaroundDays: 7,
        }),
        201,
      );
      const service = await ok<LabService>(
        owner.post(`/api/v1/labs/${money.id}/services`).send({ name: 'Crown', price: '60' }),
        201,
      );
      await ok(
        owner
          .put(`/api/v1/labs/${money.id}/opening-balance`)
          .send({ amount: '300', asOf: '2026-11-01' }),
      );
      const patient = await newPatient('Money');
      const place = async () =>
        ok<LabOrder>(
          create(drA.agent, {
            patientId: patient.id,
            labId: money.id,
            items: [{ serviceId: service.id, target: 'teeth', teeth: ['11'] }],
          }),
          201,
        );
      const delivered = await place();
      await send(delivered.id, '2026-11-12');
      await receive([delivered.id], '2026-11-19');
      const inProgress = await place();
      await send(inProgress.id, '2026-11-19');

      const account = async () =>
        (await ok<LabAccounts>(owner.get('/api/v1/labs/accounts'))).labs.find(
          (lab) => lab.labId === money.id,
        );
      expect(await account()).toMatchObject({
        outstanding: '360.00',
        inProgressCount: 1,
        inProgressAmount: '60.00',
      });

      const key = newId();
      const pay = () =>
        owner
          .post(`/api/v1/labs/${money.id}/payments`)
          .set('Idempotency-Key', key)
          .send({ paidOn: '2026-11-20', amount: '200', method: 'cash', reference: 'INV-7' });
      const payment = await ok<LabPayment>(pay(), 201);
      expect((await ok<LabPayment>(pay(), 201)).id).toBe(payment.id);
      expect((await account())?.outstanding).toBe('160.00');

      const expenses = async () =>
        (
          await ok<ExpensePage>(
            owner.get('/api/v1/expenses?from=2026-11-01&to=2026-11-30&includeVoided=true'),
          )
        ).items.filter((row) => row.source === 'lab');
      const [mirror] = await expenses();
      expect(mirror).toMatchObject({
        amount: '200.00',
        payee: 'Money Lab',
        sourceId: payment.id,
        voidedAt: null,
      });
      expect(
        (
          await problem(
            owner.post(`/api/v1/expenses/${mirror?.id ?? ''}/void`).send({ reason: 'not here' }),
          )
        ).code,
      ).toBe('expense.system_row');

      await ok(
        owner.post(`/api/v1/labs/payments/${payment.id}/void`).send({ reason: 'Wrong lab' }),
      );
      expect((await expenses())[0]?.voidedAt).not.toBeNull();
      expect((await account())?.outstanding).toBe('360.00');

      await ok(
        owner
          .post(`/api/v1/labs/${money.id}/adjustments`)
          .set('Idempotency-Key', newId())
          .send({ onDate: '2026-11-20', kind: 'credit', amount: '10', reason: 'Goodwill' }),
        201,
      );
      expect((await account())?.outstanding).toBe('350.00');
      expect(await expenses()).toHaveLength(1);

      const statement = await ok<LabStatement>(
        owner.get(`/api/v1/labs/${money.id}/statement?from=2026-11-15&to=2026-11-30`),
      );
      expect(statement.balanceBefore).toBe('300.00');
      expect(statement.lines.map((line) => [line.kind, line.amount, line.voided])).toEqual([
        ['order', '60.00', false],
        ['payment', '-200.00', true],
        ['adjustment', '-10.00', false],
      ]);
      expect(statement.balanceAfter).toBe('350.00');
    });

    it('keeps the currency once lab money exists', async () => {
      expect(await problem(owner.patch('/api/v1/tenant').send({ currency: 'EUR' }))).toMatchObject({
        status: 422,
        code: 'tenant.currency_locked',
      });
    });

    it('gives no money to the front desk or a viewer, and no actions to a viewer', async () => {
      expect((await problem(jamie.agent.get('/api/v1/labs/accounts'))).status).toBe(403);
      expect((await problem(viewer.agent.get('/api/v1/labs/accounts'))).status).toBe(403);
      expect(
        (
          await ok<LabToday>(
            viewer.agent.get(`/api/v1/lab-orders/today?branchId=${clinic.branch.id}`),
          )
        ).date,
      ).toBe('2026-11-20');
      const [any] = (await ok<LabOrderPage>(viewer.agent.get('/api/v1/lab-orders?limit=1'))).items;
      expect(
        (
          await problem(
            viewer.agent.post(`/api/v1/lab-orders/${any?.id ?? ''}/hold`).send({ reason: 'test' }),
          )
        ).status,
      ).toBe(403);
      const feed = await ok<AuditPage>(
        drA.agent.get('/api/v1/audit?feed=true&area=labs&limit=100'),
      );
      expect(
        feed.items.some(
          (row) => row.resourceType === 'lab_payment' || row.action === 'lab_order.cost',
        ),
      ).toBe(false);
      const ownerFeed = await ok<AuditPage>(
        owner.get('/api/v1/audit?feed=true&area=labs&limit=100'),
      );
      expect(ownerFeed.items.some((row) => row.resourceType === 'lab_payment')).toBe(true);
    });
  });

  describe('reports (Part E)', () => {
    it('judges the lab on the promised date; costs only with lab money', async () => {
      const query = `/api/v1/labs/reports?from=2026-11-01&to=2026-11-30&groupBy=lab`;
      const report = await ok<LabReport>(owner.get(query));
      const lab = report.rows.find((row) => row.key === smile.id);
      // The crown: sent 11 Nov, promised 18 Nov, received 19 Nov.
      expect(lab?.figures.orderIds.late).toContain(
        (await ok<LabOrderPage>(owner.get('/api/v1/lab-orders?status=done'))).items[0]?.id,
      );
      expect(lab?.figures.remakeLabRate).toBeGreaterThan(0);
      expect(lab?.figures.totalCost).not.toBeNull();
      const desk = await ok<LabReport>(jamie.agent.get(query));
      expect(desk.total.totalCost).toBeNull();
    });
  });

  describe('idempotency, merge and archive', () => {
    it('returns the first order for a retried create, refuses another body', async () => {
      const patient = await newPatient('Retry');
      const key = newId();
      const body = { patientId: patient.id, items: [{ description: 'Splint', target: 'lower' }] };
      const first = await ok<LabOrder>(create(drA.agent, body, key), 201);
      expect((await ok<LabOrder>(create(drA.agent, body, key), 201)).id).toBe(first.id);
      expect(await problem(create(drA.agent, { ...body, notes: 'other' }, key))).toEqual({
        status: 409,
        code: 'lab.idempotency_mismatch',
      });
    });

    it('refuses to archive a patient with open work, and moves orders on a merge', async () => {
      const kept = await newPatient('Kept');
      const dropped = await newPatient('Dropped');
      const placed = await crown(dropped.id);
      expect(
        await problem(owner.post('/api/v1/patients/archive').send({ ids: [dropped.id] })),
      ).toMatchObject({ status: 409, code: 'lab_order.patient_has_open_orders' });
      await ok(
        owner
          .post('/api/v1/patients/merge')
          .send({ keepId: kept.id, dropId: dropped.id, reason: 'Same person' }),
      );
      expect((await order(placed.id)).patient.id).toBe(kept.id);
    });
  });
});
