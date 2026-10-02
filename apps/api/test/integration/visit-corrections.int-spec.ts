import type {
  AuditEntry,
  AuditPage,
  Branch,
  OpeningBalanceResult,
  Patient,
  PatientBalance,
  PlanResult,
  ProblemDetails,
  ServiceItem,
  ServiceResult,
  StaffUser,
  StartVisitResult,
  Visit,
  VisitFinancialSummary,
  VisitResult,
} from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { BillingService } from '../../src/modules/billing/application/billing.service';
import { newId } from '../../src/platform/kernel/id';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { createPlatformAdmin, signIn, signInAndSetPassword, uniqueEmail } from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';

const TEMPORARY = 'temporary-pw-1';

/** Beirut is UTC+3 in June: the tenant's today is 2026-06-10 all day at this instant. */
const NOON = '2026-06-10T09:00:00Z';
const TODAY = '2026-06-10';

interface Staff {
  agent: TestAgent;
  user: StaffUser;
}

interface LedgerRow {
  kind: string;
  amount: string;
  effective_date: string;
  reason: string | null;
  created_by: string;
  amendment_id: string | null;
}

interface AmendmentRow {
  id: string;
  sequence: number;
  reason: string;
  delta: string;
  amended_by: string;
  before: { total: string; services: { id: string }[] };
  after: { total: string; services: { id: string; toothCode: string | null }[] };
}

const problem = (body: unknown) => body as ProblemDetails;

