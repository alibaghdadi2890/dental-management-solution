import type {
  Adjustment,
  Agreement,
  AuditPage,
  CompensationReport,
  CompensationStatement,
  Patient,
  PlatformAuditPage,
  ServiceItem,
  StartVisitResult,
  Visit,
  VisitResult,
  VisitType,
} from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lastDay, monthOf, previousMonth } from '../../src/modules/compensation/domain/months';
import { newId } from '../../src/platform/kernel/id';
import { localDate } from '../../src/platform/kernel/local-date';
import { grant, ok, provisionClinic, type StaffMember, type TestClinic } from '../support/clinic';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { createTestApp, type TestApp } from '../support/test-app';

/**
 * Feature 13b (ADR-0058–0060), through the HTTP API. The ledger stamps `created_at` with the
 * database clock, so collections fall in the real current month: the suite works in this month
 * (`NOW_MONTH`) and the one before it (`PREVIOUS`), and moves the app clock only to date visits.
 */
const TIME_ZONE = 'Asia/Beirut';
const TODAY = localDate(new Date(), TIME_ZONE);
const NOW_MONTH = monthOf(TODAY);
const PREVIOUS = previousMonth(NOW_MONTH);
const FIRST = `${NOW_MONTH}-01`;
/** Noon in Beirut on `date`. */
const on = (date: string) => new Date(`${date}T09:00:00Z`);

const share = (percent: string, basis: 'production' | 'collection', extra: object = {}) => ({
  kind: 'share',
  percent,
  basis,
  ...extra,
});

