import type {
  AuditEntry,
  AuditPage,
  Branch,
  DiagnosisItem,
  DiagnosisResult,
  Patient,
  PatientChart,
  PatientChartResult,
  PlanResult,
  ProblemDetails,
  ServiceItem,
  StaffUser,
  StartVisitResult,
  Tenant,
  Visit,
} from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../src/platform/kernel/id';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { createPlatformAdmin, signIn, signInAndSetPassword, uniqueEmail } from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';

const TEMPORARY = 'temporary-pw-1';

/** Beirut is UTC+3 in June: 22:30 UTC on the 9th is already the 10th in the clinic. */
const LATE = '2026-06-09T22:30:00Z';
const TODAY = '2026-06-10';

interface Staff {
  agent: TestAgent;
  user: StaffUser;
}

const problem = (body: unknown) => body as ProblemDetails;

describe('clinical: records on the patient, outside a visit (ADR-0031)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let admin: TestAgent;
  let tenant: Tenant;
  let owner: TestAgent;
  let branch: Branch;
  let dentist: Staff;
  let otherDentist: Staff;
  let assistant: Staff;
  let fill: ServiceItem;
  let caries: DiagnosisItem;

  const createStaff = async (role: 'dentist' | 'assistant'): Promise<Staff> => {
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
    const response = await owner.post('/api/v1/patients').send({ fullName, phone: '71 000 000' });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as Patient;
  };

  const record = (patient: Patient, rest: string) =>
    `/api/v1/clinical/patients/${patient.id}/${rest}`;

  /** A patient-level write that must succeed; answers the chart it returned. */
  const charted = async (
    request: Promise<{ status: number; body: unknown }>,
    status = 200,
  ): Promise<PatientChart> => {
    const response = await request;
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    return (response.body as PatientChartResult).chart;
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

  const startVisit = async (patient: Patient): Promise<Visit> => {
    const response = await dentist.agent
      .post('/api/v1/visits')
      .send({ patientId: patient.id, dentistId: dentist.user.profileId });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return (response.body as StartVisitResult).visit;
  };

  const auditOf = async (query: string): Promise<AuditEntry[]> =>
    ((await owner.get(`/api/v1/audit?${query}&limit=100`)).body as AuditPage).items;

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    testApp.clock.set(new Date(LATE));
    admin = await signIn(testApp.app, await createPlatformAdmin(testApp.app), undefined, {
      rememberMe: true,
    });
    const ownerEmail = uniqueEmail('owner');
    const provisioned = await admin.post('/api/v1/platform/tenants').send({
      clinic: { name: 'Planning Clinic', slug: `plan-${newId().slice(-12)}` },
      firstBranch: { name: 'Planning Main' },
      owner: { displayName: 'Planning Owner', email: ownerEmail, temporaryPassword: TEMPORARY },
    });
    expect(provisioned.status, JSON.stringify(provisioned.body)).toBe(201);
    tenant = provisioned.body as Tenant;
    owner = await signInAndSetPassword(testApp.app, ownerEmail, TEMPORARY);
    const [first] = (await owner.get('/api/v1/branches')).body as Branch[];
    if (!first) throw new Error('provisioning created no branch');
    branch = first;

    const services = await owner.put('/api/v1/catalog/services').send({
      items: [{ code: 'ZFILL', name: 'Test filling', chargeUnit: 'per_tooth', price: '50' }],
    });
    expect(services.status, JSON.stringify(services.body)).toBe(200);
    const filling = (services.body as ServiceItem[]).find((item) => item.code === 'ZFILL');
    const diagnoses = await owner
      .put('/api/v1/catalog/diagnoses')
      .send({ items: [{ code: 'ZCAR', name: 'Test caries' }] });
    expect(diagnoses.status, JSON.stringify(diagnoses.body)).toBe(200);
    const finding = (diagnoses.body as DiagnosisItem[]).find((item) => item.code === 'ZCAR');
    if (!filling || !finding) throw new Error('the catalog was not saved');
    fill = filling;
    caries = finding;

    dentist = await createStaff('dentist');
    otherDentist = await createStaff('dentist');
    assistant = await createStaff('assistant');
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  it('records a diagnosis and a plan without a visit, dated on the tenant-local day', async () => {
    const patient = await createPatient('No Visit');
    await charted(
      dentist.agent
        .post(record(patient, 'diagnoses'))
        .send({ diagnosisId: caries.id, toothCode: '16', surfaces: ['O'] }),
      201,
    );
    const chart = await charted(
      dentist.agent.post(record(patient, 'plans')).send({ procedureId: fill.id, toothCode: '16' }),
      201,
    );
    expect(chart.diagnoses).toMatchObject([
      {
        toothCode: '16',
        status: 'active',
        recordedInVisitId: null,
        recordedDate: TODAY,
        dentistId: dentist.user.profileId,
        recordedBy: dentist.user.id,
      },
    ]);
    const [diagnosis] = chart.diagnoses;
    expect(chart.plans).toMatchObject([
      {
        toothCode: '16',
        status: 'planned',
        recordedInVisitId: null,
        groupId: null,
        price: { amount: '50.00', currency: 'USD' },
        diagnosisRecordId: diagnosis?.id,
        dentistId: dentist.user.profileId,
      },
    ]);
    expect(chart.teeth).toMatchObject([{ code: '16', state: 'planned', hasActiveDiagnosis: true }]);

    const [plan] = chart.plans;
    const created = await auditOf(`resourceType=treatment_plan&resourceId=${plan?.id ?? ''}`);
    expect(created.map((entry) => entry.action)).toEqual(['treatment_plan.create']);
    await expect
      .poll(async () =>
        (await auditOf('resourceType=event'))
          .filter((entry) => (entry.after as { planId?: string }).planId === plan?.id)
          .map((entry) => [entry.action, (entry.after as { visitId: unknown }).visitId]),
      )
      .toEqual([['TreatmentPlanned', null]]);
  });

  it('resolves the dentist: the one named, else the caller when a dentist, else 422', async () => {
    const patient = await createPatient('Whose Record');
    const body = { procedureId: fill.id, toothCode: '26' };
    const named = await charted(
      owner
        .post(record(patient, 'plans'))
        .send({ ...body, dentistId: otherDentist.user.profileId }),
      201,
    );
    expect(named.plans[0]?.dentistId).toBe(otherDentist.user.profileId);
    // A platform admin acting in the clinic has no staff profile, so must name the dentist.
    await expectProblem(
      admin.post(record(patient, 'plans')).set('X-Tenant-Id', tenant.id).send(body),
      422,
      'record.dentist_required',
    );
    await expectProblem(
      owner.post(record(patient, 'plans')).send({ ...body, dentistId: assistant.user.profileId }),
      422,
      'visit.dentist_invalid',
    );
  });

  it('removes and cancels from the record only what the rules allow', async () => {
    const patient = await createPatient('Record Rules');
    const visit = await startVisit(patient);
    const inVisit = async <TResult>(rest: string, body: Record<string, unknown>) => {
      const response = await dentist.agent.post(`/api/v1/visits/${visit.id}/${rest}`).send(body);
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      return response.body as TResult;
    };
    const visitDiagnosis = await inVisit<DiagnosisResult>('diagnoses', {
      diagnosisId: caries.id,
      toothCode: '36',
    });
    const visitPlan = await inVisit<PlanResult>('plans', { procedureId: fill.id, toothCode: '36' });
    const before = await charted(
      dentist.agent
        .post(record(patient, 'diagnoses'))
        .send({ diagnosisId: caries.id, toothCode: '46' }),
      201,
    );
    const own = before.diagnoses.find((item) => item.toothCode === '46');
    const planned = await charted(
      dentist.agent.post(record(patient, 'plans')).send({ procedureId: fill.id, toothCode: '46' }),
      201,
    );
    const ownPlan = planned.plans.find((item) => item.toothCode === '46');
    if (!own || !ownPlan) throw new Error('the records were not made');
    expect(ownPlan.diagnosisRecordId).toBe(own.id);

    // Records made in a visit stay: the diagnosis is resolved in a visit, the plan cancelled.
    await expectProblem(
      dentist.agent.delete(record(patient, `diagnoses/${visitDiagnosis.record.id}`)),
      409,
      'record.not_removable',
    );
    await expectProblem(
      dentist.agent.delete(record(patient, `plans/${visitPlan.record.id}`)),
      409,
      'record.not_removable',
    );
    // There is no resolve, reopen or perform outside a visit.
    for (const route of [
      `diagnoses/${own.id}/resolve`,
      `diagnoses/${own.id}/reopen`,
      `plans/${ownPlan.id}/perform`,
    ]) {
      expect((await dentist.agent.post(record(patient, route))).status).toBe(404);
    }

    const cancelled = await charted(
      dentist.agent.post(record(patient, `plans/${visitPlan.record.id}/cancel`)),
    );
    expect(cancelled.plans.find((item) => item.id === visitPlan.record.id)).toMatchObject({
      status: 'cancelled',
      cancelledInVisitId: null,
    });
    await expectProblem(
      dentist.agent.post(record(patient, `plans/${visitPlan.record.id}/cancel`)),
      409,
      'plan.not_open',
    );

    // Removing the no-visit diagnosis unlinks the plan made for it; the plan is then removed.
    const unlinked = await charted(dentist.agent.delete(record(patient, `diagnoses/${own.id}`)));
    expect(unlinked.diagnoses.map((item) => item.id)).toEqual([visitDiagnosis.record.id]);
    expect(unlinked.plans.find((item) => item.id === ownPlan.id)?.diagnosisRecordId).toBeNull();
    const removed = await charted(dentist.agent.delete(record(patient, `plans/${ownPlan.id}`)));
    expect(removed.plans.map((item) => item.id)).toEqual([visitPlan.record.id]);
  });

  it('a visit resolves a no-visit diagnosis and performs or cancels a no-visit plan, never removes them', async () => {
    const patient = await createPatient('Later Visit');
    await charted(
      dentist.agent
        .post(record(patient, 'diagnoses'))
        .send({ diagnosisId: caries.id, toothCode: '11' }),
      201,
    );
    const chart = await charted(
      dentist.agent.post(record(patient, 'plans')).send({ procedureId: fill.id, toothCode: '11' }),
      201,
    );
    const [diagnosis] = chart.diagnoses;
    const [plan] = chart.plans;
    if (!diagnosis || !plan) throw new Error('the records were not made');
    const visit = await startVisit(patient);
    const path = (rest: string) => `/api/v1/visits/${visit.id}/${rest}`;

    await expectProblem(
      dentist.agent.delete(path(`diagnoses/${diagnosis.id}`)),
      409,
      'record.not_removable',
    );
    await expectProblem(
      dentist.agent.delete(path(`plans/${plan.id}`)),
      409,
      'record.not_removable',
    );
    const resolved = await dentist.agent.post(path(`diagnoses/${diagnosis.id}/resolve`));
    expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
    expect((resolved.body as DiagnosisResult).record).toMatchObject({
      status: 'resolved',
      resolvedInVisitId: visit.id,
      recordedInVisitId: null,
      recordedDate: TODAY,
    });
    // Once a visit has resolved it, the diagnosis is part of that visit's record.
    await expectProblem(
      dentist.agent.delete(record(patient, `diagnoses/${diagnosis.id}`)),
      409,
      'record.not_removable',
    );
    const performed = await dentist.agent.post(path(`plans/${plan.id}/perform`));
    expect(performed.status, JSON.stringify(performed.body)).toBe(200);
    expect((performed.body as PlanResult).visit.services).toMatchObject([{ planId: plan.id }]);
  });

  it('groups plans under named plans; deleting one ungroups its plans', async () => {
    const patient = await createPatient('Named Plans');
    const withGroup = await charted(
      dentist.agent
        .post(record(patient, 'plan-groups'))
        .send({ title: '  Full rehabilitation  ', note: '' }),
      201,
    );
    expect(withGroup.planGroups).toMatchObject([{ title: 'Full rehabilitation', note: null }]);
    const [group] = withGroup.planGroups;
    if (!group) throw new Error('no named plan');

    const inGroup = await charted(
      dentist.agent
        .post(record(patient, 'plans'))
        .send({ procedureId: fill.id, toothCode: '16', groupId: group.id }),
      201,
    );
    const loose = await charted(
      dentist.agent.post(record(patient, 'plans')).send({ procedureId: fill.id, toothCode: '17' }),
      201,
    );
    const [first] = inGroup.plans;
    const second = loose.plans.find((item) => item.toothCode === '17');
    if (!first || !second) throw new Error('the plans were not made');
    expect(first.groupId).toBe(group.id);

    const moved = await charted(
      dentist.agent.patch(record(patient, `plans/${second.id}`)).send({ groupId: group.id }),
    );
    expect(moved.plans.map((item) => item.groupId)).toEqual([group.id, group.id]);
    const renamed = await charted(
      dentist.agent
        .patch(record(patient, `plan-groups/${group.id}`))
        .send({ title: 'Phase 1', note: 'Upper right first' }),
    );
    expect(renamed.planGroups).toMatchObject([{ title: 'Phase 1', note: 'Upper right first' }]);

    // Another patient's named plan reads as not found, here and in a visit.
    const stranger = await createPatient('Named Stranger');
    await expectProblem(
      dentist.agent
        .post(record(stranger, 'plans'))
        .send({ procedureId: fill.id, toothCode: '16', groupId: group.id }),
      404,
      'record.not_found',
    );
    const visit = await startVisit(patient);
    const planned = await dentist.agent
      .post(`/api/v1/visits/${visit.id}/plans`)
      .send({ procedureId: fill.id, toothCode: '18', groupId: group.id });
    expect(planned.status, JSON.stringify(planned.body)).toBe(201);
    expect((planned.body as PlanResult).record.groupId).toBe(group.id);

    const deleted = await charted(dentist.agent.delete(record(patient, `plan-groups/${group.id}`)));
    expect(deleted.planGroups).toEqual([]);
    expect(deleted.plans.map((item) => item.groupId)).toEqual([null, null, null]);
    const audit = await auditOf(`resourceType=plan_group&resourceId=${group.id}`);
    expect(audit.map((entry) => entry.action).sort()).toEqual([
      'plan_group.create',
      'plan_group.delete',
      'plan_group.update',
    ]);
  });

  it('refuses without chart:write, and an archived, merged or unknown patient', async () => {
    const patient = await createPatient('Refused');
    const body = { procedureId: fill.id, toothCode: '16' };
    const forbidden = await assistant.agent.post(record(patient, 'plans')).send(body);
    expect(forbidden.status).toBe(403);

    const unknown = { id: newId() } as Patient;
    await expectProblem(
      dentist.agent.post(record(unknown, 'plans')).send(body),
      404,
      'patient.not_found',
    );

    const kept = await createPatient('Refused Kept');
    const merged = await owner
      .post('/api/v1/patients/merge')
      .send({ keepId: kept.id, dropId: patient.id, reason: 'Duplicate record' });
    expect(merged.status, JSON.stringify(merged.body)).toBe(200);
    await expectProblem(
      dentist.agent.post(record(patient, 'plans')).send(body),
      409,
      'patient.merged',
    );

    const archive = await owner.post('/api/v1/patients/archive').send({ ids: [kept.id] });
    expect(archive.status, JSON.stringify(archive.body)).toBe(200);
    await expectProblem(
      dentist.agent.post(record(kept, 'plans')).send(body),
      409,
      'patient.archived',
    );
  });

  it('the dentist role of a tenant holds chart:write', async () => {
    const granted = await database.ownerPool.query<{ key: string }>(
      `select r.key from role_permissions p join roles r on r.id = p.role_id
        where p.tenant_id = $1 and p.permission = 'chart:write' order by r.key`,
      [tenant.id],
    );
    expect(granted.rows.map((row) => row.key)).toEqual(['dentist', 'owner']);
  });
});