describe('clinical + billing: amending and voiding a completed visit (4b)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let owner: TestAgent;
  let branch: Branch;
  let dentist: Staff;
  let assistant: Staff;
  let frontdesk: Staff;
  let service: Record<'fill' | 'crown', ServiceItem>;

  const createStaff = async (role: 'dentist' | 'assistant' | 'frontdesk'): Promise<Staff> => {
    const email = uniqueEmail(role);
    const response = await owner.post('/api/v1/users').send({
      displayName: `The ${role} ${newId().slice(-6)}`,
      email,
      practitionerType: role,
      roleKeys: [role],
      branchIds: [branch.id],
      temporaryPassword: TEMPORARY,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const agent = await signInAndSetPassword(testApp.app, email, TEMPORARY);
    return { agent, user: response.body as StaffUser };
  };

  /** A patient carried over owing `amount`, so "the pre-visit figure" is not zero. */
  const patientOwing = async (fullName: string, amount: string): Promise<Patient> => {
    const response = await owner.post('/api/v1/billing/opening-balances').send({
      patient: { fullName, phone: '71 000 000' },
      openingBalance: { amount, asOf: TODAY },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return (response.body as OpeningBalanceResult).patient;
  };

  const ok = async <T>(request: Promise<{ status: number; body: unknown }>, status = 200) => {
    const response = await request;
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    return response.body as T;
  };

  const startVisit = async (patient: Patient) =>
    (
      await ok<StartVisitResult>(
        dentist.agent
          .post('/api/v1/visits')
          .send({ patientId: patient.id, dentistId: dentist.user.profileId }),
        201,
      )
    ).visit;

  const addService = (visitId: string, body: Record<string, unknown>) =>
    ok<ServiceResult>(dentist.agent.post(`/api/v1/visits/${visitId}/services`).send(body), 201);

  /**
   * A filling on 16 (50) and a crown performed from a plan on 21 (80), 10 % off: total 117. The
   * crown's plan is made and performed in this same visit.
   */
  const completedVisit = async (patient: Patient) => {
    const visit = await startVisit(patient);
    const filling = await addService(visit.id, {
      procedureId: service.fill.id,
      toothCode: '16',
      surfaces: ['O', 'M'],
    });
    const plan = await ok<PlanResult>(
      dentist.agent
        .post(`/api/v1/visits/${visit.id}/plans`)
        .send({ procedureId: service.crown.id, toothCode: '21' }),
      201,
    );
    const performed = await ok<PlanResult>(
      dentist.agent.post(`/api/v1/visits/${visit.id}/plans/${plan.record.id}/perform`),
    );
    const crown = performed.visit.services.find((line) => line.planId === plan.record.id);
    if (!crown) throw new Error('performing the plan added no service');
    await ok(
      dentist.agent
        .patch(`/api/v1/visits/${visit.id}/discount`)
        .send({ mode: 'percent', value: '10' }),
    );
    const done = (await ok<VisitResult>(dentist.agent.post(`/api/v1/visits/${visit.id}/complete`)))
      .visit;
    return {
      visit: done,
      fillingId: filling.record.id,
      crownId: crown.id,
      planId: plan.record.id,
    };
  };

  const amend = (agent: TestAgent, visit: Visit, body: Record<string, unknown>) =>
    agent
      .post(`/api/v1/visits/${visit.id}/amend`)
      .send({ expectedUpdatedAt: visit.updatedAt, ...body });

  const voidVisit = (agent: TestAgent, visit: Visit, reason = 'Wrong patient') =>
    agent
      .post(`/api/v1/visits/${visit.id}/void`)
      .send({ expectedUpdatedAt: visit.updatedAt, reason });

  const balanceOf = async (patientId: string) =>
    (await ok<PatientBalance>(owner.get(`/api/v1/billing/patients/${patientId}/balance`))).balances;

  const ledgerOf = async (visitId: string) =>
    (
      await database.ownerPool.query<LedgerRow>(
        `select kind, amount::text, effective_date::text, reason, created_by, amendment_id
         from ledger_entries where visit_id = $1 order by created_at, id`,
        [visitId],
      )
    ).rows;

  const amendmentsOf = async (visitId: string) =>
    (
      await database.ownerPool.query<AmendmentRow>(
        `select id, sequence, reason, delta::text, amended_by, before, after
         from visit_amendments where visit_id = $1 order by sequence`,
        [visitId],
      )
    ).rows;

  const planStatus = async (planId: string) =>
    (
      await database.ownerPool.query<{ status: string; performed_in_visit_id: string | null }>(
        'select status, performed_in_visit_id from treatment_plans where id = $1',
        [planId],
      )
    ).rows[0];

  const auditOf = async (visitId: string): Promise<AuditEntry[]> =>
    (
      await ok<AuditPage>(
        owner.get(`/api/v1/audit?resourceType=visit&resourceId=${visitId}&limit=100`),
      )
    ).items;

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    testApp.clock.set(new Date(NOON));
    const admin = await signIn(testApp.app, await createPlatformAdmin(testApp.app), undefined, {
      rememberMe: true,
    });
    const ownerEmail = uniqueEmail('owner');
    const provisioned = await admin.post('/api/v1/platform/tenants').send({
      clinic: { name: 'Correction Clinic', slug: `cor-${newId().slice(-12)}` },
      firstBranch: { name: 'Correction Main' },
      owner: { displayName: 'Correction Owner', email: ownerEmail, temporaryPassword: TEMPORARY },
    });
    expect(provisioned.status, JSON.stringify(provisioned.body)).toBe(201);
    owner = await signInAndSetPassword(testApp.app, ownerEmail, TEMPORARY);
    const [first] = (await owner.get('/api/v1/branches')).body as Branch[];
    if (!first) throw new Error('provisioning created no branch');
    branch = first;

    const services = await ok<ServiceItem[]>(
      owner.put('/api/v1/catalog/services').send({
        items: [
          { code: 'ZFILL', name: 'Test filling', chargeUnit: 'per_tooth', price: '50' },
          { code: 'ZCROWN', name: 'Test crown', chargeUnit: 'per_tooth', price: '80' },
        ],
      }),
    );
    const byCode = (code: string) => {
      const found = services.find((item) => item.code === code);
      if (!found) throw new Error(`no service ${code}`);
      return found;
    };
    service = { fill: byCode('ZFILL'), crown: byCode('ZCROWN') };

    dentist = await createStaff('dentist');
    assistant = await createStaff('assistant');
    frontdesk = await createStaff('frontdesk');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    testApp.clock.set(new Date(NOON));
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  it('numbers visits per tenant in start order', async () => {
    const patient = await patientOwing('Number Order', '1');
    const first = await startVisit(patient);
    await ok(dentist.agent.post(`/api/v1/visits/${first.id}/discard`));
    const second = await startVisit(patient);
    expect(second.displayNumber).toBe(first.displayNumber + 1);
  });

  it('amends: removing a service lowers the total, posts a negative adjustment and reopens its plan', async () => {
    const patient = await patientOwing('Amend Remove', '40');
    const { visit, fillingId, crownId, planId } = await completedVisit(patient);
    expect(await balanceOf(patient.id)).toEqual([{ amount: '157.00', currency: 'USD' }]);

    const { visit: amended } = await ok<VisitResult>(
      amend(dentist.agent, visit, {
        reason: 'Crown not placed',
        discount: { mode: 'percent', value: '10' },
        services: [{ id: fillingId }],
      }),
    );

    expect(amended.status).toBe('amended');
    expect(amended.money).toMatchObject({ subtotal: '50.00', discount: '5.00', total: '45.00' });
    expect(amended.services.map((line) => line.id)).toEqual([fillingId]);
    expect(await ledgerOf(visit.id)).toEqual([
      expect.objectContaining({ kind: 'visit_charge', amount: '117.00', amendment_id: null }),
      {
        kind: 'visit_charge_adjustment',
        amount: '-72.00',
        effective_date: TODAY,
        reason: 'Crown not placed',
        created_by: dentist.user.id,
        amendment_id: expect.any(String) as string,
      },
    ]);
    expect(await balanceOf(patient.id)).toEqual([{ amount: '85.00', currency: 'USD' }]);
    expect(await planStatus(planId)).toEqual({ status: 'planned', performed_in_visit_id: null });

    const [amendment, ...more] = await amendmentsOf(visit.id);
    expect(more).toEqual([]);
    expect(amendment).toMatchObject({
      sequence: 1,
      reason: 'Crown not placed',
      delta: '-72.00',
      amended_by: dentist.user.id,
      before: { total: '117.00' },
      after: { total: '45.00' },
    });
    expect(amendment?.before.services.map((line) => line.id)).toEqual([fillingId, crownId]);
    const [ledgerAdjustment] = (await ledgerOf(visit.id)).slice(1);
    expect(ledgerAdjustment?.amendment_id).toBe(amendment?.id);

    const [latest] = await auditOf(visit.id);
    expect(latest).toMatchObject({
      action: 'visit.amend',
      reason: 'Crown not placed',
      before: { total: '117.00' },
      after: { total: '45.00' },
    });
    const summary = await ok<VisitFinancialSummary>(
      owner.get(`/api/v1/billing/visits/${visit.id}/summary`),
    );
    expect(summary).toMatchObject({
      visit: { total: '45.00', outstanding: '45.00' },
      previous: '40.00',
      totalOutstanding: '85.00',
    });
  });

  it('amends a tooth with no money change: an amendment row, no ledger entry; then again', async () => {
    const patient = await patientOwing('Amend Tooth', '1');
    const { visit, fillingId, crownId } = await completedVisit(patient);

    const { visit: moved } = await ok<VisitResult>(
      amend(dentist.agent, visit, {
        reason: 'Tooth corrected 16 → 17',
        discount: { mode: 'percent', value: '10' },
        services: [{ id: fillingId, toothCode: '17' }, { id: crownId }],
      }),
    );
    expect(moved.services.find((line) => line.id === fillingId)?.toothCode).toBe('17');
    expect(moved.money.total).toBe('117.00');
    expect((await ledgerOf(visit.id)).map((row) => row.kind)).toEqual(['visit_charge']);

    await ok(
      amend(dentist.agent, moved, {
        reason: 'No discount after all',
        discount: { mode: 'percent', value: '0' },
        services: [{ id: fillingId }, { id: crownId }],
      }),
    );
    expect((await amendmentsOf(visit.id)).map((row) => [row.sequence, row.delta])).toEqual([
      [1, '0.00'],
      [2, '13.00'],
    ]);
    expect((await ledgerOf(visit.id)).map((row) => row.amount)).toEqual(['117.00', '13.00']);
  });

  it('refuses a stale, an empty, a live and an illegal amendment', async () => {
    const patient = await patientOwing('Amend Refused', '1');
    const { visit, fillingId, crownId } = await completedVisit(patient);
    const services = [{ id: fillingId }, { id: crownId }];
    const discount = { mode: 'percent', value: '10' };

    const stale = await amend(
      dentist.agent,
      { ...visit, updatedAt: '2026-01-01T00:00:00.000Z' },
      {
        reason: 'Stale',
        discount: { mode: 'percent', value: '0' },
        services,
      },
    );
    expect(stale.status).toBe(409);
    expect(problem(stale.body).code).toBe('visit.stale');

    const nothing = await amend(dentist.agent, visit, { reason: 'Nothing', discount, services });
    expect(nothing.status).toBe(422);
    expect(problem(nothing.body).code).toBe('visit.amend_no_change');

    const moveCrown = await amend(dentist.agent, visit, {
      reason: 'Move crown',
      discount,
      services: [{ id: fillingId }, { id: crownId, toothCode: '22' }],
    });
    expect(problem(moveCrown.body).code).toBe('visit.amend_plan_linked');

    const live = await startVisit(await patientOwing('Amend Live', '1'));
    const notDone = await amend(dentist.agent, live, { reason: 'Live', discount, services });
    expect(notDone.status).toBe(409);
    expect(problem(notDone.body).code).toBe('visit.not_amendable');

    expect(await amendmentsOf(visit.id)).toEqual([]);
  });

  it('voids: reverses what the visit charges, back to the pre-visit balance; voided is final', async () => {
    const patient = await patientOwing('Void Net', '40');
    const { visit, fillingId } = await completedVisit(patient);
    const { visit: amended } = await ok<VisitResult>(
      amend(dentist.agent, visit, {
        reason: 'Crown not placed',
        discount: { mode: 'percent', value: '10' },
        services: [{ id: fillingId }],
      }),
    );

    const { visit: voided } = await ok<VisitResult>(voidVisit(dentist.agent, amended));
    expect(voided).toMatchObject({ status: 'voided', voidReason: 'Wrong patient' });
    expect((await ledgerOf(visit.id)).map((row) => [row.kind, row.amount])).toEqual([
      ['visit_charge', '117.00'],
      ['visit_charge_adjustment', '-72.00'],
      ['visit_charge_reversal', '-45.00'],
    ]);
    expect(await balanceOf(patient.id)).toEqual([{ amount: '40.00', currency: 'USD' }]);

    const again = await voidVisit(dentist.agent, voided);
    expect(again.status).toBe(409);
    expect(problem(again.body).code).toBe('visit.not_voidable');
    const amendVoided = await amend(dentist.agent, voided, {
      reason: 'Too late',
      discount: { mode: 'percent', value: '0' },
      services: [{ id: fillingId }],
    });
    expect(problem(amendVoided.body).code).toBe('visit.not_amendable');

    const chart = (
      await ok<{ voidedVisitIds: string[] }>(
        owner.get(`/api/v1/clinical/patients/${patient.id}/chart`),
      )
    ).voidedVisitIds;
    expect(chart).toEqual([visit.id]);
    const last = await owner.get(`/api/v1/clinical/patients/${patient.id}/last-visit`);
    expect(last.body).toBeNull();
  });

  it('is vetoed by billing when payments sit on the visit: nothing changes (ADR-0026)', async () => {
    const patient = await patientOwing('Void Veto', '1');
    const { visit } = await completedVisit(patient);
    vi.spyOn(testApp.app.get(BillingService, { strict: false }), 'paidOn').mockResolvedValue(
      '10.00',
    );

    const vetoed = await voidVisit(dentist.agent, visit);
    expect(vetoed.status).toBe(409);
    expect(problem(vetoed.body).code).toBe('visit.has_payments');
    expect((await ok<Visit>(owner.get(`/api/v1/visits/${visit.id}`))).status).toBe('completed');
    expect((await ledgerOf(visit.id)).map((row) => row.kind)).toEqual(['visit_charge']);
    expect((await auditOf(visit.id)).map((entry) => entry.action)).not.toContain('visit.void');
  });

  it('allows amend and void to dentists and owners only', async () => {
    const patient = await patientOwing('Void Roles', '1');
    const { visit, fillingId } = await completedVisit(patient);
    for (const agent of [frontdesk.agent, assistant.agent]) {
      const amended = await amend(agent, visit, {
        reason: 'Not mine',
        discount: { mode: 'percent', value: '0' },
        services: [{ id: fillingId }],
      });
      expect(amended.status).toBe(403);
      expect((await voidVisit(agent, visit)).status).toBe(403);
    }
    await ok(voidVisit(owner, visit));
  });

  it('keeps amendments append-only for the runtime role', async () => {
    const patient = await patientOwing('Append Only', '1');
    const { visit, fillingId } = await completedVisit(patient);
    await ok(
      amend(dentist.agent, visit, {
        reason: 'Crown not placed',
        discount: { mode: 'percent', value: '10' },
        services: [{ id: fillingId }],
      }),
    );
    await expect(
      database.appPool.query(`update visit_amendments set reason = 'rewritten'`),
    ).rejects.toThrow(/permission denied/);
    await expect(database.appPool.query('delete from visit_amendments')).rejects.toThrow(
      /permission denied/,
    );
  });
});
