import type {
  AuditPage,
  CheckoutQueue,
  FullVisitSummary,
  HandedOffVisitSummary,
  LiveVisitRef,
  Patient,
  PatientChart,
  StartVisitResult,
  Visit,
  VisitListSummary,
  VisitPage,
  VisitResult,
} from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../src/platform/kernel/id';
import { ok, provisionClinic, type StaffMember, type TestClinic } from '../support/clinic';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { createTestApp, type TestApp } from '../support/test-app';

/** Beirut is UTC+3 in June: the tenant's today is 2026-06-10 all day at this instant. */
const NOON = '2026-06-10T09:00:00Z';
const TODAY = '2026-06-10';

/**
 * Feature 13a (ADR-0055) end to end: a dentist sees his own visits and no money but his visit's;
 * front desk takes the payment; discounts need `visit:discount`; the billing route map, both ways.
 */
describe('financial access, visit scope and explicit discounts (ADR-0055)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let clinic: TestClinic;
  let dentistA: StaffMember;
  let dentistB: StaffMember;
  let assistant: StaffMember;
  let desk: StaffMember;
  let patient: Patient;
  let visitA: Visit;
  let visitB: Visit;
  let liveB: Visit;

  const ids = (page: { items: { id: string }[] }) => page.items.map((item) => item.id);

  const start = async (member: StaffMember, roomId?: string, patientId = patient.id) =>
    (
      await ok<StartVisitResult>(
        member.agent.post('/api/v1/visits').send({
          type: 'treatment',
          patientId,
          dentistId: member.user.profileId,
          roomId: roomId ?? clinic.spareRoom.id,
        }),
        201,
      )
    ).visit;

  const completed = async (member: StaffMember) => {
    const visit = await start(member);
    await ok(
      member.agent
        .post(`/api/v1/visits/${visit.id}/services`)
        .send({ procedureId: clinic.service.id, toothCode: '16', surfaces: ['O'] }),
      201,
    );
    return (await ok<VisitResult>(member.agent.post(`/api/v1/visits/${visit.id}/complete`))).visit;
  };

  const status = async (agent: TestAgent, path: string) => (await agent.get(path)).status;

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    testApp.clock.set(new Date(NOON));
    clinic = await provisionClinic(testApp, 'Access');
    dentistA = await clinic.staff(['dentist'], 'Dr Alpha');
    dentistB = await clinic.staff(['dentist'], 'Dr Beta');
    assistant = await clinic.staff(['assistant'], 'Ana Assist', 'assistant');
    desk = await clinic.staff(['frontdesk'], 'Desk Dana', 'frontdesk');
    patient = await ok<Patient>(
      clinic.owner
        .post('/api/v1/patients')
        .set('Idempotency-Key', newId())
        .send({ fullName: 'Shared Patient' }),
      201,
    );
    visitA = await completed(dentistA);
    visitB = await completed(dentistB);
    liveB = await start(dentistB, clinic.room.id);
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  describe('visit scope', () => {
    it("lists only the dentist's own visits, in the list, its tabs, live and the record", async () => {
      const own = await ok<VisitPage>(dentistA.agent.get('/api/v1/visits?range=all'));
      expect(ids(own)).toEqual([visitA.id]);
      const history = await ok<VisitPage>(
        dentistA.agent.get(`/api/v1/visits?patientId=${patient.id}&tab=history&range=all`),
      );
      expect(ids(history)).toEqual([visitA.id]);
      const summary = await ok<VisitListSummary>(
        dentistA.agent.get('/api/v1/visits/summary?range=all'),
      );
      expect(summary).toMatchObject({ count: 1, billed: null, tabs: { all: 1, inProgress: 0 } });
      expect(await ok<LiveVisitRef[]>(dentistA.agent.get('/api/v1/visits/live'))).toEqual([]);

      const everyone = await ok<VisitPage>(clinic.owner.get('/api/v1/visits?range=all'));
      expect(ids(everyone)).toEqual([liveB.id, visitB.id, visitA.id]);
    });

    it("never hands back another dentist's live visit when starting one", async () => {
      const response = await dentistA.agent.post('/api/v1/visits').send({
        type: 'treatment',
        patientId: patient.id,
        dentistId: dentistA.user.profileId,
        roomId: clinic.spareRoom.id,
      });
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ code: 'visit.live_elsewhere' });
      expect(response.body).not.toHaveProperty('visit');
    });

    it("answers 404 for another dentist's visit, to reads and writes", async () => {
      expect(await status(dentistA.agent, `/api/v1/visits/${visitB.id}`)).toBe(404);
      const write = await dentistA.agent
        .post(`/api/v1/visits/${liveB.id}/services`)
        .send({ procedureId: clinic.service.id, toothCode: '17', surfaces: ['O'] });
      expect(write.status).toBe(404);
      expect(write.body).toMatchObject({ code: 'visit.not_found' });
      expect(
        (await dentistA.agent.patch(`/api/v1/visits/${liveB.id}/notes`).send({ notes: 'x' }))
          .status,
      ).toBe(404);
    });

    it("keeps the patient's record whole: the chart shows the other dentist's work", async () => {
      const chart = await ok<PatientChart>(
        dentistA.agent.get(`/api/v1/clinical/patients/${patient.id}/chart`),
      );
      expect(chart.history.map((service) => service.visitId)).toEqual(
        expect.arrayContaining([visitA.id, visitB.id]),
      );
    });

    it('shows a visit’s money only with payment:read or on your own visit', async () => {
      const mine = await ok<VisitPage>(dentistA.agent.get('/api/v1/visits?range=all'));
      expect(mine.items[0]).toMatchObject({ total: '50.00' });

      const byAssistant = await ok<VisitPage>(assistant.agent.get('/api/v1/visits?range=all'));
      expect(ids(byAssistant)).toEqual([liveB.id, visitB.id, visitA.id]);
      expect(byAssistant.items.every((item) => item.total === null)).toBe(true);
      expect(byAssistant.items[1]?.services[0]?.final).toBeNull();

      const byDesk = await ok<VisitPage>(desk.agent.get('/api/v1/visits?range=all'));
      expect(byDesk.items[1]).toMatchObject({ total: '50.00' });
      const deskSummary = await ok<VisitListSummary>(
        desk.agent.get('/api/v1/visits/summary?range=all'),
      );
      expect(deskSummary.billed).toBeNull();
      const ownerSummary = await ok<VisitListSummary>(
        clinic.owner.get('/api/v1/visits/summary?range=all'),
      );
      expect(ownerSummary.billed).toEqual([{ currency: 'USD', amount: '100.00' }]);
    });
  });

  describe('hand-off and the billing route map', () => {
    it('gives the dentist his visit’s figures, handed off to front desk, and 404 for another’s', async () => {
      const handed = await ok<HandedOffVisitSummary>(
        dentistA.agent.get(`/api/v1/billing/visits/${visitA.id}/summary`),
      );
      expect(handed).toEqual({
        handedOff: true,
        visitId: visitA.id,
        currency: 'USD',
        visit: { total: '50.00', paid: '0.00', outstanding: '50.00' },
      });
      expect(await status(dentistA.agent, `/api/v1/billing/visits/${visitB.id}/summary`)).toBe(404);
      const full = await ok<FullVisitSummary>(
        desk.agent.get(`/api/v1/billing/visits/${visitA.id}/summary`),
      );
      expect(full).toMatchObject({ handedOff: false, totalOutstanding: '100.00' });
    });

    it('refuses the dentist every money route, and front desk the clinic-wide ones', async () => {
      const finance = [
        '/api/v1/billing/payments',
        '/api/v1/billing/payments/export',
        '/api/v1/billing/aging',
        '/api/v1/billing/outstanding',
        '/api/v1/billing/patients/owing-count',
        '/api/v1/billing/patients/export',
        '/api/v1/billing/patients?view=owing',
        '/api/v1/billing/patients?sort=balance',
        `/api/v1/billing/balances?patientIds=${patient.id}`,
        '/api/v1/billing/visits/unpaid',
        '/api/v1/billing/visits/unpaid/summary',
        '/api/v1/billing/visits/export',
      ];
      const account = [
        `/api/v1/billing/patients/${patient.id}/balance`,
        `/api/v1/billing/patients/${patient.id}/account`,
        `/api/v1/billing/patients/${patient.id}/statement`,
        `/api/v1/billing/visits/balances?visitIds=${visitA.id}`,
        '/api/v1/billing/checkout-queue',
      ];
      for (const path of [...finance, ...account]) {
        expect(await status(dentistA.agent, path), path).toBe(403);
      }
      for (const path of finance) {
        expect(await status(desk.agent, path), path).toBe(403);
      }
      for (const path of account) {
        expect(await status(desk.agent, path), path).toBe(200);
      }
      for (const path of finance) {
        expect([200], path).toContain(await status(clinic.owner, path));
      }
      // The patients list and Not seen stay with patient:read: they are about patients.
      expect(await status(dentistA.agent, '/api/v1/billing/patients?view=notSeen')).toBe(200);
      expect(await status(dentistA.agent, '/api/v1/billing/patients/not-seen-count')).toBe(200);
    });

    it('puts the dentist’s visit in front desk’s queue; front desk collects but cannot discount', async () => {
      const queue = await ok<CheckoutQueue>(desk.agent.get('/api/v1/billing/checkout-queue'));
      expect(queue.items.map((item) => [item.visit.id, item.balance.outstanding])).toEqual([
        [visitA.id, '50.00'],
        [visitB.id, '50.00'],
      ]);

      const discount = await desk.agent.post(`/api/v1/visits/${visitA.id}/checkout-discount`).send({
        expectedUpdatedAt: visitA.updatedAt,
        discount: { mode: 'amount', value: '5' },
      });
      expect(discount.status).toBe(403);

      await ok(
        desk.agent.post('/api/v1/billing/payments').set('Idempotency-Key', newId()).send({
          patientId: patient.id,
          amount: '50',
          method: 'cash',
          paidAt: TODAY,
          contextVisitId: visitA.id,
        }),
        201,
      );
      const after = await ok<CheckoutQueue>(desk.agent.get('/api/v1/billing/checkout-queue'));
      expect(after.items.map((item) => item.visit.id)).toEqual([visitB.id]);
    });
  });

  describe('discounts need visit:discount', () => {
    let other: Patient;

    beforeAll(async () => {
      other = await ok<Patient>(
        clinic.owner
          .post('/api/v1/patients')
          .set('Idempotency-Key', newId())
          .send({ fullName: 'Other Patient' }),
        201,
      );
    });

    it('refuses the dentist a visit discount, a line price and an amendment that discounts', async () => {
      const live = await start(dentistA, undefined, other.id);
      const added = await ok<{ visit: Visit }>(
        dentistA.agent
          .post(`/api/v1/visits/${live.id}/services`)
          .send({ procedureId: clinic.service.id, toothCode: '26', surfaces: ['O'] }),
        201,
      );
      const line = added.visit.services[0];
      if (!line) throw new Error('no line');
      expect(
        (
          await dentistA.agent
            .patch(`/api/v1/visits/${live.id}/discount`)
            .send({ mode: 'percent', value: '10' })
        ).status,
      ).toBe(403);
      for (const patch of [{ discountAmount: '5' }, { baseAmount: '10' }]) {
        expect(
          (await dentistA.agent.patch(`/api/v1/visits/${live.id}/services/${line.id}`).send(patch))
            .status,
        ).toBe(403);
      }
      await ok(
        dentistA.agent
          .post(`/api/v1/visits/${live.id}/services`)
          .send({ procedureId: clinic.service.id, toothCode: '36', surfaces: ['O'] }),
        201,
      );
      const done = (
        await ok<VisitResult>(dentistA.agent.post(`/api/v1/visits/${live.id}/complete`))
      ).visit;

      const discounting = await dentistA.agent.post(`/api/v1/visits/${live.id}/amend`).send({
        expectedUpdatedAt: done.updatedAt,
        reason: 'Courtesy',
        discount: { mode: 'amount', value: '5' },
        services: done.services.map((service) => ({ id: service.id })),
      });
      expect(discounting.status).toBe(403);

      // An amendment that leaves the discount alone needs visit:amend only.
      const [kept] = done.services;
      if (!kept) throw new Error('no service');
      await ok(
        dentistA.agent.post(`/api/v1/visits/${live.id}/amend`).send({
          expectedUpdatedAt: done.updatedAt,
          reason: 'Charted twice',
          discount: { mode: done.discountMode, value: done.discountValue },
          services: [{ id: kept.id }],
        }),
      );
    });
  });

  describe('the audit feed', () => {
    it('shows the dentist no money rows and no rows about visits outside his scope', async () => {
      const mine = await ok<AuditPage>(dentistA.agent.get('/api/v1/audit?limit=100'));
      expect(mine.items.length).toBeGreaterThan(0);
      expect(mine.items.filter((entry) => entry.visitId === visitB.id)).toEqual([]);
      expect(
        mine.items.filter(
          (entry) =>
            entry.action.startsWith('payment.') ||
            entry.action.startsWith('ledger_entry.') ||
            entry.resourceType === 'event',
        ),
      ).toEqual([]);
      expect(
        await ok<AuditPage>(dentistA.agent.get(`/api/v1/audit?visitId=${visitB.id}`)),
      ).toMatchObject({ items: [] });

      const owner = await ok<AuditPage>(clinic.owner.get('/api/v1/audit?limit=100'));
      expect(owner.items.some((entry) => entry.visitId === visitB.id)).toBe(true);
      expect(owner.items.some((entry) => entry.action === 'payment.create')).toBe(true);
    });
  });
});