describe('compensation (feature 13b)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let clinic: TestClinic;
  let owner: TestAgent;
  let drA: StaffMember;
  let drB: StaffMember;
  let drC: StaffMember;
  let drD: StaffMember;
  let desk: StaffMember;
  let patient: Patient;
  let service: Record<'s300' | 's200' | 's100' | 'imp' | 'exm', ServiceItem>;

  const base = (profileId: string) => `/api/v1/compensation/dentists/${profileId}`;
  const now = () => {
    testApp.clock.set(new Date());
  };

  const visit = async (
    member: StaffMember,
    services: ServiceItem[],
    options: { type?: VisitType; complete?: boolean; room?: 'room' | 'spareRoom' } = {},
  ): Promise<Visit> => {
    const started = (
      await ok<StartVisitResult>(
        member.agent.post('/api/v1/visits').send({
          type: options.type ?? 'treatment',
          patientId: patient.id,
          dentistId: member.user.profileId,
          roomId: clinic[options.room ?? 'spareRoom'].id,
        }),
        201,
      )
    ).visit;
    for (const item of services) {
      await ok(
        member.agent.post(`/api/v1/visits/${started.id}/services`).send({ procedureId: item.id }),
        201,
      );
    }
    if (options.complete === false) return started;
    return (await ok<VisitResult>(member.agent.post(`/api/v1/visits/${started.id}/complete`)))
      .visit;
  };

  const pay = (visitId: string, amount: string) =>
    ok(
      desk.agent.post('/api/v1/billing/payments').set('Idempotency-Key', newId()).send({
        patientId: patient.id,
        amount,
        method: 'cash',
        paidAt: TODAY,
        contextVisitId: visitId,
      }),
      201,
    );

  const statement = (member: StaffMember, month = NOW_MONTH, agent: TestAgent = owner) =>
    ok<CompensationStatement>(agent.get(`${base(member.user.profileId)}/statement?month=${month}`));

  const amounts = (result: CompensationStatement, component: string) =>
    result.earned.find((group) => group.component === component)?.lines.map((line) => line.amount);

  const agreement = (member: StaffMember, body: object) =>
    ok<Agreement>(owner.post(`${base(member.user.profileId)}/agreements`).send(body), 201);

  const changeTerms = (member: StaffMember, body: object) =>
    ok<Agreement>(
      owner.post(`${base(member.user.profileId)}/agreements/change-terms`).send(body),
      201,
    );

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    now();
    clinic = await provisionClinic(testApp, 'Comp');
    owner = clinic.owner;
    const services = await ok<ServiceItem[]>(
      owner.put('/api/v1/catalog/services').send({
        items: [
          { code: 'S300', name: 'Three hundred', chargeUnit: 'per_mouth', price: '300' },
          { code: 'S200', name: 'Two hundred', chargeUnit: 'per_mouth', price: '200' },
          { code: 'S100', name: 'One hundred', chargeUnit: 'per_mouth', price: '100' },
          {
            code: 'ZIMP',
            name: 'Implant',
            chargeUnit: 'per_mouth',
            price: '1000',
            category: 'Implants',
          },
          {
            code: 'ZEXM',
            name: 'Exam',
            chargeUnit: 'per_mouth',
            price: '50',
            category: 'Diagnostics',
          },
        ],
      }),
    );
    const byCode = (code: string) => {
      const found = services.find((item) => item.code === code);
      if (!found) throw new Error(`no service ${code}`);
      return found;
    };
    service = {
      s300: byCode('S300'),
      s200: byCode('S200'),
      s100: byCode('S100'),
      imp: byCode('ZIMP'),
      exm: byCode('ZEXM'),
    };
    drA = await clinic.staff(['dentist'], 'Dr Alpha');
    drB = await clinic.staff(['dentist'], 'Dr Beta');
    drC = await clinic.staff(['dentist'], 'Dr Gamma');
    drD = await clinic.staff(['dentist'], 'Dr Delta');
    desk = await clinic.staff(['frontdesk'], 'Desk Dana', 'frontdesk');
    await grant(owner, desk.user.id, ['visit:discount']);
    patient = await ok<Patient>(
      owner
        .post('/api/v1/patients')
        .set('Idempotency-Key', newId())
        .send({ fullName: 'Pat Payer' }),
      201,
    );
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  describe('shares (Dr Alpha, this month)', () => {
    let v1: Visit;
    let v2: Visit;

    beforeAll(async () => {
      now();
      await agreement(drA, {
        preset: 'revenueShare',
        components: [share('40', 'collection')],
        effectiveFrom: FIRST,
      });
      v1 = await visit(drA, [service.s300]);
      await pay(v1.id, '300');
      v2 = await visit(drA, [service.s200]);
      await pay(v2.id, '100');
    });

    it('pays 40 % of collected amounts, then of billed ones once the terms change from the first day', async () => {
      const collected = await statement(drA);
      expect(amounts(collected, 'share')).toEqual(['120.00', '40.00']);
      expect(collected.totals).toMatchObject({ earned: '160.00', closing: '160.00' });
      expect(collected.status).toBe('provisional');

      await changeTerms(drA, {
        preset: 'revenueShare',
        components: [share('40', 'production')],
        effectiveFrom: FIRST,
        reason: 'Billed, not collected',
      });
      const billed = await statement(drA);
      expect(amounts(billed, 'share')).toEqual(['120.00', '80.00']);
      const history = await ok<Agreement[]>(owner.get(`${base(drA.user.profileId)}/agreements`));
      expect(history.map((row) => row.status).sort()).toEqual(['active', 'superseded']);
    });

    it('lowers the billed base by a checkout discount, on its own date', async () => {
      const current = await ok<Visit>(desk.agent.get(`/api/v1/visits/${v2.id}`));
      await ok(
        desk.agent.post(`/api/v1/visits/${v2.id}/checkout-discount`).send({
          expectedUpdatedAt: current.updatedAt,
          reason: 'Loyal patient',
          discount: { mode: 'amount', value: '20' },
        }),
      );
      expect(amounts(await statement(drA), 'share')).toEqual(['120.00', '80.00', '-8.00']);
    });

    it('blends rates by service over the visit lines', async () => {
      await changeTerms(drA, {
        preset: 'revenueShare',
        components: [
          share('40', 'collection', {
            rateOverrides: [{ target: 'category', key: 'Implants', percent: '30' }],
          }),
        ],
        effectiveFrom: FIRST,
      });
      const v3 = await visit(drA, [service.imp, service.exm]);
      await pay(v3.id, '500');
      const line = (await statement(drA)).earned[0]?.lines.find((row) => row.visitId === v3.id);
      expect(line).toMatchObject({ amount: '152.38', rate: { percent: '30.48', blended: true } });
      expect(line?.patientName).toBe('Pat Payer');
    });

    it('pays a corrected service at its own rate: the correction earns the difference (ADR-0062)', async () => {
      await changeTerms(drA, {
        preset: 'revenueShare',
        components: [
          share('40', 'production', {
            rateOverrides: [{ target: 'category', key: 'Implants', percent: '30' }],
          }),
        ],
        effectiveFrom: FIRST,
      });
      const v4 = await visit(drA, [service.exm]);
      // The exam was an implant: 40 % of 50, then 30 % of 1000 − 20.
      await ok(
        drA.agent.post(`/api/v1/visits/${v4.id}/amend`).send({
          expectedUpdatedAt: v4.updatedAt,
          reason: 'Wrong service picked',
          discount: { mode: 'percent', value: '0' },
          services: [{ procedureId: service.imp.id }],
        }),
      );
      const lines = (await statement(drA)).earned[0]?.lines.filter((row) => row.visitId === v4.id);
      expect(lines?.map((row) => [row.base, row.amount])).toEqual([
        ['50.00', '20.00'],
        ['950.00', '280.00'],
      ]);
    });

    it('lets the dentist read their own statement only, unless the clinic hides it', async () => {
      expect(await ok<string[]>(drA.agent.get('/api/v1/compensation/me/months'))).toEqual([
        NOW_MONTH,
      ]);
      const mine = await ok<CompensationStatement>(
        drA.agent.get(`/api/v1/compensation/me/statement?month=${NOW_MONTH}`),
      );
      expect(mine.profileId).toBe(drA.user.profileId);
      expect(
        (await drA.agent.get(`${base(drB.user.profileId)}/statement?month=${NOW_MONTH}`)).status,
      ).toBe(403);
      expect((await desk.agent.get(`/api/v1/compensation/report?month=${NOW_MONTH}`)).status).toBe(
        403,
      );
      expect(
        (
          await clinic.admin
            .get(`/api/v1/compensation/report?month=${NOW_MONTH}`)
            .set('X-Tenant-Id', clinic.tenant.id)
        ).status,
      ).toBe(403);

      await changeTerms(drA, {
        preset: 'revenueShare',
        components: [share('40', 'collection')],
        effectiveFrom: FIRST,
        statementVisibleToDentist: false,
      });
      expect(await ok<string[]>(drA.agent.get('/api/v1/compensation/me/months'))).toEqual([]);
      expect(
        (await drA.agent.get(`/api/v1/compensation/me/statement?month=${NOW_MONTH}`)).status,
      ).toBe(404);
    });
  });

  describe('closing a month and late entries (Dr Beta)', () => {
    let late: Visit;

    beforeAll(async () => {
      now();
      await agreement(drB, {
        preset: 'revenueShare',
        components: [share('40', 'production')],
        effectiveFrom: `${PREVIOUS}-01`,
      });
      testApp.clock.set(on(`${PREVIOUS}-05`));
      await visit(drB, [service.s100]);
      testApp.clock.set(on(lastDay(PREVIOUS)));
      late = await visit(drB, [service.s100], { complete: false, room: 'room' });
      now();
      await ok(
        owner
          .post(`${base(drB.user.profileId)}/payouts`)
          .set('Idempotency-Key', newId())
          .send({ amount: '30', date: `${PREVIOUS}-20`, method: 'cash' }),
        201,
      );
    });

    it('closes the month, refuses money dated in it, and replays the close', async () => {
      const key = newId();
      const close = () =>
        owner
          .post(`${base(drB.user.profileId)}/periods/${PREVIOUS}/close`)
          .set('Idempotency-Key', key);
      const closed = await ok<CompensationStatement>(close());
      expect(closed).toMatchObject({
        status: 'closed',
        totals: { earned: '40.00', payouts: '30.00', closing: '10.00' },
      });
      expect((await ok<CompensationStatement>(close())).status).toBe('closed');
      const refused = await owner
        .post(`${base(drB.user.profileId)}/adjustments`)
        .set('Idempotency-Key', newId())
        .send({ kind: 'bonus', amount: '50', date: `${PREVIOUS}-25` });
      expect(refused.status).toBe(422);
      expect((refused.body as { code: string }).code).toBe('compensation.period_closed');
      const early = await owner
        .post(`${base(drB.user.profileId)}/periods/${NOW_MONTH}/close`)
        .set('Idempotency-Key', newId());
      expect((early.body as { code: string }).code).toBe('compensation.month_not_ended');
    });

    it('reports a visit completed after the close as a late entry, until the month reopens', async () => {
      now();
      await ok(drB.agent.post(`/api/v1/visits/${late.id}/complete`));
      const current = await statement(drB);
      expect(current.totals.opening).toBe('10.00');
      expect(current.late).toEqual([expect.objectContaining({ month: PREVIOUS, total: '40.00' })]);
      expect(current.late[0]?.lines[0]).toMatchObject({
        date: lastDay(PREVIOUS),
        visitId: late.id,
      });

      // It can't move to another day while its month is closed (ADR-0063).
      const completed = await ok<Visit>(owner.get(`/api/v1/visits/${late.id}`));
      const moved = await drB.agent.post(`/api/v1/visits/${late.id}/amend`).send({
        expectedUpdatedAt: completed.updatedAt,
        reason: 'Wrong day',
        discount: { mode: 'percent', value: '0' },
        services: completed.services.map((line) => ({ id: line.id })),
        times: {
          startedAt: `${PREVIOUS}-10T07:00:00Z`,
          completedAt: `${PREVIOUS}-10T07:30:00Z`,
        },
      });
      expect(moved.status).toBe(422);
      expect((moved.body as { code: string }).code).toBe('compensation.period_closed');
      expect((await ok<Visit>(owner.get(`/api/v1/visits/${late.id}`))).localDate).toBe(
        lastDay(PREVIOUS),
      );

      await ok(
        owner
          .post(`${base(drB.user.profileId)}/periods/${PREVIOUS}/reopen`)
          .set('Idempotency-Key', newId())
          .send({ reason: 'Late visit' }),
      );
      expect((await statement(drB, PREVIOUS)).totals.earned).toBe('80.00');
      expect((await statement(drB)).late).toEqual([]);
    });

    it('replays an adjustment by its key and refuses the key for another request', async () => {
      const key = newId();
      const record = (amount: string) =>
        owner
          .post(`${base(drB.user.profileId)}/adjustments`)
          .set('Idempotency-Key', key)
          .send({ kind: 'bonus', amount, date: TODAY });
      const first = await ok<Adjustment>(record('25'), 201);
      expect((await ok<Adjustment>(record('25'), 201)).id).toBe(first.id);
      expect((await record('26')).status).toBe(409);
    });
  });

  describe('per visit, deactivation, the report', () => {
    beforeAll(async () => {
      now();
      await agreement(drC, {
        preset: 'perVisit',
        components: [{ kind: 'perVisit', amount: '15', byType: { consultation: '0' } }],
        effectiveFrom: FIRST,
      });
      await visit(drC, [service.s100]);
      await visit(drC, [service.s100]);
      await visit(drC, [], { type: 'consultation' });
      await visit(drD, [service.s200]);
    });

    it('pays per visit, and a void takes the visit out', async () => {
      expect((await statement(drC)).totals.earned).toBe('30.00');
      const [first] = (await statement(drC)).earned[0]?.lines ?? [];
      const toVoid = await ok<Visit>(owner.get(`/api/v1/visits/${first?.visitId ?? ''}`));
      await ok(
        owner
          .post(`/api/v1/visits/${toVoid.id}/void`)
          .send({ expectedUpdatedAt: toVoid.updatedAt, reason: 'Wrong patient' }),
      );
      expect((await statement(drC)).totals.earned).toBe('15.00');
    });

    it('ends the agreement when the dentist is deactivated, and keeps their statement', async () => {
      await ok(owner.post(`/api/v1/users/${drC.user.id}/deactivate`).send({ reason: 'Left' }));
      const [current] = await ok<Agreement[]>(owner.get(`${base(drC.user.profileId)}/agreements`));
      expect(current).toMatchObject({ effectiveTo: TODAY, endReason: 'staff deactivated' });
      expect((await statement(drC)).totals.earned).toBe('15.00');
    });

    it('lists every dentist with lines, without an agreement as "—", and collections of no visit', async () => {
      await ok(
        owner
          .post('/api/v1/billing/opening-balances')
          .set('Idempotency-Key', newId())
          .send({
            patient: { fullName: 'Old Debt' },
            openingBalance: { amount: '200', asOf: TODAY },
          }),
        201,
      );
      const debtor = (await ok<{ items: Patient[] }>(owner.get('/api/v1/patients?q=Old%20Debt')))
        .items[0];
      await ok(
        desk.agent.post('/api/v1/billing/payments').set('Idempotency-Key', newId()).send({
          patientId: debtor?.id,
          amount: '200',
          method: 'cash',
          paidAt: TODAY,
        }),
        201,
      );
      const report = await ok<CompensationReport>(
        owner.get(`/api/v1/compensation/report?month=${NOW_MONTH}`),
      );
      const row = (member: StaffMember) =>
        report.rows.find((r) => r.profileId === member.user.profileId);
      expect(row(drC)).toMatchObject({ active: false, earned: '15.00', status: 'provisional' });
      expect(row(drD)).toMatchObject({ production: '200.00', earned: null, status: 'none' });
      expect(report.unattributed.collections).toBe('200.00');
      const csv = await owner.get(`/api/v1/compensation/report/export?month=${NOW_MONTH}&lang=en`);
      expect(csv.status).toBe(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.text).toContain('Dr Delta');
      expect(csv.text).toContain('Unattributed');
    });
  });

  it('keeps compensation out of the Activity of anyone without compensation:manage', async () => {
    const actions = async (agent: TestAgent) =>
      (await ok<AuditPage>(agent.get('/api/v1/audit?feed=true&limit=100'))).items.map(
        (row) => row.action,
      );
    expect(await actions(owner)).toContain('compensation.agreement_create');
    expect(
      (await actions(drA.agent)).filter((action) => action.startsWith('compensation.')),
    ).toEqual([]);
    const platform = await ok<PlatformAuditPage>(
      clinic.admin.get(`/api/v1/platform/audit?tenantId=${clinic.tenant.id}&limit=100`),
    );
    expect(platform.items.filter((row) => row.action.startsWith('compensation.'))).toEqual([]);
  });
});
