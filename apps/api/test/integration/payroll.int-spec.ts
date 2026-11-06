import type {
  AuditPage,
  EmployeeDetail,
  Employee,
  ExpenseCategory,
  ExpenseDashboard,
  ExpensePage,
  LinkableStaff,
  PayrollLine,
  PayrollMonths,
  PayrollRun,
  PractitionerType,
  Session,
} from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../src/platform/kernel/id';
import { ok, provisionClinic, type StaffMember, type TestClinic } from '../support/clinic';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { PASSWORD, signIn } from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';

/**
 * Feature 17, Part B (ADR-0077–0080), through the HTTP API, in a USD clinic in Asia/Beirut:
 * employees, the salary history, the monthly run, and the *Salaries* rows it writes in Expenses.
 * The app clock moves across months, so everyone signs in as trusted (no idle timeout).
 */
describe('payroll (feature 17)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let clinic: TestClinic;
  let owner: TestAgent;
  let desk: StaffMember;
  let drA: StaffMember;
  let reader: TestAgent;
  let rima: Employee;
  let salaries: string;

  const at = (iso: string) => {
    testApp.clock.set(new Date(iso));
  };

  const member = async (
    roles: string[],
    name: string,
    type: PractitionerType,
    grants: string[] = [],
  ): Promise<StaffMember> => {
    const staff = await clinic.staff(roles, name, type);
    if (grants.length > 0) {
      await ok(owner.put(`/api/v1/users/${staff.user.id}/grants`).send({ permissions: grants }));
    }
    return {
      user: staff.user,
      agent: await signIn(testApp.app, staff.user.email, PASSWORD, { rememberMe: true }),
    };
  };

  const run = (month: string, agent: TestAgent = owner) =>
    ok<PayrollRun>(agent.get(`/api/v1/payroll/runs/${month}`));

  const lineOf = async (month: string, employeeId = rima.id) => {
    const line = (await run(month)).lines.find((row) => row.employeeId === employeeId);
    if (!line) throw new Error(`no line for ${month}`);
    return line;
  };

  const linePath = (month: string, employeeId = rima.id) =>
    `/api/v1/payroll/runs/${month}/lines/${employeeId}`;

  const confirm = (lines: object[], key = newId()) =>
    owner.post('/api/v1/payroll/confirm').set('Idempotency-Key', key).send({ lines });

  const salaryRows = async (agent: TestAgent) =>
    (
      await ok<ExpensePage>(
        agent.get('/api/v1/expenses?from=2026-11-01&to=2026-11-30&includeVoided=true'),
      )
    ).items.filter((row) => row.categoryId === salaries);

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    at('2026-11-05T08:00:00Z');
    clinic = await provisionClinic(testApp, 'Pay');
    await ok(
      clinic.owner.patch('/api/v1/tenant').send({ timeZone: 'Asia/Beirut', currency: 'USD' }),
    );
    const second = await clinic.staff(['owner'], 'Second owner', 'other');
    owner = await signIn(testApp.app, second.user.email, PASSWORD, { rememberMe: true });
    desk = await member(['frontdesk'], 'Rima Desk', 'frontdesk');
    drA = await member(['dentist'], 'Dr. A', 'dentist');
    reader = (await member(['assistant'], 'Reader', 'assistant', ['expense:read', 'audit:read']))
      .agent;
    const categories = await ok<ExpenseCategory[]>(owner.get('/api/v1/expenses/categories'));
    salaries = categories.find((row) => row.key === 'salaries')?.id ?? '';
  }, 120_000);

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  describe('employees', () => {
    it('adds Rima, linked to the front desk user, at 800 from March', async () => {
      const created = await ok<EmployeeDetail>(
        owner.post('/api/v1/payroll/employees').send({
          fullName: 'Rima',
          jobTitle: 'Receptionist',
          hireDate: '2026-03-01',
          payrollFrom: '2026-03',
          staffProfileId: desk.user.profileId,
          salary: { amount: '800', effectiveMonth: '2026-03' },
        }),
        201,
      );
      rima = created.employee;
      expect(rima).toMatchObject({
        linkedUserName: 'Rima Desk',
        currentSalary: { amount: '800.00', effectiveMonth: '2026-03' },
        removable: true,
      });
    });

    it('refuses to link a dentist, or a user already linked', async () => {
      const base = {
        fullName: 'Someone',
        hireDate: '2026-11-01',
        payrollFrom: '2026-11',
        salary: { amount: '100', effectiveMonth: '2026-11' },
      };
      const dentist = await owner
        .post('/api/v1/payroll/employees')
        .send({ ...base, staffProfileId: drA.user.profileId });
      expect(dentist.status).toBe(422);
      expect(dentist.body).toMatchObject({ code: 'payroll.dentist_not_linkable' });
      const twice = await owner
        .post('/api/v1/payroll/employees')
        .send({ ...base, staffProfileId: desk.user.profileId });
      expect(twice.body).toMatchObject({ code: 'payroll.user_already_linked' });
      const staff = await ok<LinkableStaff[]>(owner.get('/api/v1/payroll/staff'));
      expect(staff.some((row) => row.profileId === drA.user.profileId)).toBe(false);
      expect(staff.find((row) => row.profileId === desk.user.profileId)?.linkedEmployeeId).toBe(
        rima.id,
      );
    });

    it('changes the salary to 900 from November, keeping 800 as history and for October', async () => {
      const detail = await ok<EmployeeDetail>(
        owner
          .post(`/api/v1/payroll/employees/${rima.id}/salaries`)
          .send({ amount: '900', effectiveMonth: '2026-11', reason: 'Raise' }),
        201,
      );
      expect(detail.salaries.map((row) => [row.amount, row.effectiveMonth])).toEqual([
        ['900.00', '2026-11'],
        ['800.00', '2026-03'],
      ]);
      expect(detail.salaries[0]?.createdByName).toBe('Second owner');
      expect((await lineOf('2026-10')).base).toBe('800.00');
      expect((await lineOf('2026-11')).base).toBe('900.00');
    });
  });

  describe('the November run', () => {
    it('lists Rima at 900, with every earlier month still pending', async () => {
      const november = await run('2026-11');
      expect(november.lines).toHaveLength(1);
      expect(november.totals).toMatchObject({
        employees: 1,
        paidNet: '0.00',
        pendingNet: '900.00',
      });
      expect(november.earlierPending.map((row) => row.month)).toEqual([
        '2026-03',
        '2026-04',
        '2026-05',
        '2026-06',
        '2026-07',
        '2026-08',
        '2026-09',
        '2026-10',
      ]);
    });

    it('adjusts with a 50 bonus and a 20 deduction, never below zero', async () => {
      const negative = await owner
        .put(`${linePath('2026-11')}/adjustments`)
        .send({ adjustments: [{ kind: 'deduction', label: 'Loan', amount: '2000' }] });
      expect(negative.body).toMatchObject({ code: 'payroll.net_negative' });
      const line = await ok<PayrollLine>(
        owner.put(`${linePath('2026-11')}/adjustments`).send({
          adjustments: [
            { kind: 'bonus', label: 'Eid bonus', amount: '50' },
            { kind: 'deduction', label: 'Late', amount: '20' },
          ],
        }),
      );
      expect(line).toMatchObject({ status: 'pending', base: '900.00', net: '930.00' });
    });

    it('confirms 930 on Nov 5 by bank transfer: one Salaries expense, seen only with payroll', async () => {
      const request = {
        employeeId: rima.id,
        month: '2026-11',
        paidOn: '2026-11-05',
        method: 'bank_transfer',
      };
      const stale = await confirm([{ ...request, net: '900' }]);
      expect(stale.status).toBe(409);
      expect(stale.body).toMatchObject({ code: 'payroll.stale' });
      const future = await confirm([{ ...request, paidOn: '2026-11-06', net: '930' }]);
      expect(future.body).toMatchObject({ code: 'payroll.future_date' });

      const key = newId();
      const [paid] = await ok<PayrollLine[]>(confirm([{ ...request, net: '930' }], key));
      expect(paid).toMatchObject({
        status: 'paid',
        net: '930.00',
        payment: { paidOn: '2026-11-05' },
      });
      const [replayed] = await ok<PayrollLine[]>(confirm([{ ...request, net: '930' }], key));
      expect(replayed?.payment?.id).toBe(paid?.payment?.id);
      const twice = await confirm([{ ...request, net: '930' }]);
      expect(twice.body).toMatchObject({ code: 'payroll.line_not_pending' });

      const [expense] = await salaryRows(owner);
      expect(expense).toMatchObject({
        amount: '930.00',
        source: 'payroll',
        payee: 'Rima',
        sourceMonth: '2026-11',
        method: 'bank_transfer',
      });
      expect(await salaryRows(reader)).toEqual([]);
      const card = await ok<ExpenseDashboard>(owner.get('/api/v1/expenses/dashboard'));
      expect(card.total.amount).toBe('0.00');
      const backDated = await owner
        .post(`/api/v1/payroll/employees/${rima.id}/salaries`)
        .send({ amount: '950', effectiveMonth: '2026-11' });
      expect(backDated.body).toMatchObject({ code: 'payroll.month_paid' });
    });

    it('voids the payment with a reason: the expense is voided and the line pending again', async () => {
      const voided = await ok<PayrollLine>(
        owner.post(`${linePath('2026-11')}/void`).send({ reason: 'Wrong account' }),
      );
      expect(voided).toMatchObject({ status: 'pending', payment: null, net: '930.00' });
      expect(voided.voidedPayments).toHaveLength(1);
      const [expense] = await salaryRows(owner);
      expect(expense?.voidReason).toBe('Wrong account');
      const edit = await owner.patch(`/api/v1/expenses/${expense?.id ?? ''}`).send({ amount: '1' });
      expect(edit.body).toMatchObject({ code: 'expense.system_row' });

      await ok(
        confirm([
          {
            employeeId: rima.id,
            month: '2026-11',
            paidOn: '2026-11-05',
            method: 'cash',
            net: '930',
          },
        ]),
      );
      const rows = await salaryRows(owner);
      expect(rows.map((row) => [row.method, row.voidedAt === null])).toEqual(
        expect.arrayContaining([
          ['bank_transfer', false],
          ['cash', true],
        ]),
      );
    });

    it('skips October with a reason and undoes it', async () => {
      const skipped = await ok<PayrollLine>(
        owner.post(`${linePath('2026-10')}/skip`).send({ reason: 'Unpaid leave' }),
      );
      expect(skipped).toMatchObject({ status: 'skipped', skipReason: 'Unpaid leave' });
      const back = await ok<PayrollLine>(owner.post(`${linePath('2026-10')}/unskip`));
      expect(back.status).toBe('pending');
      const months = await ok<PayrollMonths>(owner.get('/api/v1/payroll/months?year=2026'));
      expect(months.months.find((row) => row.month === '2026-11')).toMatchObject({
        paidNet: '930.00',
        paidCount: 1,
      });
      expect(months.months.find((row) => row.month === '2026-12')?.pendingCount).toBe(0);
    });
  });

  describe('leaving and removing', () => {
    it('gives a left employee a last line with a note, and none after', async () => {
      const sami = await ok<EmployeeDetail>(
        owner.post('/api/v1/payroll/employees').send({
          fullName: 'Sami',
          jobTitle: 'Cleaner',
          hireDate: '2026-01-10',
          payrollFrom: '2026-11',
          salary: { amount: '400', effectiveMonth: '2026-11' },
        }),
        201,
      );
      await ok(
        owner
          .patch(`/api/v1/payroll/employees/${sami.employee.id}`)
          .send({ status: 'left', endDate: '2026-11-12' }),
      );
      expect((await lineOf('2026-11', sami.employee.id)).leftOn).toBe('2026-11-12');
      at('2026-12-02T08:00:00Z');
      const december = await run('2026-12');
      expect(december.lines.map((line) => line.employeeName)).toEqual(['Rima']);
      at('2026-11-05T08:00:00Z');
      await ok(owner.delete(`/api/v1/payroll/employees/${sami.employee.id}`), 204);
    });

    it('exports the payroll history of an employee whose name is in Arabic', async () => {
      const ali = await ok<EmployeeDetail>(
        owner.post('/api/v1/payroll/employees').send({
          fullName: 'علي حسن',
          hireDate: '2026-11-01',
          payrollFrom: '2026-11',
          salary: { amount: '500', effectiveMonth: '2026-11' },
        }),
        201,
      );
      const csv = await owner.get(`/api/v1/payroll/employees/${ali.employee.id}/export?lang=ar`);
      expect(csv.status).toBe(200);
      expect(csv.headers['content-disposition']).toContain(`payroll-history-${ali.employee.id}`);
      expect(csv.text).toContain('2026-11');
      await ok(owner.delete(`/api/v1/payroll/employees/${ali.employee.id}`), 204);
    });

    it('never leaves a paid month outside, and never removes someone with payroll', async () => {
      const early = await owner
        .patch(`/api/v1/payroll/employees/${rima.id}`)
        .send({ status: 'left', endDate: '2026-10-31' });
      expect(early.body).toMatchObject({ code: 'payroll.paid_outside_employment' });
      const removed = await owner.delete(`/api/v1/payroll/employees/${rima.id}`);
      expect(removed.body).toMatchObject({ code: 'payroll.not_removable' });
    });

    it('shows a notice, and keeps the employee, when the linked user is deactivated', async () => {
      await ok(
        owner.post(`/api/v1/users/${desk.user.id}/deactivate`).send({ reason: 'Left the clinic' }),
      );
      const [listed] = await ok<Employee[]>(owner.get('/api/v1/payroll/employees?q=Rima'));
      expect(listed).toMatchObject({ status: 'active', linkNotice: 'deactivated' });
    });
  });

  describe('access', () => {
    it('keeps payroll from a role with only See expenses, and from the platform admin', async () => {
      expect((await reader.get('/api/v1/payroll/runs/2026-11')).status).toBe(403);
      const session = await ok<Session>(reader.get('/api/v1/session'));
      expect(session.permissions).toContain('expense:read');
      expect(session.permissions).not.toContain('payroll:read');
      const asAdmin = (path: string) => clinic.admin.get(path).set('X-Tenant-Id', clinic.tenant.id);
      expect((await asAdmin('/api/v1/payroll/employees')).status).toBe(403);
      expect((await asAdmin('/api/v1/expenses?from=2026-11-01&to=2026-11-30')).status).toBe(200);
    });

    it('shows payroll rows in Activity only to those who may read payroll', async () => {
      const feed = async (agent: TestAgent) =>
        (await ok<AuditPage>(agent.get('/api/v1/audit?limit=100'))).items;
      const ownerFeed = await feed(owner);
      expect(ownerFeed.some((entry) => entry.action === 'employee_salary.change')).toBe(true);
      expect(ownerFeed.some((entry) => entry.action === 'PayrollPaymentConfirmed')).toBe(true);
      const readerFeed = await feed(reader);
      expect(
        readerFeed.filter(
          (entry) =>
            entry.area === 'payroll' ||
            entry.action.startsWith('PayrollPayment') ||
            entry.resourceType === 'employee',
        ),
      ).toEqual([]);
    });

    it('locks the currency once a salary exists', async () => {
      const other = await provisionClinic(testApp, 'Pay B');
      await ok(
        other.owner.post('/api/v1/payroll/employees').send({
          fullName: 'Nour',
          hireDate: '2026-11-01',
          payrollFrom: '2026-11',
          salary: { amount: '500', effectiveMonth: '2026-11' },
        }),
        201,
      );
      const refused = await other.owner.patch('/api/v1/tenant').send({ currency: 'EUR' });
      expect(refused.body).toMatchObject({ code: 'tenant.currency_locked' });
    });
  });
});
