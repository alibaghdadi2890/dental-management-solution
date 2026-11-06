import type {
  AuditPage,
  Expense,
  ExpenseCategory,
  ExpenseDashboard,
  ExpensePage,
  ExpenseYear,
  FixedExpenseDetail,
  FixedItem,
  PractitionerType,
} from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../src/platform/kernel/id';
import { ok, provisionClinic, type StaffMember, type TestClinic } from '../support/clinic';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { PASSWORD, signIn } from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';

/**
 * Feature 17, Part A (ADR-0076, ADR-0078), through the HTTP API, in a USD clinic in Asia/Beirut.
 * The app clock moves across months, so everyone signs in as trusted (no idle timeout).
 */
describe('expenses (feature 17)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let clinic: TestClinic;
  let owner: TestAgent;
  let reader: TestAgent;
  let desk: TestAgent;
  let drA: StaffMember;
  let categories: ExpenseCategory[];

  /** Beirut is UTC+2 in winter: 00:30 on the 1st there is 22:30 the day before in UTC. */
  const at = (iso: string) => {
    testApp.clock.set(new Date(iso));
  };

  const member = async (
    roles: string[],
    name: string,
    type: PractitionerType = 'other',
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

  const category = (key: string) => {
    const found = categories.find((row) => row.key === key);
    if (!found) throw new Error(`no category ${key}`);
    return found;
  };

  const record = (agent: TestAgent, body: object, key = newId()) =>
    agent.post('/api/v1/expenses').set('Idempotency-Key', key).send(body);

  const page = (agent: TestAgent, query: string) =>
    ok<ExpensePage>(agent.get(`/api/v1/expenses?${query}`));

  const pending = (agent: TestAgent = owner) =>
    ok<FixedItem[]>(agent.get('/api/v1/expenses/pending'));

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    at('2026-11-01T08:00:00Z');
    clinic = await provisionClinic(testApp, 'Spend');
    await ok(
      clinic.owner.patch('/api/v1/tenant').send({ timeZone: 'Asia/Beirut', currency: 'USD' }),
    );
    const ownerMember = await clinic.staff(['owner'], 'Second owner', 'other');
    owner = await signIn(testApp.app, ownerMember.user.email, PASSWORD, { rememberMe: true });
    reader = (await member(['frontdesk'], 'Reader', 'frontdesk', ['expense:read'])).agent;
    desk = (await member(['frontdesk'], 'Desk', 'frontdesk')).agent;
    drA = await member(['dentist'], 'Dr. A', 'dentist');
    categories = await ok<ExpenseCategory[]>(owner.get('/api/v1/expenses/categories'));
  }, 120_000);

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  describe('categories', () => {
    it('starts every clinic with the predefined list, Other and the reserved ones', () => {
      expect(categories.filter((row) => row.kind === 'predefined')).toHaveLength(14);
      expect(category('other').kind).toBe('other');
      expect(category('salaries').kind).toBe('reserved');
      expect(category('dentist_compensation').kind).toBe('reserved');
    });

    it('adds, renames, uses and deactivates a custom category, never deleting it once used', async () => {
      const created = await ok<ExpenseCategory>(
        owner.post('/api/v1/expenses/categories').send({ name: 'Lab shipping' }),
        201,
      );
      for (const name of ['lab SHIPPING', 'Loyer', 'إيجار']) {
        const taken = await owner.post('/api/v1/expenses/categories').send({ name });
        expect(taken.status).toBe(422);
        expect(taken.body).toMatchObject({ code: 'expense.category_name_taken' });
      }
      await ok(
        owner.patch(`/api/v1/expenses/categories/${created.id}`).send({ name: 'Lab courier' }),
      );
      const used = await ok<Expense>(
        record(owner, {
          spentOn: '2026-11-01',
          categoryId: created.id,
          amount: '35',
          method: 'cash',
        }),
        201,
      );
      await ok(owner.patch(`/api/v1/expenses/categories/${created.id}`).send({ active: false }));
      const refused = await record(owner, {
        spentOn: '2026-11-01',
        categoryId: created.id,
        amount: '10',
        method: 'cash',
      });
      expect(refused.body).toMatchObject({ code: 'expense.category_inactive' });
      const deleted = await owner.delete(`/api/v1/expenses/categories/${created.id}`);
      expect(deleted.status).toBe(409);
      expect(deleted.body).toMatchObject({ code: 'expense.category_in_use' });
      const listed = await ok<ExpenseCategory[]>(owner.get('/api/v1/expenses/categories'));
      expect(listed.find((row) => row.id === created.id)).toMatchObject({
        name: 'Lab courier',
        active: false,
        inUse: true,
      });
      await ok(owner.post(`/api/v1/expenses/${used.id}/void`).send({ reason: 'test row' }));

      const unused = await ok<ExpenseCategory>(
        owner.post('/api/v1/expenses/categories').send({ name: 'Temporary' }),
        201,
      );
      await ok(owner.delete(`/api/v1/expenses/categories/${unused.id}`), 204);
    });

    it('never renames a predefined category, nor changes Other or a reserved one', async () => {
      const rename = await owner
        .patch(`/api/v1/expenses/categories/${category('rent').id}`)
        .send({ name: 'Lease' });
      expect(rename.body).toMatchObject({ code: 'expense.category_locked' });
      const other = await owner
        .patch(`/api/v1/expenses/categories/${category('other').id}`)
        .send({ active: false });
      expect(other.body).toMatchObject({ code: 'expense.category_locked' });
      const reserved = await owner
        .patch(`/api/v1/expenses/categories/${category('salaries').id}`)
        .send({ active: false });
      expect(reserved.body).toMatchObject({ code: 'expense.category_locked' });
    });
  });

  describe('recording an expense', () => {
    it('records Rent 450, edits it to 460 with an audit, then voids it out of the totals', async () => {
      const key = newId();
      const body = {
        spentOn: '2026-11-01',
        categoryId: category('rent').id,
        amount: '450',
        method: 'cash',
        payee: 'Landlord',
      };
      const rent = await ok<Expense>(record(owner, body, key), 201);
      expect(rent).toMatchObject({ amount: '450.00', currency: 'USD', source: 'manual' });
      expect((await ok<Expense>(record(owner, body, key), 201)).id).toBe(rent.id);
      const mismatch = await record(owner, { ...body, amount: '451' }, key);
      expect(mismatch.status).toBe(409);
      expect(mismatch.body).toMatchObject({ code: 'expense.idempotency_mismatch' });

      await ok(owner.patch(`/api/v1/expenses/${rent.id}`).send({ amount: '460' }));
      const audit = await ok<AuditPage>(
        owner.get(`/api/v1/audit?resourceType=expense&resourceId=${rent.id}`),
      );
      expect(audit.items.find((entry) => entry.action === 'expense.update')).toMatchObject({
        before: { amount: '450.00' },
        after: { amount: '460.00', categoryKey: 'rent' },
      });

      const before = await page(owner, 'from=2026-11-01&to=2026-11-30');
      await ok(owner.post(`/api/v1/expenses/${rent.id}/void`).send({ reason: 'Paid twice' }));
      const after = await page(owner, 'from=2026-11-01&to=2026-11-30');
      expect(Number(before.total.amount) - Number(after.total.amount)).toBe(460);
      expect(after.items.some((row) => row.id === rent.id)).toBe(false);
      const withVoided = await page(owner, 'from=2026-11-01&to=2026-11-30&includeVoided=true');
      expect(withVoided.items.find((row) => row.id === rent.id)).toMatchObject({
        voidReason: 'Paid twice',
      });
      expect(withVoided.total.amount).toBe(after.total.amount);
      const again = await owner.patch(`/api/v1/expenses/${rent.id}`).send({ amount: '1' });
      expect(again.body).toMatchObject({ code: 'expense.voided' });
    });

    it('refuses Other without a description, a reserved category, and a future date', async () => {
      const base = { spentOn: '2026-11-01', amount: '5', method: 'cash' };
      expect(
        (await record(owner, { ...base, categoryId: category('other').id })).body,
      ).toMatchObject({ code: 'expense.description_required' });
      expect(
        (await record(owner, { ...base, categoryId: category('salaries').id })).body,
      ).toMatchObject({ code: 'expense.category_reserved' });
      expect(
        (await record(owner, { ...base, spentOn: '2026-11-02', categoryId: category('water').id }))
          .body,
      ).toMatchObject({ code: 'expense.future_date' });
    });

    it('lets only those who may manage expenses record them', async () => {
      const body = {
        spentOn: '2026-11-01',
        categoryId: category('water').id,
        amount: '5',
        method: 'cash',
      };
      expect((await record(reader, body)).status).toBe(403);
      expect((await desk.get('/api/v1/expenses?from=2026-11-01&to=2026-11-30')).status).toBe(403);
    });
  });

  describe('fixed expenses', () => {
    let electricity: FixedExpenseDetail;

    it('waits for September, October and November on the 1st, in the clinic time zone', async () => {
      // 00:30 on November 1st in Beirut: still October 31st in UTC.
      at('2026-10-31T22:30:00Z');
      electricity = await ok<FixedExpenseDetail>(
        owner.post('/api/v1/expenses/fixed').send({
          name: 'Electricity',
          categoryId: category('electricity').id,
          amount: '120',
          method: 'bank_transfer',
          firstMonth: '2026-09',
        }),
        201,
      );
      expect(electricity.items.map((item) => item.month)).toEqual([
        '2026-11',
        '2026-10',
        '2026-09',
      ]);
      expect((await pending()).map((item) => item.month)).toEqual([
        '2026-09',
        '2026-10',
        '2026-11',
      ]);
      expect((await pending(reader)).length).toBe(3);
    });

    it('confirms September at 138.50 and October at 120 in one go, and skips November', async () => {
      at('2026-11-01T08:00:00Z');
      const [september, october, november] = await pending();
      if (!september || !october || !november) throw new Error('three items expected');
      const item = (row: FixedItem, amount: string) => ({
        itemId: row.id,
        spentOn: '2026-11-01',
        amount,
        method: 'bank_transfer',
        categoryId: row.categoryId,
      });
      const key = newId();
      const body = { items: [item(september, '138.50'), item(october, '120')] };
      expect(
        (
          await reader
            .post('/api/v1/expenses/pending/confirm')
            .set('Idempotency-Key', key)
            .send(body)
        ).status,
      ).toBe(403);
      const confirmed = await ok<Expense[]>(
        owner.post('/api/v1/expenses/pending/confirm').set('Idempotency-Key', key).send(body),
      );
      expect(confirmed.map((row) => [row.sourceMonth, row.amount])).toEqual([
        ['2026-09', '138.50'],
        ['2026-10', '120.00'],
      ]);
      const replay = await ok<Expense[]>(
        owner.post('/api/v1/expenses/pending/confirm').set('Idempotency-Key', key).send(body),
      );
      expect(replay.map((row) => row.id)).toEqual(confirmed.map((row) => row.id));
      const twice = await owner
        .post('/api/v1/expenses/pending/confirm')
        .set('Idempotency-Key', newId())
        .send({ items: [item(september, '1')] });
      expect(twice.body).toMatchObject({ code: 'expense.item_not_pending' });

      await ok(
        owner.post(`/api/v1/expenses/pending/${november.id}/skip`).send({ reason: 'Meter broken' }),
      );
      expect((await pending()).length).toBe(0);
      const fixedRows = (await page(owner, 'from=2026-11-01&to=2026-11-30')).items.filter(
        (row) => row.source === 'fixed',
      );
      expect(fixedRows.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(258.5);

      // Voiding October's expense puts October back; undoing the skip puts November back.
      const octoberExpense = confirmed[1];
      if (!octoberExpense) throw new Error('october expense');
      await ok(
        owner.post(`/api/v1/expenses/${octoberExpense.id}/void`).send({ reason: 'Wrong bill' }),
      );
      await ok(owner.post(`/api/v1/expenses/pending/${november.id}/unskip`));
      expect((await pending()).map((row) => row.month)).toEqual(['2026-10', '2026-11']);
    });

    it('applies an edit to later months only, and nothing ever confirms itself', async () => {
      await ok(owner.patch(`/api/v1/expenses/fixed/${electricity.id}`).send({ amount: '130' }));
      at('2026-12-01T08:00:00Z');
      const months = (await pending()).map((row) => [row.month, row.amount, row.status]);
      expect(months).toEqual([
        ['2026-10', '120.00', 'pending'],
        ['2026-11', '120.00', 'pending'],
        ['2026-12', '130.00', 'pending'],
      ]);
    });

    it('generates nothing while paused and skips the paused months on resume', async () => {
      await ok(owner.post(`/api/v1/expenses/fixed/${electricity.id}/pause`));
      at('2027-01-15T08:00:00Z');
      expect((await pending()).some((row) => row.month === '2027-01')).toBe(false);
      at('2027-02-02T08:00:00Z');
      const resumed = await ok<FixedExpenseDetail>(
        owner.post(`/api/v1/expenses/fixed/${electricity.id}/resume`),
      );
      expect(resumed.items.map((row) => row.month)).toEqual([
        '2027-02',
        '2026-12',
        '2026-11',
        '2026-10',
        '2026-09',
      ]);
      await ok(owner.post(`/api/v1/expenses/fixed/${electricity.id}/end`));
      const ended = await owner
        .patch(`/api/v1/expenses/fixed/${electricity.id}`)
        .send({ amount: '1' });
      expect(ended.body).toMatchObject({ code: 'expense.fixed_status' });
      at('2026-11-01T08:00:00Z');
    });
  });

  describe('the Today card and reports', () => {
    it('shows this month without salaries or payouts, and what waits, to whoever may read', async () => {
      at('2026-11-20T08:00:00Z');
      await ok(
        owner
          .post(`/api/v1/compensation/dentists/${drA.user.profileId}/payouts`)
          .set('Idempotency-Key', newId())
          .send({ amount: '160', date: '2026-11-20', method: 'cash' }),
        201,
      );
      const card = await ok<ExpenseDashboard>(owner.get('/api/v1/expenses/dashboard'));
      expect(card.month).toBe('2026-11');
      expect(card.recent.every((row) => row.source === 'manual' || row.source === 'fixed')).toBe(
        true,
      );
      expect(card.pending.length).toBeGreaterThan(0);
      const readerCard = await ok<ExpenseDashboard>(reader.get('/api/v1/expenses/dashboard'));
      expect(readerCard.total).toEqual(card.total);
      expect((await desk.get('/api/v1/expenses/dashboard')).status).toBe(403);
    });

    it('mirrors a dentist payout for whoever manages compensation, and voids it with the payout', async () => {
      const ownerRows = await page(owner, 'from=2026-11-01&to=2026-11-30');
      const payout = ownerRows.items.find((row) => row.source === 'compensation');
      expect(payout).toMatchObject({
        amount: '160.00',
        payee: 'Dr. A',
        categoryId: category('dentist_compensation').id,
      });
      if (!payout?.sourceId) throw new Error('mirrored payout');
      const readerRows = await page(reader, 'from=2026-11-01&to=2026-11-30');
      expect(readerRows.items.some((row) => row.source === 'compensation')).toBe(false);
      expect(Number(ownerRows.total.amount) - Number(readerRows.total.amount)).toBe(160);
      const edit = await owner.patch(`/api/v1/expenses/${payout.id}`).send({ amount: '1' });
      expect(edit.body).toMatchObject({ code: 'expense.system_row' });
      expect(
        (await reader.patch(`/api/v1/expenses/${payout.id}`).send({ amount: '1' })).status,
      ).toBe(403);

      await ok(
        owner
          .post(
            `/api/v1/compensation/dentists/${drA.user.profileId}/payouts/${payout.sourceId}/void`,
          )
          .send({ reason: 'Recorded twice' }),
      );
      const voided = await page(owner, 'from=2026-11-01&to=2026-11-30&includeVoided=true');
      expect(voided.items.find((row) => row.id === payout.id)).toMatchObject({
        voidReason: 'Recorded twice',
      });
    });

    it('sums the year by month, and exports the filtered list', async () => {
      const year = await ok<ExpenseYear>(owner.get('/api/v1/expenses/year?year=2026'));
      expect(year.months).toHaveLength(12);
      expect(year.months.find((row) => row.month === '2026-11')?.amount).toBe(
        (await page(owner, 'from=2026-11-01&to=2026-11-30')).total.amount,
      );
      const csv = await owner.get('/api/v1/expenses/export?from=2026-11-01&to=2026-11-30&lang=en');
      expect(csv.status).toBe(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.text).toContain('Electricity');
      expect(csv.text).not.toContain('Dr. A');
      expect((await desk.get('/api/v1/expenses/export?from=2026-11-01&to=2026-11-30')).status).toBe(
        403,
      );
    });

    it('locks the clinic currency once it has spent money', async () => {
      const refused = await owner.patch('/api/v1/tenant').send({ currency: 'EUR' });
      expect(refused.status).toBe(422);
      expect(refused.body).toMatchObject({ code: 'tenant.currency_locked' });
    });
  });
});
