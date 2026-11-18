import type {
  Appointment,
  AppointmentListPage,
  ChargedVisitsSummary,
  ExpenseCategory,
  ExpensePage,
  FinancialCosts,
  FinancialDentists,
  FinancialMoney,
  FinancialOwes,
  FinancialReceivables,
  FinancialServices,
  Lab,
  OperationalAppointments,
  OperationalAttention,
  OperationalPatients,
  OperationalPlans,
  OperationalVisits,
  Patient,
  PatientPage,
  Receivables,
  ServiceItem,
  StartVisitResult,
  StaffUser,
  TransactionSummary,
  Visit,
  VisitResult,
} from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../src/platform/kernel/id';
import { localDate, zonedInstant } from '../../src/platform/kernel/local-date';
import { monthOf, previousMonth } from '../../src/platform/kernel/months';
import { grant, ok, provisionClinic, type TestClinic } from '../support/clinic';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { signIn } from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';

/**
 * Feature 19 (ADR-0087 to ADR-0092) through the HTTP API, on the acceptance clinic: USD,
 * Asia/Beirut, one branch open Mon–Sat 08:00–18:00 with two rooms. Allocations are stamped by
 * the database clock, so the suite works in the real current month and the one before it; the
 * app clock only dates visits and appointments.
 */
const TIME_ZONE = 'Asia/Beirut';
const TODAY = localDate(new Date(), TIME_ZONE);
const MONTH = monthOf(TODAY);
const PREVIOUS = previousMonth(MONTH);
/** A day of last month inside the comparison span (the same days as this month so far). */
const PREV_DAY = `${PREVIOUS}-01`;
const at = (date: string, time: string) => zonedInstant(date, time, TIME_ZONE);
const iso = (date: string, time: string) => at(date, time).toISOString();
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

