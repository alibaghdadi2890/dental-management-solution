import type {
  AuditEntry,
  AuditPage,
  Branch,
  ClinicalSummary,
  DiagnosisItem,
  Patient,
  PatientChart,
  PatientPresenceResult,
  PlanResult,
  PresenceResult,
  ProblemDetails,
  ServiceItem,
  ServiceResult,
  StaffUser,
  StartVisitResult,
  Tenant,
  ToothHistory,
  Visit,
  VisitResult,
} from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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

const problem = (body: unknown) => body as ProblemDetails;

/**
 * Feature 7, H1–H3: what is at a tooth position — set in a visit, on the patient record, or by
 * a service whose catalog entry says it takes the tooth out or puts an implant there — with a
 * history, and restored when the cause goes away. The catalog is the default template: `EXT`
 * removes the tooth, `IMP` places an implant.
 */
describe('clinical: tooth presence (missing, not erupted, implant)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let admin: TestAgent;
  let tenant: Tenant;
  let owner: TestAgent;
  let branch: Branch;
  let dentist: Staff;
  let assistant: Staff;
  let service: Record<'extraction' | 'implant' | 'crown' | 'composite', ServiceItem>;
  let caries: DiagnosisItem;

  const createStaff = async (role: 'dentist' | 'assistant'): Promise<Staff> => {
    const email = uniqueEmail(role);
    const response = await owner.post('/api/v1/users').send({
      displayName: `Dr. ${role} ${newId().slice(-6)}`,
      email,
      practitionerType: role,
      roleKeys: [role],
      branchIds: [branch.id],
      temporaryPassword: TEMPORARY,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return {
      agent: await signInAndSetPassword(testApp.app, email, TEMPORARY),
      user: response.body as StaffUser,
    };
  };

  const createPatient = async (fullName: string, dateOfBirth = '1990-01-01'): Promise<Patient> => {
    const response = await owner
      .post('/api/v1/patients')
      .set('Idempotency-Key', newId())
      .send({ fullName, phone: '71 000 000', dateOfBirth });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as Patient;
  };

  const startVisit = async (patient: Patient): Promise<Visit> => {
    const response = await dentist.agent
      .post('/api/v1/visits')
      .send({ patientId: patient.id, dentistId: dentist.user.profileId });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return (response.body as StartVisitResult).visit;
  };

  const visitPath = (visitId: string, rest: string) => `/api/v1/visits/${visitId}/${rest}`;
  const recordPath = (patient: Patient, rest: string) =>
    `/api/v1/clinical/patients/${patient.id}/${rest}`;

  const ok = async <TResult>(
    request: Promise<{ status: number; body: unknown }>,
    status = 200,
  ): Promise<TResult> => {
    const response = await request;
    expect(response.status, JSON.stringify(response.body)).toBe(status);
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

  const add = (visit: Visit, item: ServiceItem, toothCode: string) =>
    ok<ServiceResult>(
      dentist.agent.post(visitPath(visit.id, 'services')).send({ procedureId: item.id, toothCode }),
      201,
    );

  /** Completes after five minutes in the chair; the clock then returns to `NOON`, so sessions
   * that sit out a long suite never idle (going back in time idles nothing). */
  const complete = async (visit: Visit): Promise<Visit> => {
    testApp.clock.advance({ minutes: 5 });
    const done = await ok<VisitResult>(dentist.agent.post(visitPath(visit.id, 'complete')));
    testApp.clock.set(new Date(NOON));
    return done.visit;
  };

  const setInVisit = (agent: TestAgent, visit: Visit, toothCode: string, presence: string) =>
    agent.put(visitPath(visit.id, `teeth/${toothCode}/presence`)).send({ presence });

  const setOnRecord = (agent: TestAgent, patient: Patient, body: Record<string, unknown>) =>
    agent.post(recordPath(patient, 'presence')).send(body);

  const chartOf = (patient: Patient) =>
    ok<PatientChart>(dentist.agent.get(recordPath(patient, 'chart')));

  /** What is at each tooth that isn't simply present, from the chart's derived teeth. */
  const presenceOf = async (patient: Patient): Promise<Record<string, string>> =>
    Object.fromEntries(
      (await chartOf(patient)).teeth
        .filter((tooth) => tooth.presence !== 'present')
        .map((tooth) => [tooth.code, tooth.presence]),
    );

  /** The tooth's history as `[presence, occurredOn, service code]`, in the order recorded. */
  const historyOf = async (patient: Patient, toothCode: string) =>
    (
      await ok<ToothHistory>(dentist.agent.get(recordPath(patient, `teeth/${toothCode}/history`)))
    ).presence.map((row) => [row.presence, row.occurredOn, row.serviceCode]);

  const auditOf = async (query: string): Promise<AuditEntry[]> =>
    ((await owner.get(`/api/v1/audit?${query}&limit=100`)).body as AuditPage).items;

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    testApp.clock.set(new Date(NOON));
    admin = await signIn(testApp.app, await createPlatformAdmin(testApp.app), undefined, {
      rememberMe: true,
    });
    const ownerEmail = uniqueEmail('owner');
    const provisioned = await admin.post('/api/v1/platform/tenants').send({
      clinic: { name: 'Presence Clinic', slug: `prs-${newId().slice(-12)}` },
      firstBranch: { name: 'Presence Main' },
      owner: { displayName: 'Presence Owner', email: ownerEmail, temporaryPassword: TEMPORARY },
    });
    expect(provisioned.status, JSON.stringify(provisioned.body)).toBe(201);
    tenant = provisioned.body as Tenant;
    owner = await signInAndSetPassword(testApp.app, ownerEmail, TEMPORARY);
    const [first] = (await owner.get('/api/v1/branches')).body as Branch[];
    if (!first) throw new Error('provisioning created no branch');
    branch = first;

    // The default template is seeded after the provisioning commits.
    let services: ServiceItem[] = [];
    await vi.waitFor(
      async () => {
        services = (await owner.get('/api/v1/catalog/services')).body as ServiceItem[];
        expect(services.length).toBeGreaterThan(0);
      },
      { timeout: 10_000, interval: 100 },
    );
    const byCode = (code: string) => {
      const found = services.find((item) => item.code === code);
      if (!found) throw new Error(`no service ${code}`);
      return found;
    };
    service = {
      extraction: byCode('EXT'),
      implant: byCode('IMP'),
      crown: byCode('ZIR'),
      composite: byCode('CMP'),
    };
    const diagnoses = (await owner.get('/api/v1/catalog/diagnoses')).body as DiagnosisItem[];
    const found = diagnoses.find((item) => item.code === 'DX-CAR');
    if (!found) throw new Error('no diagnosis DX-CAR');
    caries = found;
    dentist = await createStaff('dentist');
    assistant = await createStaff('assistant');
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  describe('the catalog', () => {
    it('seeds extraction as removing the tooth and implant placement as placing an implant', () => {
      expect(service.extraction.toothEffect).toBe('removes');
      expect(service.implant).toMatchObject({ toothEffect: 'implant', chargeUnit: 'per_tooth' });
      expect(service.crown.toothEffect).toBe('none');
    });

    it('lets the owner change an effect, and refuses one on a service that is not per tooth', async () => {
      const row = (item: ServiceItem, patch: Record<string, unknown>) => ({
        id: item.id,
        code: item.code,
        name: item.name,
        category: item.category,
        chargeUnit: item.chargeUnit,
        price: item.price.amount,
        frequent: item.frequent,
        active: item.active,
        toothEffect: item.toothEffect,
        ...patch,
      });
      const saved = await ok<ServiceItem[]>(
        owner.put('/api/v1/catalog/services').send({
          items: [row(service.composite, { toothEffect: 'removes' })],
        }),
      );
      expect(saved.find((item) => item.id === service.composite.id)?.toothEffect).toBe('removes');
      const [audit] = await auditOf(`resourceType=procedure&resourceId=${service.composite.id}`);
      expect(audit).toMatchObject({
        action: 'catalog.service.update',
        before: { toothEffect: 'none' },
        after: { toothEffect: 'removes' },
      });
      await ok(
        owner.put('/api/v1/catalog/services').send({
          items: [row(service.composite, { toothEffect: 'none' })],
        }),
      );

      const refused = await owner.put('/api/v1/catalog/services').send({
        items: [row(service.composite, { chargeUnit: 'per_jaw', toothEffect: 'implant' })],
      });
      expect(refused.status).toBe(400);
      expect(problem(refused.body).errors?.[0]?.path).toBe('items.0.toothEffect');
    });
  });

  describe('set by hand in a visit', () => {
    it("marks a child's permanent tooth missing, dated by the visit, with a history and an Undo", async () => {
      const child = await createPatient('Presence Child', '2018-01-15');
      const visit = await startVisit(child);
      const set = await ok<PresenceResult>(setInVisit(dentist.agent, visit, '36', 'missing'));
      expect(set.record).toMatchObject({
        toothCode: '36',
        presence: 'missing',
        occurredOn: TODAY,
        reason: null,
        dentistId: dentist.user.profileId,
        dentistName: dentist.user.displayName,
        visitId: visit.id,
        visitNumber: visit.displayNumber,
        serviceId: null,
      });
      expect(await presenceOf(child)).toEqual({ '36': 'missing' });
      expect(await historyOf(child, '36')).toEqual([['missing', TODAY, null]]);

      // The same value again writes nothing.
      const again = await ok<PresenceResult>(setInVisit(dentist.agent, visit, '36', 'missing'));
      expect(again.record).toBeNull();
      expect((await chartOf(child)).presence).toHaveLength(1);

      const undone = await ok<PresenceResult>(
        dentist.agent.delete(visitPath(visit.id, `presence/${String(set.record?.id)}`)),
      );
      expect(undone.record?.id).toBe(set.record?.id);
      expect(await presenceOf(child)).toEqual({});
      expect(await historyOf(child, '36')).toEqual([]);

      const actions = (
        await auditOf(`resourceType=tooth_presence&resourceId=${String(set.record?.id)}`)
      )
        .map((entry) => entry.action)
        .sort();
      expect(actions).toEqual(['tooth_presence.remove', 'tooth_presence.set']);
    });

    it('keeps every state workable: a diagnosis and a crown on an implant, then missing again', async () => {
      const patient = await createPatient('Presence Workable');
      const visit = await startVisit(patient);
      await ok(setInVisit(dentist.agent, visit, '46', 'implant'));
      await ok(
        dentist.agent
          .post(visitPath(visit.id, 'diagnoses'))
          .send({ diagnosisId: caries.id, toothCode: '46' }),
        201,
      );
      await add(visit, service.crown, '46');
      await ok(setInVisit(dentist.agent, visit, '18', 'not_erupted'));
      const chart = await chartOf(patient);
      expect(chart.teeth.find((tooth) => tooth.code === '46')).toMatchObject({
        presence: 'implant',
        state: 'treated_today',
        hasActiveDiagnosis: true,
      });
      expect(await presenceOf(patient)).toEqual({ '46': 'implant', '18': 'not_erupted' });

      // A failed implant: the history keeps both.
      await ok(setInVisit(dentist.agent, visit, '46', 'missing'));
      expect(await presenceOf(patient)).toMatchObject({ '46': 'missing' });
      expect((await historyOf(patient, '46')).map(([presence]) => presence)).toEqual([
        'implant',
        'missing',
      ]);
      // A presence set in the visit is visit content: it can't be discarded.
      await expectProblem(
        dentist.agent.post(visitPath(visit.id, 'discard')),
        409,
        'visit.not_empty',
      );
    });

    it('only undoes a row set by hand in this very visit', async () => {
      const patient = await createPatient('Presence Undo Rules');
      const first = await startVisit(patient);
      const byHand = await ok<PresenceResult>(setInVisit(dentist.agent, first, '11', 'missing'));
      const extracted = await add(first, service.extraction, '21');
      const chart = await chartOf(patient);
      const byService = chart.presence.find((row) => row.serviceId === extracted.record.id);
      await expectProblem(
        dentist.agent.delete(visitPath(first.id, `presence/${String(byService?.id)}`)),
        409,
        'record.not_removable',
      );
      await complete(first);

      const second = await startVisit(patient);
      await expectProblem(
        dentist.agent.delete(visitPath(second.id, `presence/${String(byHand.record?.id)}`)),
        409,
        'record.not_removable',
      );
      await expectProblem(
        dentist.agent.delete(visitPath(second.id, `presence/${newId()}`)),
        404,
        'record.not_found',
      );
      const invalid = await setInVisit(dentist.agent, second, '99', 'missing');
      expect(invalid.status).toBe(400);
      expect((await setInVisit(dentist.agent, second, '11', 'gone')).status).toBe(400);
    });
  });

  describe('caused by a service (H2)', () => {
    it('marks the tooth missing when the extraction is recorded, and restores it when it is removed', async () => {
      const patient = await createPatient('Presence Extraction');
      const visit = await startVisit(patient);
      const added = await add(visit, service.extraction, '46');
      expect(added.presenceChange).toEqual({ toothCode: '46', presence: 'missing' });
      expect(await presenceOf(patient)).toEqual({ '46': 'missing' });
      const [row] = (await chartOf(patient)).presence;
      expect(row).toMatchObject({
        toothCode: '46',
        occurredOn: TODAY,
        visitId: visit.id,
        serviceId: added.record.id,
        serviceCode: 'EXT',
        serviceName: 'Extraction',
      });

      const removed = await ok<ServiceResult>(
        dentist.agent.delete(visitPath(visit.id, `services/${added.record.id}`)),
      );
      expect(removed.presenceChange).toEqual({ toothCode: '46', presence: 'present' });
      expect(await presenceOf(patient)).toEqual({});
      // A service that does nothing to the tooth says so.
      expect((await add(visit, service.crown, '46')).presenceChange ?? null).toBeNull();
    });

    it('restores the tooth when the visit is amended to remove the extraction, and when it is voided', async () => {
      const patient = await createPatient('Presence Corrections');
      const visit = await startVisit(patient);
      const extraction = await add(visit, service.extraction, '46');
      const filling = await add(visit, service.composite, '16');
      const completed = await complete(visit);
      expect(await presenceOf(patient)).toEqual({ '46': 'missing' });

      const amended = await ok<VisitResult>(
        dentist.agent.post(visitPath(visit.id, 'amend')).send({
          expectedUpdatedAt: completed.updatedAt,
          reason: 'Extraction was not done',
          discount: { mode: 'amount', value: '0' },
          services: [{ id: filling.record.id }],
        }),
      );
      expect(amended.visit.services.map((line) => line.id)).toEqual([filling.record.id]);
      expect(await presenceOf(patient)).toEqual({});
      expect(extraction.record.id).not.toBe(filling.record.id);

      const second = await startVisit(patient);
      await add(second, service.extraction, '47');
      const done = await complete(second);
      expect(await presenceOf(patient)).toEqual({ '47': 'missing' });
      await ok(
        dentist.agent
          .post(visitPath(second.id, 'void'))
          .send({ expectedUpdatedAt: done.updatedAt, reason: 'Wrong patient' }),
      );
      expect(await presenceOf(patient)).toEqual({});
      expect(await historyOf(patient, '47')).toEqual([]);
    });

    it('moves the effect with a service an amendment moves to another tooth', async () => {
      const patient = await createPatient('Presence Moved');
      const visit = await startVisit(patient);
      const extraction = await add(visit, service.extraction, '46');
      const completed = await complete(visit);
      await ok(
        dentist.agent.post(visitPath(visit.id, 'amend')).send({
          expectedUpdatedAt: completed.updatedAt,
          reason: 'Charted on the wrong tooth',
          discount: { mode: 'amount', value: '0' },
          services: [{ id: extraction.record.id, toothCode: '36', surfaces: [] }],
        }),
      );
      expect(await presenceOf(patient)).toEqual({ '36': 'missing' });
    });

    it('turns a missing tooth into an implant, leaves re-work alone, and keeps a later manual change', async () => {
      const patient = await createPatient('Presence Implant');
      const first = await startVisit(patient);
      await add(first, service.extraction, '46');
      await complete(first);

      const second = await startVisit(patient);
      const placed = await add(second, service.implant, '46');
      expect(placed.presenceChange).toEqual({ toothCode: '46', presence: 'implant' });
      // Re-work on a position that is already an implant, or an extraction on a gap, is allowed
      // and changes nothing.
      const again = await add(second, service.implant, '46');
      expect(again.presenceChange ?? null).toBeNull();
      await ok(setInVisit(dentist.agent, second, '26', 'missing'));
      expect((await add(second, service.extraction, '26')).presenceChange ?? null).toBeNull();
      expect(await presenceOf(patient)).toEqual({ '46': 'implant', '26': 'missing' });
      // Each service keeps its own row, so the tooth stays an implant whichever is removed first.
      expect(
        (await historyOf(patient, '46')).map(([presence, , code]) => [presence, code]),
      ).toEqual([
        ['missing', 'EXT'],
        ['implant', 'IMP'],
        ['implant', 'IMP'],
      ]);
      const removedFirst = await ok<ServiceResult>(
        dentist.agent.delete(visitPath(second.id, `services/${placed.record.id}`)),
      );
      expect(removedFirst.presenceChange ?? null).toBeNull();
      expect(await presenceOf(patient)).toEqual({ '46': 'implant', '26': 'missing' });

      // The dentist marks it missing by hand; removing the other implant service later does not
      // undo what they saw (D2).
      await ok(setInVisit(dentist.agent, second, '46', 'missing'));
      await ok(dentist.agent.delete(visitPath(second.id, `services/${again.record.id}`)));
      expect(await presenceOf(patient)).toMatchObject({ '46': 'missing' });
    });

    it('holds a tooth in its state while a service that says so stands, and moves that with it', async () => {
      // An extraction on a tooth marked missing by hand keeps it missing when the hand-set row
      // is undone, and an amendment moves its effect though it changed nothing at first.
      const patient = await createPatient('Presence Held');
      const visit = await startVisit(patient);
      const byHand = await ok<PresenceResult>(setInVisit(dentist.agent, visit, '16', 'missing'));
      const extraction = await add(visit, service.extraction, '16');
      expect(extraction.presenceChange ?? null).toBeNull();
      await ok(dentist.agent.delete(visitPath(visit.id, `presence/${String(byHand.record?.id)}`)));
      expect(await presenceOf(patient)).toEqual({ '16': 'missing' });
      const completed = await complete(visit);
      await ok(
        dentist.agent.post(visitPath(visit.id, 'amend')).send({
          expectedUpdatedAt: completed.updatedAt,
          reason: 'Charted on the wrong tooth',
          discount: { mode: 'amount', value: '0' },
          services: [{ id: extraction.record.id, toothCode: '17', surfaces: [] }],
        }),
      );
      expect(await presenceOf(patient)).toEqual({ '17': 'missing' });
    });

    it('applies the effect when a plan is performed, and takes it back when it is not finished', async () => {
      const patient = await createPatient('Presence Planned');
      const visit = await startVisit(patient);
      const plan = await ok<PlanResult>(
        dentist.agent
          .post(visitPath(visit.id, 'plans'))
          .send({ procedureId: service.extraction.id, toothCode: '38' }),
        201,
      );
      expect(await presenceOf(patient)).toEqual({});
      const performed = await ok<PlanResult>(
        dentist.agent.post(visitPath(visit.id, `plans/${plan.record.id}/perform`)),
      );
      expect(performed.presenceChange).toEqual({ toothCode: '38', presence: 'missing' });
      const [line] = performed.visit.services;
      await ok(dentist.agent.post(visitPath(visit.id, `services/${String(line?.id)}/unfinished`)));
      expect(await presenceOf(patient)).toEqual({});
    });
  });

  describe('set on the patient record (H3a)', () => {
    it('records a new patient’s gaps and implant in one batch, before first visit, with no date invented', async () => {
      const patient = await createPatient('Presence Intake');
      const result = await ok<PatientPresenceResult>(
        setOnRecord(dentist.agent, patient, {
          teeth: [
            { toothCode: '18', presence: 'missing' },
            { toothCode: '28', presence: 'missing' },
            { toothCode: '38', presence: 'missing' },
            { toothCode: '48', presence: 'missing' },
            { toothCode: '36', presence: 'implant' },
          ],
          when: { kind: 'before_first_visit' },
        }),
        201,
      );
      expect(result.presenceIds).toHaveLength(5);
      expect(result.chart.presence.every((row) => row.occurredOn === null)).toBe(true);
      expect(result.chart.presence.every((row) => row.visitId === null)).toBe(true);
      expect(result.chart.presence[0]).toMatchObject({
        dentistId: dentist.user.profileId,
        dentistName: dentist.user.displayName,
        reason: null,
      });
      expect(await presenceOf(patient)).toEqual({
        '18': 'missing',
        '28': 'missing',
        '38': 'missing',
        '48': 'missing',
        '36': 'implant',
      });
      const summary = await ok<ClinicalSummary>(dentist.agent.get(recordPath(patient, 'summary')));
      expect(summary).toMatchObject({ missingTeeth: 4, implants: 1 });

      // Undo takes the whole batch back.
      const undone = await ok<{ chart: PatientChart }>(
        dentist.agent.delete(recordPath(patient, `presence?ids=${result.presenceIds.join(',')}`)),
      );
      expect(undone.chart.presence).toEqual([]);
      expect(
        await ok<ClinicalSummary>(dentist.agent.get(recordPath(patient, 'summary'))),
      ).toMatchObject({ missingTeeth: 0, implants: 0 });
    });

    it('records a tooth lost in an accident with its date and reason; the next visit shows it', async () => {
      const patient = await createPatient('Presence Accident');
      const result = await ok<PatientPresenceResult>(
        setOnRecord(dentist.agent, patient, {
          teeth: [{ toothCode: '11', presence: 'missing' }],
          when: { kind: 'date', date: '2026-06-03' },
          reason: 'accident',
        }),
        201,
      );
      expect(result.chart.presence).toEqual([
        expect.objectContaining({
          toothCode: '11',
          presence: 'missing',
          occurredOn: '2026-06-03',
          reason: 'accident',
          visitId: null,
          visitNumber: null,
        }),
      ]);
      const visit = await startVisit(patient);
      expect((await chartOf(patient)).liveVisitId).toBe(visit.id);
      expect(await presenceOf(patient)).toEqual({ '11': 'missing' });
      // Inside the visit it is an older record: it can't be undone there.
      await expectProblem(
        dentist.agent.delete(visitPath(visit.id, `presence/${String(result.presenceIds[0])}`)),
        409,
        'record.not_removable',
      );
      const [audit] = await auditOf(
        `resourceType=tooth_presence&resourceId=${String(result.presenceIds[0])}`,
      );
      expect(audit).toMatchObject({
        action: 'tooth_presence.set',
        reason: 'accident',
        patientId: patient.id,
        visitId: null,
        area: 'visits',
      });
    });

    it('needs chart:write, a dentist, a date not after today, and each tooth once', async () => {
      const patient = await createPatient('Presence Rules');
      const body = {
        teeth: [{ toothCode: '11', presence: 'missing' }],
        when: { kind: 'before_first_visit' },
      };
      // An assistant charts in a visit, not on the record.
      expect((await setOnRecord(assistant.agent, patient, body)).status).toBe(403);
      // The owner is not a dentist here: they say who the record is for.
      const viaOwner = await setOnRecord(owner, patient, {
        ...body,
        dentistId: dentist.user.profileId,
      });
      expect(viaOwner.status, JSON.stringify(viaOwner.body)).toBe(201);
      await expectProblem(
        setOnRecord(owner, patient, { ...body, dentistId: newId() }),
        422,
        'visit.dentist_invalid',
      );

      const tomorrow = await setOnRecord(dentist.agent, patient, {
        ...body,
        when: { kind: 'date', date: '2026-06-11' },
      });
      expect(tomorrow.status).toBe(422);
      expect(problem(tomorrow.body).errors?.[0]?.path).toBe('when.date');
      const twice = await setOnRecord(dentist.agent, patient, {
        ...body,
        teeth: [body.teeth[0], body.teeth[0]],
      });
      expect(twice.status).toBe(400);

      // Unchanged teeth write nothing; an unknown or a visit's row can't be undone here.
      const same = await ok<PatientPresenceResult>(setOnRecord(dentist.agent, patient, body), 201);
      expect(same.presenceIds).toEqual([]);
      await expectProblem(
        dentist.agent.delete(recordPath(patient, `presence?ids=${newId()}`)),
        404,
        'record.not_found',
      );
      const visit = await startVisit(patient);
      const inVisit = await ok<PresenceResult>(setInVisit(dentist.agent, visit, '12', 'missing'));
      await expectProblem(
        dentist.agent.delete(recordPath(patient, `presence?ids=${String(inVisit.record?.id)}`)),
        409,
        'record.not_removable',
      );
      expect((await assistant.agent.get(recordPath(patient, 'chart'))).status).toBe(200);
    });

    it("counts only the teeth of the chart the patient is on: a child's primary chart", async () => {
      const child = await createPatient('Presence Primary', '2021-03-01');
      await ok(
        setOnRecord(dentist.agent, child, {
          teeth: [
            { toothCode: '75', presence: 'missing' },
            { toothCode: '36', presence: 'not_erupted' },
            { toothCode: '46', presence: 'missing' },
          ],
          when: { kind: 'before_first_visit' },
        }),
        201,
      );
      expect((await chartOf(child)).dentition.stage).toBe('primary');
      expect(
        await ok<ClinicalSummary>(dentist.agent.get(recordPath(child, 'summary'))),
      ).toMatchObject({ missingTeeth: 1, implants: 0 });
    });
  });

  it('never shows or changes another clinic’s presence rows', async () => {
    const patient = await createPatient('Presence Tenant A');
    await ok(
      setOnRecord(dentist.agent, patient, {
        teeth: [{ toothCode: '11', presence: 'missing' }],
        when: { kind: 'before_first_visit' },
      }),
      201,
    );
    const otherEmail = uniqueEmail('owner');
    const other = await admin.post('/api/v1/platform/tenants').send({
      clinic: { name: 'Presence Other', slug: `prs-${newId().slice(-12)}` },
      firstBranch: { name: 'Other Main' },
      owner: { displayName: 'Other Owner', email: otherEmail, temporaryPassword: TEMPORARY },
    });
    expect(other.status).toBe(201);
    const otherOwner = await signInAndSetPassword(testApp.app, otherEmail, TEMPORARY);
    expect((await otherOwner.get(recordPath(patient, 'chart'))).status).toBe(404);
    expect(
      (
        await setOnRecord(otherOwner, patient, {
          teeth: [{ toothCode: '11', presence: 'present' }],
          when: { kind: 'before_first_visit' },
        })
      ).status,
    ).toBe(404);
    const rows = await database.ownerPool.query<{ tenant_id: string }>(
      'select tenant_id from tooth_presences where patient_id = $1',
      [patient.id],
    );
    expect(rows.rows).toEqual([{ tenant_id: tenant.id }]);
    expect(await presenceOf(patient)).toEqual({ '11': 'missing' });
  });
});
