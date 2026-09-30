import type {
  AuditEntry,
  AuditPage,
  Branch,
  DiagnosisItem,
  DiagnosisResult,
  Patient,
  PlanResult,
  ProblemDetails,
  ServiceItem,
  ServiceResult,
  Session,
  StaffUser,
  StartVisitResult,
  Tenant,
  ToothPresenceResult,
  Visit,
  VisitResult,
} from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../src/platform/kernel/id';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { createPlatformAdmin, signIn, signInAndSetPassword, uniqueEmail } from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';

const TEMPORARY = 'temporary-pw-1';

/** Beirut is UTC+3 in June: the tenant's today is 2026-06-10 all day at this instant. */
const NOON = '2026-06-10T09:00:00Z';
const TODAY = '2026-06-10';
/** The date of the completed visit the fixtures put older records in. */
const EARLIER = '2026-06-01';

interface Staff {
  agent: TestAgent;
  user: StaffUser;
}

const problem = (body: unknown) => body as ProblemDetails;

describe('clinical: records in a live visit (services, diagnoses, plans, tooth presence)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let admin: TestAgent;
  let tenant: Tenant;
  let owner: TestAgent;
  let branch: Branch;
  let dentist: Staff;
  let assistant: Staff;
  let frontdesk: Staff;
  let service: Record<'fill' | 'crown' | 'clean' | 'retired' | 'foreign', ServiceItem>;
  let diagnosis: Record<'caries' | 'fracture' | 'retired', DiagnosisItem>;

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
    const response = await owner.post('/api/v1/patients').send({ fullName, phone: '71 000 000' });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as Patient;
  };

  /** A live visit of `patient` with the dentist as its dentist, started by the dentist. */
  const startVisit = async (patient: Patient): Promise<Visit> => {
    const response = await dentist.agent
      .post('/api/v1/visits')
      .send({ patientId: patient.id, dentistId: dentist.user.profileId });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return (response.body as StartVisitResult).visit;
  };

  /**
   * A completed visit of `patient` on `EARLIER`, written directly: `complete` arrives with step 5,
   * and records "from an earlier visit" need one to point at.
   */
  const pastVisit = async (patient: Patient): Promise<string> => {
    const id = newId();
    await database.ownerPool.query(
      `insert into visits (id, tenant_id, patient_id, branch_id, dentist_id, started_by, status,
                           local_date, started_at, completed_at, completed_by, duration_minutes,
                           currency, subtotal, discount_amount, total)
       values ($1, $2, $3, $4, $5, $6, 'completed', $7, $8, $9, $6, 30, 'USD', 0, 0, 0)`,
      [
        id,
        tenant.id,
        patient.id,
        branch.id,
        dentist.user.profileId,
        dentist.user.id,
        EARLIER,
        `${EARLIER}T09:00:00Z`,
        `${EARLIER}T09:30:00Z`,
      ],
    );
    return id;
  };

  const olderDiagnosis = async (patient: Patient, visitId: string, toothCode: string) => {
    const id = newId();
    await database.ownerPool.query(
      `insert into patient_diagnoses (id, tenant_id, patient_id, tooth_code, diagnosis_id, code, name,
                                      dentist_id, recorded_by, recorded_in_visit_id, recorded_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        tenant.id,
        patient.id,
        toothCode,
        diagnosis.caries.id,
        diagnosis.caries.code,
        diagnosis.caries.name,
        dentist.user.profileId,
        dentist.user.id,
        visitId,
        `${EARLIER}T09:10:00Z`,
      ],
    );
    return id;
  };

  const olderPlan = async (patient: Patient, visitId: string, toothCode: string) => {
    const id = newId();
    await database.ownerPool.query(
      `insert into treatment_plans (id, tenant_id, patient_id, tooth_code, procedure_id, code, name,
                                    charge_unit, price_amount, price_currency, dentist_id,
                                    recorded_by, recorded_in_visit_id, recorded_at)
       values ($1, $2, $3, $4, $5, $6, $7, 'per_tooth', 80, 'USD', $8, $9, $10, $11)`,
      [
        id,
        tenant.id,
        patient.id,
        toothCode,
        service.crown.id,
        service.crown.code,
        service.crown.name,
        dentist.user.profileId,
        dentist.user.id,
        visitId,
        `${EARLIER}T09:20:00Z`,
      ],
    );
    return id;
  };

  const path = (visitId: string, rest: string) => `/api/v1/visits/${visitId}/${rest}`;

  const addService = (agent: TestAgent, visitId: string, body: Record<string, unknown>) =>
    agent.post(path(visitId, 'services')).send(body);

  const addedService = async (
    agent: TestAgent,
    visitId: string,
    body: Record<string, unknown>,
  ): Promise<ServiceResult> => {
    const response = await addService(agent, visitId, body);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as ServiceResult;
  };

  const recorded = async (
    agent: TestAgent,
    visitId: string,
    body: Record<string, unknown>,
  ): Promise<DiagnosisResult> => {
    const response = await agent.post(path(visitId, 'diagnoses')).send(body);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as DiagnosisResult;
  };

  const planned = async (
    agent: TestAgent,
    visitId: string,
    body: Record<string, unknown>,
  ): Promise<PlanResult> => {
    const response = await agent.post(path(visitId, 'plans')).send(body);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as PlanResult;
  };

  /** A POST action or DELETE that must answer 200 with the `{ visit, record }` envelope. */
  const ok = async <TResult>(request: Promise<{ status: number; body: unknown }>) => {
    const response = await request;
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body as TResult;
  };

  const expectProblem = async (
    request: Promise<{ status: number; body: unknown }>,
    status: number,
    code: string,
  ) => {
    const response = await request;
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    expect(problem(response.body).code).toBe(code);
    return problem(response.body);
  };

  const auditOf = async (query: string): Promise<AuditEntry[]> =>
    ((await owner.get(`/api/v1/audit?${query}&limit=100`)).body as AuditPage).items;

  const actionsOn = async (resourceType: string, resourceId: string) =>
    (await auditOf(`resourceType=${resourceType}&resourceId=${resourceId}`))
      .map((entry) => entry.action)
      .sort();

  /** Event names whose payload has `key` = `id`, once the after-commit audit has caught up. */
  const eventsFor = async (key: string, id: string, names: string[]) => {
    await expect
      .poll(async () =>
        (await auditOf('resourceType=event'))
          .filter((entry) => (entry.after as Record<string, unknown>)[key] === id)
          .map((entry) => entry.action)
          .filter((name) => names.includes(name))
          .sort(),
      )
      .toEqual([...names].sort());
  };

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    testApp.clock.set(new Date(NOON));
    admin = await signIn(testApp.app, await createPlatformAdmin(testApp.app), undefined, {
      rememberMe: true,
    });
    const ownerEmail = uniqueEmail('owner');
    const provisioned = await admin.post('/api/v1/platform/tenants').send({
      clinic: { name: 'Records Clinic', slug: `rec-${newId().slice(-12)}` },
      firstBranch: { name: 'Records Main' },
      owner: { displayName: 'Records Owner', email: ownerEmail, temporaryPassword: TEMPORARY },
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
        { code: 'ZCROWN', name: 'Test crown', chargeUnit: 'per_tooth', price: '120' },
        { code: 'ZCLEAN', name: 'Test cleaning', chargeUnit: 'per_jaw', price: '30' },
        { code: 'ZOLD', name: 'Retired', chargeUnit: 'per_tooth', price: '10', active: false },
        { code: 'ZEUR', name: 'Priced in euros', chargeUnit: 'per_jaw', price: '40' },
      ],
    });
    expect(services.status, JSON.stringify(services.body)).toBe(200);
    const byCode = (code: string) => {
      const found = (services.body as ServiceItem[]).find((item) => item.code === code);
      if (!found) throw new Error(`no service ${code}`);
      return found;
    };
    service = {
      fill: byCode('ZFILL'),
      crown: byCode('ZCROWN'),
      clean: byCode('ZCLEAN'),
      retired: byCode('ZOLD'),
      foreign: byCode('ZEUR'),
    };
    await database.ownerPool.query("update procedures set price_currency = 'EUR' where id = $1", [
      service.foreign.id,
    ]);

    const diagnoses = await owner.put('/api/v1/catalog/diagnoses').send({
      items: [
        { code: 'ZCAR', name: 'Test caries' },
        { code: 'ZFRAC', name: 'Test fracture' },
        { code: 'ZOLDX', name: 'Retired finding', active: false },
      ],
    });
    expect(diagnoses.status, JSON.stringify(diagnoses.body)).toBe(200);
    const diagnosisByCode = (code: string) => {
      const found = (diagnoses.body as DiagnosisItem[]).find((item) => item.code === code);
      if (!found) throw new Error(`no diagnosis ${code}`);
      return found;
    };
    diagnosis = {
      caries: diagnosisByCode('ZCAR'),
      fracture: diagnosisByCode('ZFRAC'),
      retired: diagnosisByCode('ZOLDX'),
    };

    dentist = await createStaff('dentist');
    assistant = await createStaff('assistant');
    frontdesk = await createStaff('frontdesk');
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  describe('services', () => {
    it('adds a per-tooth service with surfaces at the catalog price, recorded by the caller', async () => {
      const patient = await createPatient('Service Add');
      const visit = await startVisit(patient);
      const { visit: after, record } = await addedService(assistant.agent, visit.id, {
        procedureId: service.fill.id,
        toothCode: '16',
        surfaces: ['M', 'O'],
      });
      expect(record).toMatchObject({
        procedureId: service.fill.id,
        code: 'ZFILL',
        name: 'Test filling',
        chargeUnit: 'per_tooth',
        toothCode: '16',
        surfaces: ['M', 'O'],
        base: { amount: '50.00', currency: 'USD' },
        discount: { amount: '0.00', currency: 'USD' },
        final: { amount: '50.00', currency: 'USD' },
        planId: null,
        recordedBy: assistant.user.id,
      });
      expect(after.services.map((item) => item.id)).toEqual([record.id]);
      expect(after.money).toMatchObject({ subtotal: '50.00', total: '50.00' });

      const jaw = await addedService(dentist.agent, visit.id, { procedureId: service.clean.id });
      expect(jaw.record).toMatchObject({ toothCode: null, surfaces: [], chargeUnit: 'per_jaw' });
      expect(jaw.visit.money.subtotal).toBe('80.00');

      expect(await actionsOn('visit_service', record.id)).toEqual(['visit_service.create']);
    });

    it('refuses a missing or forbidden tooth, bad surfaces, an inactive item and another currency (422)', async () => {
      const patient = await createPatient('Service Rules');
      const visit = await startVisit(patient);
      await expectProblem(
        addService(dentist.agent, visit.id, { procedureId: service.fill.id }),
        422,
        'visit.tooth_required',
      );
      await expectProblem(
        addService(dentist.agent, visit.id, { procedureId: service.clean.id, toothCode: '16' }),
        422,
        'visit.tooth_not_allowed',
      );
      await expectProblem(
        addService(dentist.agent, visit.id, {
          procedureId: service.fill.id,
          toothCode: '16',
          surfaces: ['I'],
        }),
        422,
        'visit.surfaces_invalid',
      );
      await expectProblem(
        addService(dentist.agent, visit.id, { procedureId: service.retired.id, toothCode: '16' }),
        422,
        'catalog.inactive',
      );
      await expectProblem(
        addService(dentist.agent, visit.id, { procedureId: service.foreign.id }),
        422,
        'visit.currency_mismatch',
      );
      await expectProblem(
        addService(dentist.agent, visit.id, { procedureId: newId(), toothCode: '16' }),
        404,
        'catalog.not_found',
      );
      const read = (await dentist.agent.get(`/api/v1/visits/${visit.id}`)).body as Visit;
      expect(read.services).toEqual([]);
    });

    it('edits the price (last write wins) and refuses a discount above the base at its path', async () => {
      const patient = await createPatient('Service Price');
      const visit = await startVisit(patient);
      const { record } = await addedService(dentist.agent, visit.id, {
        procedureId: service.fill.id,
        toothCode: '21',
      });
      const url = path(visit.id, `services/${record.id}`);

      const edited = await ok<ServiceResult>(
        dentist.agent.patch(url).send({ baseAmount: '60', discountAmount: '10' }),
      );
      expect(edited.record).toMatchObject({
        base: { amount: '60.00' },
        discount: { amount: '10.00' },
        final: { amount: '50.00' },
      });
      expect(edited.visit.money.subtotal).toBe('50.00');

      const tooMuch = await expectProblem(
        dentist.agent.patch(url).send({ discountAmount: '70' }),
        422,
        'validation_failed',
      );
      expect(tooMuch.errors?.[0]?.path).toBe('discountAmount');
      const belowDiscount = await expectProblem(
        dentist.agent.patch(url).send({ baseAmount: '5' }),
        422,
        'validation_failed',
      );
      expect(belowDiscount.errors?.[0]?.path).toBe('baseAmount');

      const audit = await auditOf(`resourceType=visit_service&resourceId=${record.id}`);
      const update = audit.find((entry) => entry.action === 'visit_service.update');
      expect(update?.before).toEqual({ baseAmount: '50.00', discountAmount: '0.00' });
      expect(update?.after).toEqual({ baseAmount: '60.00', discountAmount: '10.00' });

      await expectProblem(
        dentist.agent.patch(path(visit.id, `services/${newId()}`)).send({ baseAmount: '1' }),
        404,
        'record.not_found',
      );
    });

    it('removes a service: it leaves the visit and its money, and is soft-deleted', async () => {
      const patient = await createPatient('Service Remove');
      const visit = await startVisit(patient);
      const { record } = await addedService(dentist.agent, visit.id, {
        procedureId: service.fill.id,
        toothCode: '11',
      });
      const removed = await ok<ServiceResult>(
        dentist.agent.delete(path(visit.id, `services/${record.id}`)),
      );
      expect(removed.record.id).toBe(record.id);
      expect(removed.visit.services).toEqual([]);
      expect(removed.visit.money).toMatchObject({ subtotal: '0.00', total: '0.00' });
      const row = await database.ownerPool.query<{ deleted_at: Date | null }>(
        'select deleted_at from visit_services where id = $1',
        [record.id],
      );
      expect(row.rows[0]?.deleted_at).not.toBeNull();
      expect(await actionsOn('visit_service', record.id)).toEqual([
        'visit_service.create',
        'visit_service.delete',
      ]);
      await expectProblem(
        dentist.agent.delete(path(visit.id, `services/${record.id}`)),
        404,
        'record.not_found',
      );
    });
  });

  describe('diagnoses', () => {
    it('records, resolves and reopens a diagnosis, with events', async () => {
      const patient = await createPatient('Diagnosis Flow');
      const visit = await startVisit(patient);
      const { record } = await recorded(assistant.agent, visit.id, {
        diagnosisId: diagnosis.caries.id,
        toothCode: '26',
        surfaces: ['O'],
        note: 'Deep',
      });
      expect(record).toMatchObject({
        patientId: patient.id,
        toothCode: '26',
        surfaces: ['O'],
        diagnosisId: diagnosis.caries.id,
        code: 'ZCAR',
        name: 'Test caries',
        status: 'active',
        note: 'Deep',
        dentistId: dentist.user.profileId,
        dentistName: dentist.user.displayName,
        recordedBy: assistant.user.id,
        recordedInVisitId: visit.id,
        recordedInVisitDate: TODAY,
        recordedAt: new Date(NOON).toISOString(),
        resolvedInVisitId: null,
        resolvedAt: null,
      });

      const resolved = await ok<DiagnosisResult>(
        dentist.agent.post(path(visit.id, `diagnoses/${record.id}/resolve`)),
      );
      expect(resolved.record).toMatchObject({
        status: 'resolved',
        resolvedInVisitId: visit.id,
        resolvedAt: new Date(NOON).toISOString(),
      });
      const reopened = await ok<DiagnosisResult>(
        dentist.agent.post(path(visit.id, `diagnoses/${record.id}/reopen`)),
      );
      expect(reopened.record).toMatchObject({
        status: 'active',
        resolvedInVisitId: null,
        resolvedAt: null,
      });
      expect(reopened.visit.id).toBe(visit.id);

      const row = await database.ownerPool.query<{ recorded_by: string; dentist_id: string }>(
        'select recorded_by, dentist_id from patient_diagnoses where id = $1',
        [record.id],
      );
      expect(row.rows[0]).toEqual({
        recorded_by: assistant.user.id,
        dentist_id: dentist.user.profileId,
      });
      expect(await actionsOn('diagnosis_record', record.id)).toEqual([
        'diagnosis_record.create',
        'diagnosis_record.reopen',
        'diagnosis_record.resolve',
      ]);
      await eventsFor('recordId', record.id, [
        'DiagnosisRecorded',
        'DiagnosisResolved',
        'DiagnosisReopened',
      ]);
    });

    it('refuses an inactive diagnosis and bad surfaces (422)', async () => {
      const patient = await createPatient('Diagnosis Rules');
      const visit = await startVisit(patient);
      await expectProblem(
        dentist.agent
          .post(path(visit.id, 'diagnoses'))
          .send({ diagnosisId: diagnosis.retired.id, toothCode: '26' }),
        422,
        'catalog.inactive',
      );
      await expectProblem(
        dentist.agent
          .post(path(visit.id, 'diagnoses'))
          .send({ diagnosisId: diagnosis.caries.id, toothCode: '11', surfaces: ['O'] }),
        422,
        'visit.surfaces_invalid',
      );
    });

    it("resolves an older diagnosis but removes only this visit's own (409 record.not_removable)", async () => {
      const patient = await createPatient('Diagnosis Older');
      const earlier = await pastVisit(patient);
      const older = await olderDiagnosis(patient, earlier, '36');
      const visit = await startVisit(patient);

      await expectProblem(
        dentist.agent.delete(path(visit.id, `diagnoses/${older}`)),
        409,
        'record.not_removable',
      );
      const resolved = await ok<DiagnosisResult>(
        dentist.agent.post(path(visit.id, `diagnoses/${older}/resolve`)),
      );
      expect(resolved.record).toMatchObject({
        id: older,
        status: 'resolved',
        recordedInVisitId: earlier,
        recordedInVisitDate: EARLIER,
        resolvedInVisitId: visit.id,
      });
    });

    it('removes a diagnosis recorded in this visit and unlinks the plan made for it', async () => {
      const patient = await createPatient('Diagnosis Remove');
      const visit = await startVisit(patient);
      const { record } = await recorded(dentist.agent, visit.id, {
        diagnosisId: diagnosis.caries.id,
        toothCode: '37',
      });
      const plan = await planned(dentist.agent, visit.id, {
        procedureId: service.fill.id,
        toothCode: '37',
      });
      expect(plan.record.diagnosisRecordId).toBe(record.id);

      const removed = await ok<DiagnosisResult>(
        dentist.agent.delete(path(visit.id, `diagnoses/${record.id}`)),
      );
      expect(removed.record.id).toBe(record.id);
      const rows = await database.ownerPool.query<{ deleted_at: Date | null; link: string | null }>(
        `select d.deleted_at, p.diagnosis_record_id as link
         from patient_diagnoses d, treatment_plans p where d.id = $1 and p.id = $2`,
        [record.id, plan.record.id],
      );
      expect(rows.rows[0]?.deleted_at).not.toBeNull();
      expect(rows.rows[0]?.link).toBeNull();
      expect(await actionsOn('diagnosis_record', record.id)).toContain('diagnosis_record.delete');
      await expectProblem(
        dentist.agent.post(path(visit.id, `diagnoses/${record.id}/resolve`)),
        404,
        'record.not_found',
      );
    });

    it("never reaches another patient's record through a visit (404 record.not_found)", async () => {
      const mine = await createPatient('Diagnosis Mine');
      const theirs = await createPatient('Diagnosis Theirs');
      const theirVisit = await startVisit(theirs);
      const { record } = await recorded(dentist.agent, theirVisit.id, {
        diagnosisId: diagnosis.caries.id,
        toothCode: '46',
      });
      const myVisit = await startVisit(mine);
      await expectProblem(
        dentist.agent.post(path(myVisit.id, `diagnoses/${record.id}/resolve`)),
        404,
        'record.not_found',
      );
    });
  });

  describe('plans', () => {
    it("links the tooth's most recent active diagnosis", async () => {
      const patient = await createPatient('Plan Link');
      const visit = await startVisit(patient);
      const first = await recorded(dentist.agent, visit.id, {
        diagnosisId: diagnosis.caries.id,
        toothCode: '46',
      });
      testApp.clock.advance({ seconds: 5 });
      const second = await recorded(dentist.agent, visit.id, {
        diagnosisId: diagnosis.fracture.id,
        toothCode: '46',
      });
      testApp.clock.advance({ seconds: 5 });
      await recorded(dentist.agent, visit.id, {
        diagnosisId: diagnosis.fracture.id,
        toothCode: '47',
      });

      const linked = await planned(assistant.agent, visit.id, {
        procedureId: service.crown.id,
        toothCode: '46',
        surfaces: ['O'],
        note: 'After the filling',
      });
      expect(linked.record).toMatchObject({
        patientId: patient.id,
        toothCode: '46',
        surfaces: ['O'],
        procedureId: service.crown.id,
        code: 'ZCROWN',
        chargeUnit: 'per_tooth',
        price: { amount: '120.00', currency: 'USD' },
        diagnosisRecordId: second.record.id,
        status: 'planned',
        note: 'After the filling',
        dentistId: dentist.user.profileId,
        dentistName: dentist.user.displayName,
        recordedBy: assistant.user.id,
        recordedInVisitId: visit.id,
        performedInVisitId: null,
        cancelledInVisitId: null,
      });
      expect(linked.visit.services).toEqual([]);

      await ok(dentist.agent.post(path(visit.id, `diagnoses/${second.record.id}/resolve`)));
      const relinked = await planned(dentist.agent, visit.id, {
        procedureId: service.fill.id,
        toothCode: '46',
      });
      expect(relinked.record.diagnosisRecordId).toBe(first.record.id);

      const jaw = await planned(dentist.agent, visit.id, { procedureId: service.clean.id });
      expect(jaw.record).toMatchObject({ toothCode: null, diagnosisRecordId: null });
      await expectProblem(
        dentist.agent
          .post(path(visit.id, 'plans'))
          .send({ procedureId: service.clean.id, toothCode: '46' }),
        422,
        'visit.tooth_not_allowed',
      );
      await expectProblem(
        dentist.agent
          .post(path(visit.id, 'plans'))
          .send({ procedureId: service.retired.id, toothCode: '46' }),
        422,
        'catalog.inactive',
      );

      expect(await actionsOn('treatment_plan', linked.record.id)).toEqual([
        'treatment_plan.create',
      ]);
      await eventsFor('planId', linked.record.id, ['TreatmentPlanned']);
      testApp.clock.set(new Date(NOON));
    });

    it('performs a plan into a service at its price; removing the service is the undo', async () => {
      const patient = await createPatient('Plan Perform');
      const visit = await startVisit(patient);
      const plan = await planned(dentist.agent, visit.id, {
        procedureId: service.crown.id,
        toothCode: '14',
        surfaces: ['M', 'O'],
      });
      await database.ownerPool.query('update procedures set price_amount = 999 where id = $1', [
        service.crown.id,
      ]);

      const performed = await ok<PlanResult>(
        dentist.agent.post(path(visit.id, `plans/${plan.record.id}/perform`)),
      );
      expect(performed.record).toMatchObject({
        id: plan.record.id,
        status: 'performed',
        performedInVisitId: visit.id,
        performedAt: new Date(NOON).toISOString(),
      });
      const [created] = performed.visit.services;
      expect(created).toMatchObject({
        planId: plan.record.id,
        procedureId: service.crown.id,
        toothCode: '14',
        surfaces: ['M', 'O'],
        base: { amount: '120.00' },
        discount: { amount: '0.00' },
      });
      expect(performed.visit.money.subtotal).toBe('120.00');

      await expectProblem(
        dentist.agent.post(path(visit.id, `plans/${plan.record.id}/perform`)),
        409,
        'plan.not_open',
      );
      await expectProblem(
        dentist.agent.delete(path(visit.id, `plans/${plan.record.id}`)),
        409,
        'plan.not_open',
      );

      if (!created) throw new Error('perform created no service');
      const undone = await ok<ServiceResult>(
        dentist.agent.delete(path(visit.id, `services/${created.id}`)),
      );
      expect(undone.visit.services).toEqual([]);
      const row = await database.ownerPool.query<{
        status: string;
        performed_in_visit_id: string | null;
        performed_at: Date | null;
      }>('select status, performed_in_visit_id, performed_at from treatment_plans where id = $1', [
        plan.record.id,
      ]);
      expect(row.rows[0]).toEqual({
        status: 'planned',
        performed_in_visit_id: null,
        performed_at: null,
      });

      const again = await ok<PlanResult>(
        dentist.agent.post(path(visit.id, `plans/${plan.record.id}/perform`)),
      );
      expect(again.visit.services).toHaveLength(1);

      expect(await actionsOn('treatment_plan', plan.record.id)).toEqual([
        'treatment_plan.create',
        'treatment_plan.perform',
        'treatment_plan.perform',
        'treatment_plan.unperform',
      ]);
      await eventsFor('planId', plan.record.id, [
        'TreatmentPlanned',
        'TreatmentPerformed',
        'TreatmentPerformed',
      ]);
      await database.ownerPool.query('update procedures set price_amount = 120 where id = $1', [
        service.crown.id,
      ]);
    });

    it('cancels an older plan; removes only a plan made in this visit', async () => {
      const patient = await createPatient('Plan Cancel');
      const earlier = await pastVisit(patient);
      const older = await olderPlan(patient, earlier, '15');
      const visit = await startVisit(patient);
      const fresh = await planned(dentist.agent, visit.id, {
        procedureId: service.fill.id,
        toothCode: '15',
      });

      await expectProblem(
        dentist.agent.delete(path(visit.id, `plans/${older}`)),
        409,
        'record.not_removable',
      );
      await expectProblem(
        dentist.agent.post(path(visit.id, `plans/${fresh.record.id}/cancel`)),
        409,
        'plan.not_cancellable',
      );

      const cancelled = await ok<PlanResult>(
        dentist.agent.post(path(visit.id, `plans/${older}/cancel`)),
      );
      expect(cancelled.record).toMatchObject({
        id: older,
        status: 'cancelled',
        cancelledInVisitId: visit.id,
        cancelledAt: new Date(NOON).toISOString(),
        recordedInVisitId: earlier,
      });
      await expectProblem(
        dentist.agent.post(path(visit.id, `plans/${older}/cancel`)),
        409,
        'plan.not_open',
      );
      await expectProblem(
        dentist.agent.post(path(visit.id, `plans/${older}/perform`)),
        409,
        'plan.not_open',
      );

      const removed = await ok<PlanResult>(
        dentist.agent.delete(path(visit.id, `plans/${fresh.record.id}`)),
      );
      expect(removed.record.id).toBe(fresh.record.id);
      const row = await database.ownerPool.query<{ deleted_at: Date | null }>(
        'select deleted_at from treatment_plans where id = $1',
        [fresh.record.id],
      );
      expect(row.rows[0]?.deleted_at).not.toBeNull();
      expect(await actionsOn('treatment_plan', older)).toEqual(['treatment_plan.cancel']);
      expect(await actionsOn('treatment_plan', fresh.record.id)).toEqual([
        'treatment_plan.create',
        'treatment_plan.delete',
      ]);
      await eventsFor('planId', older, ['TreatmentCancelled']);
    });
  });

  describe('tooth presence', () => {
    it('upserts the tooth at a succession position, with an event', async () => {
      const patient = await createPatient('Tooth Presence');
      const visit = await startVisit(patient);
      const first = await ok<ToothPresenceResult>(
        dentist.agent.put(path(visit.id, 'teeth/14')).send({ present: 'primary' }),
      );
      expect(first.record).toEqual({ position: '14', present: 'primary' });
      const second = await ok<ToothPresenceResult>(
        dentist.agent.put(path(visit.id, 'teeth/14')).send({ present: 'permanent' }),
      );
      expect(second.record).toEqual({ position: '14', present: 'permanent' });

      const rows = await database.ownerPool.query<{
        id: string;
        present: string;
        changed_in_visit_id: string;
        changed_by: string;
      }>(
        'select id, present, changed_in_visit_id, changed_by from tooth_status where patient_id = $1',
        [patient.id],
      );
      expect(rows.rows).toHaveLength(1);
      const [row] = rows.rows;
      expect(row).toMatchObject({
        present: 'permanent',
        changed_in_visit_id: visit.id,
        changed_by: dentist.user.id,
      });
      if (!row) throw new Error('no tooth_status row');
      const audit = await auditOf(`resourceType=tooth_status&resourceId=${row.id}`);
      expect(audit.map((entry) => entry.after)).toEqual(
        expect.arrayContaining([
          { position: '14', present: 'primary' },
          { position: '14', present: 'permanent' },
        ]),
      );
      expect(audit.every((entry) => entry.action === 'tooth_status.set')).toBe(true);
      await eventsFor('visitId', visit.id, ['ToothStatusChanged', 'ToothStatusChanged']);
    });

    it('refuses a position that is not a permanent position 1–5 (400 validation_failed)', async () => {
      const patient = await createPatient('Tooth Invalid');
      const visit = await startVisit(patient);
      for (const position of ['16', '54', '19', 'x']) {
        const response = await dentist.agent
          .put(path(visit.id, `teeth/${position}`))
          .send({ present: 'primary' });
        expect(response.status, position).toBe(400);
        expect(problem(response.body).errors?.[0]?.path).toBe('position');
      }
    });
  });

  describe('access and lifecycle', () => {
    it('refuses front desk on every record route (403)', async () => {
      const patient = await createPatient('Records Front Desk');
      const visit = await startVisit(patient);
      const { record } = await addedService(dentist.agent, visit.id, {
        procedureId: service.fill.id,
        toothCode: '16',
      });
      const id = newId();
      const attempts = [
        frontdesk.agent.post(path(visit.id, 'services')).send({ procedureId: service.clean.id }),
        frontdesk.agent.patch(path(visit.id, `services/${record.id}`)).send({ baseAmount: '1' }),
        frontdesk.agent.delete(path(visit.id, `services/${record.id}`)),
        frontdesk.agent
          .post(path(visit.id, 'diagnoses'))
          .send({ diagnosisId: diagnosis.caries.id, toothCode: '16' }),
        frontdesk.agent.post(path(visit.id, `diagnoses/${id}/resolve`)),
        frontdesk.agent.post(path(visit.id, `diagnoses/${id}/reopen`)),
        frontdesk.agent.delete(path(visit.id, `diagnoses/${id}`)),
        frontdesk.agent.post(path(visit.id, 'plans')).send({ procedureId: service.clean.id }),
        frontdesk.agent.post(path(visit.id, `plans/${id}/perform`)),
        frontdesk.agent.post(path(visit.id, `plans/${id}/cancel`)),
        frontdesk.agent.delete(path(visit.id, `plans/${id}`)),
        frontdesk.agent.put(path(visit.id, 'teeth/14')).send({ present: 'primary' }),
      ];
      for (const response of await Promise.all(attempts)) {
        expect(response.status, JSON.stringify(response.body)).toBe(403);
      }
    });

    it('refuses changes to a discarded or completed visit (409 visit.not_live)', async () => {
      const patient = await createPatient('Records Not Live');
      const earlier = await pastVisit(patient);
      await expectProblem(
        addService(dentist.agent, earlier, { procedureId: service.clean.id }),
        409,
        'visit.not_live',
      );
      await expectProblem(
        dentist.agent.put(path(earlier, 'teeth/14')).send({ present: 'primary' }),
        409,
        'visit.not_live',
      );

      const visit = await startVisit(patient);
      const discarded = await dentist.agent.post(path(visit.id, 'discard'));
      expect((discarded.body as VisitResult).visit.status).toBe('discarded');
      await expectProblem(
        dentist.agent
          .post(path(visit.id, 'diagnoses'))
          .send({ diagnosisId: diagnosis.caries.id, toothCode: '16' }),
        409,
        'visit.not_live',
      );
      await expectProblem(
        dentist.agent.post(path(visit.id, 'plans')).send({ procedureId: service.clean.id }),
        409,
        'visit.not_live',
      );
    });

    it('records the auth user id of a platform admin, with the visit dentist as dentist', async () => {
      const patient = await createPatient('Records Admin');
      const visit = await startVisit(patient);
      const adminId = ((await admin.get('/api/v1/session')).body as Session).user.id;
      const response = await admin
        .post(path(visit.id, 'diagnoses'))
        .set('X-Tenant-Id', tenant.id)
        .send({ diagnosisId: diagnosis.caries.id, toothCode: '16' });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      expect((response.body as DiagnosisResult).record).toMatchObject({
        recordedBy: adminId,
        dentistId: dentist.user.profileId,
      });
    });
  });
});