describe('dashboards (feature 19)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let clinic: TestClinic;
  let owner: TestAgent;
  let drA: { agent: TestAgent; user: StaffUser };
  let drB: { agent: TestAgent; user: StaffUser };
  let jamie: { agent: TestAgent; user: StaffUser };
  let spender: { agent: TestAgent; user: StaffUser };
  let patient: Patient;
  let service: Record<'s1000' | 's2000' | 's1500' | 's800' | 's2150', ServiceItem>;

  const query = (extra = '') => `period=this_month${extra}`;
  const get = <T>(agent: TestAgent, path: string) => ok<T>(agent.get(`/api/v1/dashboards/${path}`));
  const clock = (date: string, time: string) => {
    testApp.clock.set(at(date, time));
  };

  const remembered = async (roles: string[], name: string, grants: string[] = []) => {
    const member = await clinic.staff(roles, name, roles.includes('dentist') ? 'dentist' : 'other');
    if (grants.length > 0) await grant(owner, member.user.id, grants);
    return {
      user: member.user,
      agent: await signIn(testApp.app, member.user.email, undefined, { rememberMe: true }),
    };
  };

  const newPatient = (name: string) =>
    ok<Patient>(
      owner
        .post('/api/v1/patients')
        .set('Idempotency-Key', newId())
        .send({ fullName: `${name} ${newId().slice(-6)}`, phone: '+96170123456' }),
      201,
    );

  const book = (dentist: StaffUser, patientId: string, date: string, time: string, minutes = 30) =>
    ok<Appointment>(
      owner
        .post('/api/v1/scheduling/appointments')
        .set('Idempotency-Key', newId())
        .send({
          branchId: clinic.branch.id,
          patientId,
          dentistId: dentist.profileId,
          startsAt: iso(date, time),
          durationMin: minutes,
          reason: 'Check-up',
          roomId: 'auto',
          override: true,
        }),
      201,
    );

  const scheduling = <T>(path: string, body: object = {}, status = 200) =>
    ok<T>(
      owner
        .post(`/api/v1/scheduling/appointments/${path}`)
        .set('Idempotency-Key', newId())
        .send(body),
      status,
    );

  /** A visit of `dentist` with `services`, from an appointment when given, completed. */
  const visit = async (
    dentist: StaffUser,
    services: ServiceItem[],
    options: { appointmentId?: string; discount?: string; patientId?: string } = {},
  ): Promise<Visit> => {
    const started = (
      await ok<StartVisitResult>(
        owner.post('/api/v1/visits').send({
          type: 'treatment',
          patientId: options.patientId ?? patient.id,
          dentistId: dentist.profileId,
          roomId: clinic.room.id,
          ...(options.appointmentId ? { appointmentId: options.appointmentId } : {}),
        }),
        201,
      )
    ).visit;
    for (const item of services) {
      await ok(
        owner.post(`/api/v1/visits/${started.id}/services`).send({ procedureId: item.id }),
        201,
      );
    }
    if (options.discount) {
      await ok(
        owner.patch(`/api/v1/visits/${started.id}/discount`).send({
          mode: 'amount',
          value: options.discount,
        }),
      );
    }
    return (await ok<VisitResult>(owner.post(`/api/v1/visits/${started.id}/complete`))).visit;
  };

  const pay = (amount: string, method: string) =>
    ok<{ paymentIds: string[] }>(
      owner.post('/api/v1/billing/payments').set('Idempotency-Key', newId()).send({
        patientId: patient.id,
        amount,
        method,
        paidAt: TODAY,
      }),
      201,
    );

  const category = (categories: ExpenseCategory[], key: string) => {
    const found = categories.find((row) => row.key === key);
    if (!found) throw new Error(`no category ${key}`);
    return found.id;
  };

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    testApp.clock.set(new Date());
    clinic = await provisionClinic(testApp, 'Dash');
    await ok(clinic.owner.patch('/api/v1/tenant').send({ timeZone: TIME_ZONE, currency: 'USD' }));
    const session = await ok<{ user: { email: string } }>(clinic.owner.get('/api/v1/session'));
    owner = await signIn(testApp.app, session.user.email, undefined, { rememberMe: true });
    drA = await remembered(['dentist'], 'Dr. A');
    drB = await remembered(['dentist'], 'Dr. B');
    jamie = await remembered(['frontdesk'], 'Jamie', ['dashboard:operational']);
    spender = await remembered(['frontdesk'], 'Spender', ['dashboard:financial', 'expense:read']);
    const hours = [0, 1, 2, 3, 4, 5, 6].map((day) => ({
      weekday: day,
      isOpen: day !== 0,
      from: '08:00',
      to: '18:00',
    }));
    await ok(
      owner
        .put(`/api/v1/scheduling/branches/${clinic.branch.id}/opening-hours`)
        .send({ days: hours }),
    );
    const items = await ok<ServiceItem[]>(
      owner.put('/api/v1/catalog/services').send({
        items: ['1000', '2000', '1500', '800', '2150'].map((price) => ({
          code: `D${price}`,
          name: `Service ${price}`,
          chargeUnit: 'per_mouth',
          price,
          category: price === '1500' ? 'Implants' : 'General',
        })),
      }),
    );
    const find = (code: string) => {
      const item = items.find((row) => row.code === code);
      if (!item) throw new Error(code);
      return item;
    };
    service = {
      s1000: find('D1000'),
      s2000: find('D2000'),
      s1500: find('D1500'),
      s800: find('D800'),
      s2150: find('D2150'),
    };
    patient = await newPatient('Dana');

    // Last month: one visit of 2,150 (the comparison), and two booked hours on one day.
    clock(PREV_DAY, '07:00');
    await book(drB.user, (await newPatient('Prev')).id, PREV_DAY, '09:00', 120);
    clock(PREV_DAY, '12:00');
    await visit(drB.user, [service.s2150]);

    // Today: six appointments due, one of them rescheduled once.
    clock(TODAY, '07:00');
    const others = await Promise.all(['P4', 'P5', 'P6'].map((name) => newPatient(name)));
    const a1 = await book(drA.user, patient.id, TODAY, '09:00');
    const a2 = await book(drA.user, patient.id, TODAY, '10:00');
    const a3 = await book(drB.user, patient.id, TODAY, '11:00');
    const a4 = await book(drA.user, others[0]?.id ?? '', TODAY, '12:00');
    const a5 = await book(drA.user, others[1]?.id ?? '', TODAY, '13:00');
    await book(drA.user, others[2]?.id ?? '', TODAY, '14:00');
    const moved = await scheduling<Appointment>(`${a5.id}/reschedule`, {
      startsAt: iso(TODAY, '13:30'),
      override: true,
    });
    await scheduling(`${moved.id}/cancel`, { reason: 'Travelling' });
    // Waits of 5, 12 and 20 minutes; Dr. A 1,000 and 2,000 less 200, Dr. B 1,500.
    const waits: [Appointment, string, string, ServiceItem, StaffUser, string?][] = [
      [a1, '09:00', '09:05', service.s1000, drA.user],
      [a2, '10:00', '10:12', service.s2000, drA.user, '200'],
      [a3, '11:00', '11:20', service.s1500, drB.user],
    ];
    for (const [appointment, arrived, started, item, dentist, discount] of waits) {
      clock(TODAY, arrived);
      await scheduling(`${appointment.id}/check-in`, { roomId: clinic.room.id });
      clock(TODAY, started);
      await visit(dentist, [item], {
        appointmentId: appointment.id,
        ...(discount ? { discount } : {}),
      });
    }
    clock(TODAY, '12:45');
    await scheduling(`${a4.id}/no-show`);
    // A visit of 800 completed then voided nets to zero.
    clock(TODAY, '15:00');
    const voided = await visit(drA.user, [service.s800]);
    await ok(
      owner
        .post(`/api/v1/visits/${voided.id}/void`)
        .send({ expectedUpdatedAt: voided.updatedAt, reason: 'Wrong patient' }),
    );
    // Collected: 1,000 cash, 1,500 card, 3,000 bank transfer, less a 500 cash refund.
    const cash = await pay('1000', 'cash');
    await pay('1500', 'card');
    await pay('3000', 'bank_transfer');
    await ok(
      owner
        .post(`/api/v1/billing/payments/${cash.paymentIds[0] ?? ''}/refund`)
        .send({ amount: '500', reason: 'Overpaid', method: 'cash' }),
      201,
    );
    // Costs: rent 450, electricity 138.50, a lab payment of 200; a voided expense counts nothing.
    const categories = await ok<ExpenseCategory[]>(owner.get('/api/v1/expenses/categories'));
    const spend = (key: string, amount: string) =>
      ok<{ id: string }>(
        owner
          .post('/api/v1/expenses')
          .set('Idempotency-Key', newId())
          .send({
            spentOn: TODAY,
            categoryId: category(categories, key),
            amount,
            method: 'cash',
          }),
        201,
      );
    await spend('rent', '450');
    await spend('electricity', '138.50');
    const mistake = await spend('water', '99');
    await ok(owner.post(`/api/v1/expenses/${mistake.id}/void`).send({ reason: 'Typo' }));
    const lab = await ok<Lab>(
      owner
        .post('/api/v1/labs')
        .send({ name: 'Smile Lab', deliveryMethods: ['courier'], turnaroundDays: 7 }),
      201,
    );
    await ok(
      owner
        .post(`/api/v1/labs/${lab.id}/payments`)
        .set('Idempotency-Key', newId())
        .send({ paidOn: TODAY, amount: '200', method: 'cash' }),
      201,
    );
    clock(TODAY, '20:00');
  }, 240_000);

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  describe('Financial', () => {
    it('counts production after discounts, a voided visit as nothing, and compares the same days', async () => {
      const money = await get<FinancialMoney>(owner, `financial/money?${query()}`);
      expect(money).toMatchObject({
        currency: 'USD',
        production: { current: '4300.00', previous: '2150.00' },
        visitsCharged: { current: 3, previous: 1 },
        discounts: { current: '200.00' },
        gross: { current: '4500.00' },
        collected: { current: '5000.00' },
      });
      expect(money.methods.filter((row) => row.amount !== '0.00')).toEqual([
        { method: 'cash', amount: '500.00' },
        { method: 'card', amount: '1500.00' },
        { method: 'bank_transfer', amount: '3000.00' },
      ]);
      expect(money.months.at(-1)).toMatchObject({ month: MONTH, production: '4300.00' });
    });

    it('equals the home screens: Payments total and the charged visits footer', async () => {
      const payments = await ok<TransactionSummary>(
        owner.get(`/api/v1/billing/payments/summary?from=${MONTH}-01&to=${TODAY}`),
      );
      expect(payments.collected).toBe('5000.00');
      const charged = await ok<ChargedVisitsSummary>(
        owner.get(
          `/api/v1/billing/visits/charged/summary?chargedFrom=${MONTH}-01&chargedTo=${TODAY}&branchId=all`,
        ),
      );
      expect(charged).toMatchObject({ count: 4, charged: '4300.00', discounts: '200.00' });
      const discounted = await ok<ChargedVisitsSummary>(
        owner.get(
          `/api/v1/billing/visits/charged/summary?chargedFrom=${MONTH}-01&chargedTo=${TODAY}&branchId=all&discounted=true`,
        ),
      );
      expect(discounted).toMatchObject({ count: 1, discounts: '200.00' });
      const receivables = await get<FinancialReceivables>(owner, 'financial/receivables');
      const aging = await ok<Receivables>(owner.get('/api/v1/billing/aging'));
      expect(receivables.total).toBe(aging.outstanding);
      expect(receivables.buckets.map((row) => row.amount)).toEqual(
        aging.buckets.map((row) => row.amount),
      );
      expect(receivables.largest[0]?.patientId).toBe(patient.id);
    });

    it('attributes production to dentists and to services', async () => {
      const dentists = await get<FinancialDentists>(owner, `financial/dentists?${query()}`);
      const row = (member: { user: StaffUser }) =>
        dentists.rows.find((entry) => entry.profileId === member.user.profileId);
      expect(row(drA)?.production).toBe('2800.00');
      expect(row(drB)?.production).toBe('1500.00');
      const collected = dentists.rows.reduce((total, entry) => total + Number(entry.collected), 0);
      expect(collected + Number(dentists.unallocated)).toBeCloseTo(5000, 2);
      const services = await get<FinancialServices>(owner, `financial/services?${query()}`);
      expect(services.services.map((entry) => [entry.code, entry.amount])).toEqual([
        ['D2000', '1800.00'],
        ['D1500', '1500.00'],
        ['D1000', '1000.00'],
      ]);
      expect(services.categories).toEqual([
        { category: 'General', amount: '2800.00' },
        { category: 'Implants', amount: '1500.00' },
      ]);
    });

    it('shows complete cost to the owner only, equal to the Expenses screen', async () => {
      const costs = await get<FinancialCosts>(owner, `financial/costs?${query()}`);
      expect(costs.completeCost).toBe(true);
      expect(costs.total?.current).toBe('788.50');
      const screen = await ok<ExpensePage>(
        owner.get(`/api/v1/expenses?from=${MONTH}-01&to=${TODAY}`),
      );
      expect(screen.total.amount).toBe(costs.total?.current);
      expect(costs.groups?.find((group) => group.group === 'lab_fees')?.amount).toBe('200.00');

      const reduced = await get<FinancialCosts>(spender.agent, `financial/costs?${query()}`);
      expect(reduced).toMatchObject({
        completeCost: false,
        total: null,
        months: null,
        groups: null,
      });
      expect(reduced.categories.map((row) => row.key).sort()).toEqual([
        'electricity',
        'lab_fees',
        'rent',
      ]);
      const acting = await clinic.admin
        .get(`/api/v1/dashboards/financial/costs?${query()}`)
        .set('X-Tenant-Id', clinic.tenant.id);
      expect(acting.status, JSON.stringify(acting.body)).toBe(200);
      expect((acting.body as FinancialCosts).completeCost).toBe(false);
    });

    it('lists what the clinic owes, each line with its permission', async () => {
      const owes = await get<FinancialOwes>(owner, 'financial/owes');
      expect(owes.labs).toBe('-200.00');
      expect(owes.salaries).toBe('0.00');
      expect(owes.credit).toBe('0.00');
      const reduced = await get<FinancialOwes>(spender.agent, 'financial/owes');
      expect(reduced).toMatchObject({ labs: null, salaries: null, dentists: null });
      expect(reduced.fixed).not.toBeNull();
    });

    it('keeps production to a branch, and refuses without the capability', async () => {
      const other = await get<FinancialMoney>(
        owner,
        `financial/money?${query(`&branchId=${newId()}`)}`,
      );
      expect(other.production.current).toBe('0.00');
      const mine = await get<FinancialMoney>(
        owner,
        `financial/money?${query(`&branchId=${clinic.branch.id}`)}`,
      );
      expect(mine.production.current).toBe('4300.00');
      expect((await jamie.agent.get(`/api/v1/dashboards/financial/money?${query()}`)).status).toBe(
        403,
      );
      expect((await drA.agent.get(`/api/v1/dashboards/operational/visits?${query()}`)).status).toBe(
        403,
      );
    });
  });

  describe('Operational', () => {
    it('counts due appointments once, by outcome, for whoever holds the capability', async () => {
      const appointments = await get<OperationalAppointments>(
        jamie.agent,
        `operational/appointments?${query()}`,
      );
      expect(appointments.counts.current).toEqual({
        due: 6,
        completed: 3,
        cancelled: 1,
        noShow: 1,
        unresolved: 1,
      });
      const list = await ok<AppointmentListPage>(
        owner.get(`/api/v1/scheduling/appointments/list?from=${TODAY}&to=${TODAY}&status=no_show`),
      );
      expect(list.total).toBe(1);
      const attention = await get<OperationalAttention>(
        jamie.agent,
        `operational/attention?${query()}`,
      );
      // Now, whatever the period: today's and last month's booking are both unresolved.
      expect(attention).toMatchObject({ unresolved: 2, openVisits: 0, labLate: 0 });
    });

    it('measures room use against opening hours × active rooms', async () => {
      const custom = `period=custom&from=${PREV_DAY}&to=${PREV_DAY}`;
      const appointments = await get<OperationalAppointments>(
        jamie.agent,
        `operational/appointments?${custom}`,
      );
      expect(appointments.roomUse.current).toEqual({
        bookedMinutes: 120,
        capacityMinutes: weekday(PREV_DAY) === 0 ? 0 : 600 * 2,
      });
    });

    it('counts finished visits, waits and lengths, and never money', async () => {
      const visits = await get<OperationalVisits>(jamie.agent, `operational/visits?${query()}`);
      expect(visits.visits.current).toBe(3);
      expect(visits.wait.current).toEqual({ count: 3, medianMinutes: 12, over15: 1 });
      expect(visits.types.find((row) => row.type === 'treatment')).toMatchObject({
        count: 3,
        bookedMinutes: 30,
      });
      expect(JSON.stringify(visits)).not.toMatch(/amount|production|collected/);
    });

    it('counts new patients and plan items', async () => {
      const patients = await get<OperationalPatients>(
        jamie.agent,
        `operational/patients?${query()}`,
      );
      expect(patients.newPatients.current).toBe(0);
      expect(patients.active).toBe(1);
      const plans = await get<OperationalPlans>(jamie.agent, `operational/plans?${query()}`);
      expect(plans.current).toEqual({ recorded: 0, accepted: 0, started: 0, completed: 0 });
      const seen = await ok<PatientPage>(owner.get('/api/v1/clinical/patients?cohort=seen'));
      expect(seen.total).toBe(1);
      expect((await owner.get('/api/v1/patients?cohort=seen')).status).toBe(422);
    });

    it('rejects an invalid custom period', async () => {
      const response = await owner.get(
        `/api/v1/dashboards/operational/visits?period=custom&from=${TODAY}`,
      );
      expect(response.status).toBe(422);
    });
  });

  describe('tenant isolation', () => {
    it('shows another clinic none of these figures', async () => {
      const other = await provisionClinic(testApp, 'Other Dash');
      const money = await get<FinancialMoney>(other.owner, `financial/money?${query()}`);
      expect(money.production.current).toBe('0.00');
      expect(money.collected.current).toBe('0.00');
      const visits = await get<OperationalVisits>(other.owner, `operational/visits?${query()}`);
      expect(visits.visits.current).toBe(0);
      const appointments = await get<OperationalAppointments>(
        other.owner,
        `operational/appointments?${query()}`,
      );
      expect(appointments.counts.current.due).toBe(0);
    });
  });
});
