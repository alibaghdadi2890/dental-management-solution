import type {
  AuditEntry,
  AuditPage,
  Branch,
  OpeningBalanceResult,
  Patient,
  PatientBalance,
  ProblemDetails,
  ServiceItem,
  ServiceResult,
  StaffUser,
  StartVisitResult,
  Tenant,
  Visit,
  VisitFinancialSummary,
  VisitResult,
} from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { LedgerEntriesRepository } from '../../src/modules/billing/persistence/ledger-entries.repository';
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
  id: string;
  patient_id: string;
  kind: string;
  amount: string;
  currency: string;
  effective_date: string;
  created_by: string;
  visit_id: string | null;
}

interface LineRow {
  position: number;
  code: string;
  name: string;
  tooth_code: string | null;
  surfaces: string[];
  amount: string;
  currency: string;
}

const problem = (body: unknown) => body as ProblemDetails;

describe('billing: the visit charge, posted in the completion transaction (ADR-0024)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let admin: TestAgent;
  let tenant: Tenant;
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

  const createPatient = async (fullName: string): Promise<Patient> => {
    const response = await owner
      .post('/api/v1/patients')
      .set('Idempotency-Key', newId())
      .send({ fullName, phone: '71 000 000' });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as Patient;
  };

  /** A patient carried over with an opening balance of `amount`, as of today. */
  const patientOwing = async (fullName: string, amount: string): Promise<Patient> => {
    const response = await owner
      .post('/api/v1/billing/opening-balances')
      .set('Idempotency-Key', newId())
      .send({
        patient: { fullName, phone: '71 000 000' },
        openingBalance: { amount, asOf: TODAY },
      });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return (response.body as OpeningBalanceResult).patient;
  };

  const startVisit = async (patient: Patient, agent: TestAgent = dentist.agent) => {
    const response = await agent
      .post('/api/v1/visits')
      .send({ patientId: patient.id, dentistId: dentist.user.profileId });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return (response.body as StartVisitResult).visit;
  };

  const addService = async (
    agent: TestAgent,
    visitId: string,
    body: Record<string, unknown>,
  ): Promise<ServiceResult> => {
    const response = await agent.post(`/api/v1/visits/${visitId}/services`).send(body);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as ServiceResult;
  };

  const complete = (agent: TestAgent, visitId: string) =>
    agent.post(`/api/v1/visits/${visitId}/complete`);

  const completed = async (agent: TestAgent, visitId: string): Promise<Visit> => {
    const response = await complete(agent, visitId);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return (response.body as VisitResult).visit;
  };

  const act = async (agent: TestAgent, visitId: string, action: string) => {
    const response = await agent.post(`/api/v1/visits/${visitId}/${action}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  };

  const summaryOf = (agent: TestAgent, visitId: string) =>
    agent.get(`/api/v1/billing/visits/${visitId}/summary`);

  const summary = async (visitId: string, agent: TestAgent = frontdesk.agent) => {
    const response = await summaryOf(agent, visitId);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body as VisitFinancialSummary;
  };

  const balanceOf = async (patientId: string): Promise<PatientBalance> => {
    const response = await owner.get(`/api/v1/billing/patients/${patientId}/balance`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body as PatientBalance;
  };

  const auditOf = async (query: string): Promise<AuditEntry[]> =>
    ((await owner.get(`/api/v1/audit?${query}&limit=100`)).body as AuditPage).items;

  const chargesOf = async (visitId: string) =>
    (
      await database.ownerPool.query<LedgerRow>(
        `select id, patient_id, kind, amount::text, currency, effective_date::text, created_by,
                visit_id
         from ledger_entries where visit_id = $1`,
        [visitId],
      )
    ).rows;

  const linesOf = async (entryId: string) =>
    (
      await database.ownerPool.query<LineRow>(
        `select position, code, name, tooth_code, surfaces, amount::text, currency
         from ledger_entry_lines where entry_id = $1 order by position`,
        [entryId],
      )
    ).rows;

  const statusOf = async (visitId: string) =>
    (
      await database.ownerPool.query<{ status: string; completed_at: Date | null }>(
        'select status, completed_at from visits where id = $1',
        [visitId],
      )
    ).rows[0];

  const merge = async (keepId: string, dropId: string) => {
    const response = await owner
      .post('/api/v1/patients/merge')
      .send({ keepId, dropId, reason: 'Same person' });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  };

  /** `ledger_entry.create` audit rows for `visitId`'s charge, wherever the entry now lives. */
  const ledgerCreateAuditFor = async (visitId: string) =>
    (
      await database.ownerPool.query<{ id: string }>(
        `select id from audit_log
         where action = 'ledger_entry.create' and after ->> 'visitId' = $1`,
        [visitId],
      )
    ).rows;

  /** Audit rows of a dispatched domain event of `name` carrying `visitId` in its payload. */
  const eventAuditFor = async (name: string, visitId: string) =>
    (
      await database.ownerPool.query<{ id: string }>(
        `select id from audit_log
         where action = $1 and resource_type = 'event' and after ->> 'visitId' = $2`,
        [name, visitId],
      )
    ).rows;

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    testApp.clock.set(new Date(NOON));
    admin = await signIn(testApp.app, await createPlatformAdmin(testApp.app), undefined, {
      rememberMe: true,
    });
    const ownerEmail = uniqueEmail('owner');
    const provisioned = await admin.post('/api/v1/platform/tenants').send({
      clinic: { name: 'Charge Clinic', slug: `chg-${newId().slice(-12)}` },
      firstBranch: { name: 'Charge Main' },
      owner: { displayName: 'Charge Owner', email: ownerEmail, temporaryPassword: TEMPORARY },
    });
    expect(provisioned.status, JSON.stringify(provisioned.body)).toBe(201);
    tenant = provisioned.body as Tenant;
    owner = await signInAndSetPassword(testApp.app, ownerEmail, TEMPORARY);
    const [first] = (await owner.get('/api/v1/branches')).body as Branch[];
    if (!first) throw new Error('provisioning created no branch');
    branch = first;

    const services = await owner.put('/api/v1/catalog/services').send({
      items: [
        { code: 'ZFILL', name: 'Test filling', chargeUnit: 'per_tooth', price: '50' },
        { code: 'ZCROWN', name: 'Test crown', chargeUnit: 'per_tooth', price: '80' },
      ],
    });
    expect(services.status, JSON.stringify(services.body)).toBe(200);
    const byCode = (code: string) => {
      const found = (services.body as ServiceItem[]).find((item) => item.code === code);
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

  /** Two services (50 + 80) and 10 % off: subtotal 130, discount 13, total 117. */
  const chargeableVisit = async (patient: Patient, agent: TestAgent = dentist.agent) => {
    const visit = await startVisit(patient);
    await addService(agent, visit.id, {
      procedureId: service.fill.id,
      toothCode: '16',
      surfaces: ['O', 'M'],
    });
    await addService(agent, visit.id, { procedureId: service.crown.id, toothCode: '21' });
    const discount = await agent
      .patch(`/api/v1/visits/${visit.id}/discount`)
      .send({ mode: 'percent', value: '10' });
    expect(discount.status, JSON.stringify(discount.body)).toBe(200);
    return visit;
  };

  it('posts one visit_charge of the total with its lines, on the local date, by the completing user', async () => {
    const patient = await createPatient('Charge Lines');
    const visit = await chargeableVisit(patient);

    const done = await completed(dentist.agent, visit.id);
    expect(done.money).toEqual({
      subtotal: '130.00',
      discount: '13.00',
      total: '117.00',
      capped: false,
    });

    const [charge, ...others] = await chargesOf(visit.id);
    expect(others).toEqual([]);
    expect(charge).toMatchObject({
      patient_id: patient.id,
      kind: 'visit_charge',
      amount: '117.00',
      currency: 'USD',
      effective_date: TODAY,
      created_by: dentist.user.id,
      visit_id: visit.id,
    });
    if (!charge) throw new Error('no charge');
    expect(await linesOf(charge.id)).toEqual([
      {
        position: 1,
        code: 'ZFILL',
        name: 'Test filling',
        tooth_code: '16',
        surfaces: ['O', 'M'],
        amount: '50.00',
        currency: 'USD',
      },
      {
        position: 2,
        code: 'ZCROWN',
        name: 'Test crown',
        tooth_code: '21',
        surfaces: [],
        amount: '80.00',
        currency: 'USD',
      },
    ]);

    const audit = await auditOf(`resourceType=ledger_entry&resourceId=${charge.id}`);
    expect(audit.map((entry) => entry.action)).toEqual(['ledger_entry.create']);
    expect(audit[0]).toMatchObject({
      actorUserId: dentist.user.id,
      after: { kind: 'visit_charge', amount: '117.00', visitId: visit.id },
    });
    await expect
      .poll(async () =>
        (await auditOf('resourceType=event'))
          .filter((entry) => entry.action === 'LedgerEntryRecorded')
          .map((entry) => entry.after),
      )
      .toContainEqual({ entryId: charge.id, patientId: patient.id, kind: 'visit_charge' });
  });

  it('builds the summary from the ledger: an opening balance of 40 plus 117 is 117 / 40 / 157', async () => {
    const patient = await patientOwing('Charge Summary', '40');
    const visit = await chargeableVisit(patient);
    const live = await summaryOf(frontdesk.agent, visit.id);
    expect(live.status).toBe(409);
    expect(problem(live.body).code).toBe('visit.not_live');

    await completed(dentist.agent, visit.id);
    expect(await summary(visit.id)).toEqual({
      visitId: visit.id,
      currency: 'USD',
      visit: { total: '117.00', paid: '0.00', outstanding: '117.00' },
      previous: '40.00',
      totalOutstanding: '157.00',
      payments: [],
    });
    expect(await balanceOf(patient.id)).toEqual({
      patientId: patient.id,
      balances: [{ amount: '157.00', currency: 'USD' }],
      charged: [{ amount: '117.00', currency: 'USD' }],
    });
    const many = await owner.get(`/api/v1/billing/balances?patientIds=${patient.id}`);
    expect(many.body).toEqual([
      {
        patientId: patient.id,
        balances: [{ amount: '157.00', currency: 'USD' }],
        charged: [{ amount: '117.00', currency: 'USD' }],
      },
    ]);

    for (const id of [newId(), visit.patientId]) {
      const missing = await summaryOf(frontdesk.agent, id);
      expect(missing.status).toBe(404);
      expect(problem(missing.body).code).toBe('visit.not_found');
    }
  });

  it('posts nothing for an examination-only visit (total 0); its summary is 0 / previous / previous', async () => {
    const patient = await patientOwing('Charge Zero', '25');
    const visit = await startVisit(patient);
    const done = await completed(dentist.agent, visit.id);
    expect(done.money.total).toBe('0.00');

    expect(await chargesOf(visit.id)).toEqual([]);
    expect(await summary(visit.id)).toEqual({
      visitId: visit.id,
      currency: 'USD',
      visit: { total: '0.00', paid: '0.00', outstanding: '0.00' },
      previous: '25.00',
      totalOutstanding: '25.00',
      payments: [],
    });
    expect((await balanceOf(patient.id)).charged).toEqual([]);
  });

  it('lets an assistant (no payment:write) complete: the charge posts as theirs', async () => {
    const patient = await createPatient('Charge Assistant');
    const visit = await chargeableVisit(patient, assistant.agent);
    const refused = await assistant.agent
      .post(`/api/v1/billing/patients/${patient.id}/adjustments`)
      .set('Idempotency-Key', newId())
      .send({ amount: '5', effectiveDate: TODAY, reason: 'courtesy' });
    expect(refused.status).toBe(403);

    await completed(assistant.agent, visit.id);
    const [charge] = await chargesOf(visit.id);
    expect(charge).toMatchObject({ amount: '117.00', created_by: assistant.user.id });
    expect((await summary(visit.id, assistant.agent)).totalOutstanding).toBe('117.00');
  });

  it('rolls the completion back when the ledger write fails: the visit stays live, no entry', async () => {
    const patient = await createPatient('Charge Atomic');
    const visit = await chargeableVisit(patient);
    const entries = testApp.app.get(LedgerEntriesRepository, { strict: false });
    const insertLines = entries.insertLines.bind(entries);
    vi.spyOn(entries, 'insertLines').mockImplementationOnce(async (entryId, lines) => {
      await insertLines(entryId, lines);
      throw new Error('ledger write failed after the insert');
    });

    const failed = await complete(dentist.agent, visit.id);
    expect(failed.status).toBe(500);
    expect(problem(failed.body).code).toBe('internal_error');
    expect(await statusOf(visit.id)).toEqual({ status: 'in_progress', completed_at: null });
    expect(await chargesOf(visit.id)).toEqual([]);
    const actions = (await auditOf(`resourceType=visit&resourceId=${visit.id}`)).map(
      (entry) => entry.action,
    );
    expect(actions).not.toContain('visit.complete');
    // The whole completion transaction rolled back: no half-written ledger audit row for this
    // visit (the insert that would have written it never even ran), and `VisitCompleted` was
    // never dispatched (it publishes inside that same transaction, before commit).
    expect(await ledgerCreateAuditFor(visit.id)).toEqual([]);
    expect(await eventAuditFor('VisitCompleted', visit.id)).toEqual([]);

    await completed(dentist.agent, visit.id);
    expect(await chargesOf(visit.id)).toHaveLength(1);
  });

  it('refuses a second completion (409 visit.not_live) and still holds one entry', async () => {
    const patient = await createPatient('Charge Twice');
    const visit = await chargeableVisit(patient);
    const [first, second] = await Promise.all([
      complete(dentist.agent, visit.id),
      complete(assistant.agent, visit.id),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const again = await complete(dentist.agent, visit.id);
    expect(again.status).toBe(409);
    expect(problem(again.body).code).toBe('visit.not_live');
    expect(await chargesOf(visit.id)).toHaveLength(1);
  });

  it('charges the kept patient for a visit completed after its patient was merged away', async () => {
    const kept = await createPatient('Charge Merge Kept');
    const dropped = await createPatient('Charge Merge Dropped');
    const visit = await chargeableVisit(dropped);
    const merged = await owner
      .post('/api/v1/patients/merge')
      .send({ keepId: kept.id, dropId: dropped.id, reason: 'Same person' });
    expect(merged.status, JSON.stringify(merged.body)).toBe(200);

    await completed(dentist.agent, visit.id);
    expect(await chargesOf(visit.id)).toEqual([
      expect.objectContaining({ patient_id: kept.id, amount: '117.00' }),
    ]);
    expect((await summary(visit.id)).totalOutstanding).toBe('117.00');
  });

  it('moves a charge posted before the merge with the merge, so the summary is right at once', async () => {
    // The reverse order from the test above: the visit completes (and charges) before the merge.
    // Both re-points run in the merge transaction (H8): the visit and its charge are on the kept
    // patient when the merge answers.
    const kept = await createPatient('Charge Window Kept');
    const dropped = await patientOwing('Charge Window Dropped', '40');
    const visit = await chargeableVisit(dropped);
    await completed(dentist.agent, visit.id);
    expect(await chargesOf(visit.id)).toEqual([
      expect.objectContaining({ patient_id: dropped.id, amount: '117.00' }),
    ]);

    await merge(kept.id, dropped.id);
    expect(await chargesOf(visit.id)).toEqual([
      expect.objectContaining({ patient_id: kept.id, amount: '117.00' }),
    ]);
    expect(await summary(visit.id)).toEqual({
      visitId: visit.id,
      currency: 'USD',
      visit: { total: '117.00', paid: '0.00', outstanding: '117.00' },
      previous: '40.00',
      totalOutstanding: '157.00',
      payments: [],
    });
  });

  it('charges a line-level discount and drops a removed service from the charge', async () => {
    const patient = await createPatient('Charge Line Discount');
    const visit = await startVisit(patient);
    const fill = await addService(dentist.agent, visit.id, {
      procedureId: service.fill.id,
      toothCode: '16',
    });
    const crown = await addService(dentist.agent, visit.id, {
      procedureId: service.crown.id,
      toothCode: '21',
    });
    const discounted = await dentist.agent
      .patch(`/api/v1/visits/${visit.id}/services/${fill.record.id}`)
      .send({ discountAmount: '10' });
    expect(discounted.status, JSON.stringify(discounted.body)).toBe(200);
    const removed = await dentist.agent.delete(
      `/api/v1/visits/${visit.id}/services/${crown.record.id}`,
    );
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);

    const done = await completed(dentist.agent, visit.id);
    expect(done.money).toEqual({
      subtotal: '40.00',
      discount: '0.00',
      total: '40.00',
      capped: false,
    });

    const [charge, ...others] = await chargesOf(visit.id);
    expect(others).toEqual([]);
    if (!charge) throw new Error('no charge');
    expect(charge.amount).toBe('40.00');
    // The fill's line is base (50) − its own line discount (10); the removed crown has no line.
    expect(await linesOf(charge.id)).toEqual([
      {
        position: 1,
        code: 'ZFILL',
        name: 'Test filling',
        tooth_code: '16',
        surfaces: [],
        amount: '40.00',
        currency: 'USD',
      },
    ]);
  });

  it('keeps the charge on the day the visit started, even if it crosses local midnight before completing', async () => {
    const patient = await createPatient('Charge Midnight');
    // Beirut is UTC+3: 20:45 UTC on 06-09 is still 06-09 there; 21:15 UTC is already 06-10.
    testApp.clock.set(new Date('2026-06-09T20:45:00Z'));
    const visit = await startVisit(patient);
    expect(visit.localDate).toBe('2026-06-09');
    await addService(dentist.agent, visit.id, { procedureId: service.fill.id, toothCode: '16' });
    testApp.clock.set(new Date('2026-06-09T21:15:00Z'));

    const done = await completed(dentist.agent, visit.id);
    expect(done.localDate).toBe('2026-06-09');

    const [charge] = await chargesOf(visit.id);
    expect(charge).toMatchObject({ amount: '50.00', effective_date: '2026-06-09' });
  });

  it('times the visit without its pauses: 61 s of work is 2 minutes', async () => {
    const patient = await createPatient('Charge Duration');
    const visit = await startVisit(patient);
    testApp.clock.advance({ seconds: 30 });
    await act(dentist.agent, visit.id, 'pause');
    testApp.clock.advance({ minutes: 10 });
    await act(dentist.agent, visit.id, 'resume');
    testApp.clock.advance({ seconds: 31 });

    const done = await completed(dentist.agent, visit.id);
    expect(done).toMatchObject({ pausedSeconds: 600, durationMinutes: 2 });
  });

  it("keeps the runtime role from rewriting a charge's lines or its visit", async () => {
    const patient = await createPatient('Charge Grants');
    const visit = await chargeableVisit(patient);
    await completed(dentist.agent, visit.id);
    const [charge] = await chargesOf(visit.id);
    if (!charge) throw new Error('no charge');

    const client = await database.appPool.connect();
    try {
      await client.query("select set_config('app.tenant_id', $1, false)", [tenant.id]);
      const denied = /permission denied/;
      await expect(
        client.query('update ledger_entry_lines set amount = 1 where entry_id = $1', [charge.id]),
      ).rejects.toThrow(denied);
      await expect(
        client.query('delete from ledger_entry_lines where entry_id = $1', [charge.id]),
      ).rejects.toThrow(denied);
      await expect(
        client.query('update ledger_entries set visit_id = null where id = $1', [charge.id]),
      ).rejects.toThrow(denied);
    } finally {
      await client.query("select set_config('app.tenant_id', '', false)");
      client.release();
    }
    expect(await linesOf(charge.id)).toHaveLength(2);
  });
});
