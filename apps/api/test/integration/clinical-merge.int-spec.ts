import type {
  Branch,
  DiagnosisItem,
  DiagnosisResult,
  LiveVisitRef,
  Patient,
  PatientChartResult,
  PatientChart,
  PlanResult,
  ServiceItem,
  Session,
  StaffUser,
  StartVisitResult,
  Tenant,
  Visit,
  VisitResult,
} from '@dcm/contracts';
import type { PoolClient } from 'pg';
import type { Response } from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ToothStatusRepository } from '../../src/modules/clinical/persistence/tooth-status.repository';
import { newId } from '../../src/platform/kernel/id';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { createPlatformAdmin, signIn, signInAndSetPassword, uniqueEmail } from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';

const TEMPORARY = 'temporary-pw-1';

/** Beirut is UTC+3 in June: the tenant's today is 2026-06-10 all day at this instant. */
const NOON = '2026-06-10T09:00:00Z';

interface Staff {
  agent: TestAgent;
  user: StaffUser;
}

/** Where a patient's clinical rows are, straight from the tables. */
interface Owned {
  visits: number;
  diagnoses: number;
  plans: number;
  toothStatus: number;
}

interface RepointAudit {
  actor_user_id: string;
  resource_type: string;
  resource_id: string;
  before: unknown;
  after: unknown;
}

describe('clinical: the merge re-point, in the merge transaction (V10, W24)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let admin: TestAgent;
  let tenant: Tenant;
  let owner: TestAgent;
  let branch: Branch;
  let dentist: Staff;
  let frontdesk: Staff;
  let fill: ServiceItem;
  let caries: DiagnosisItem;

  const createStaff = async (role: 'dentist' | 'frontdesk'): Promise<Staff> => {
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

  const visitPath = (visitId: string, rest: string) => `/api/v1/visits/${visitId}/${rest}`;

  const startVisit = async (patient: Patient): Promise<Visit> => {
    const response = await dentist.agent
      .post('/api/v1/visits')
      .send({ patientId: patient.id, dentistId: dentist.user.profileId });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return (response.body as StartVisitResult).visit;
  };

  const post = async <TResult>(path: string, body: object = {}, status = 201) => {
    const response = await dentist.agent.post(path).send(body);
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    return response.body as TResult;
  };

  const diagnose = (visit: Visit, toothCode: string) =>
    post<DiagnosisResult>(visitPath(visit.id, 'diagnoses'), { diagnosisId: caries.id, toothCode });

  const plan = (visit: Visit, toothCode: string) =>
    post<PlanResult>(visitPath(visit.id, 'plans'), { procedureId: fill.id, toothCode });

  const addFill = (visit: Visit, toothCode: string) =>
    post(visitPath(visit.id, 'services'), { procedureId: fill.id, toothCode });

  const setTooth = async (visit: Visit, position: string, present: 'primary' | 'permanent') => {
    const response = await dentist.agent
      .put(visitPath(visit.id, `teeth/${position}`))
      .send({ present });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  };

  const complete = (visit: Visit) => dentist.agent.post(visitPath(visit.id, 'complete'));

  const completed = async (visit: Visit): Promise<Visit> => {
    const response = await complete(visit);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return (response.body as VisitResult).visit;
  };

  const merge = (agent: TestAgent, kept: Patient, dropped: Patient) =>
    agent
      .post('/api/v1/patients/merge')
      .send({ keepId: kept.id, dropId: dropped.id, reason: 'Same person' });

  const merged = async (agent: TestAgent, kept: Patient, dropped: Patient) => {
    const response = await merge(agent, kept, dropped);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  };

  const owned = async (patient: Patient): Promise<Owned> => {
    const {
      rows: [row],
    } = await database.ownerPool.query<Owned>(
      `select (select count(*) from visits where patient_id = $1)::int as visits,
              (select count(*) from patient_diagnoses where patient_id = $1)::int as diagnoses,
              (select count(*) from treatment_plans where patient_id = $1)::int as plans,
              (select count(*) from tooth_status where patient_id = $1)::int as "toothStatus"`,
      [patient.id],
    );
    if (!row) throw new Error('no counts');
    return row;
  };

  const nothing: Owned = { visits: 0, diagnoses: 0, plans: 0, toothStatus: 0 };

  const repointAudit = async (patient: Patient) =>
    (
      await database.ownerPool.query<RepointAudit>(
        `select actor_user_id, resource_type, resource_id, before, after from audit_log
         where action = 'clinical.repoint' and resource_id = $1 order by occurred_at, id`,
        [patient.id],
      )
    ).rows;

  const chargesOf = async (visitId: string) =>
    (
      await database.ownerPool.query<{ patient_id: string; amount: string }>(
        'select patient_id, amount::text from ledger_entries where visit_id = $1',
        [visitId],
      )
    ).rows;

  const chartOf = async (patient: Patient): Promise<PatientChart> => {
    const response = await dentist.agent.get(`/api/v1/clinical/patients/${patient.id}/chart`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body as PatientChart;
  };

  const liveVisitsOf = async (patient: Patient): Promise<LiveVisitRef[]> => {
    const response = await dentist.agent.get(`/api/v1/visits/live?patientId=${patient.id}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body as LiveVisitRef[];
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
      clinic: { name: 'Merge Clinic', slug: `mrg-${newId().slice(-12)}` },
      firstBranch: { name: 'Merge Main' },
      owner: { displayName: 'Merge Owner', email: ownerEmail, temporaryPassword: TEMPORARY },
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
    const service = (services.body as ServiceItem[]).find((item) => item.code === 'ZFILL');
    if (!service) throw new Error('no service ZFILL');
    fill = service;
    const diagnoses = await owner.put('/api/v1/catalog/diagnoses').send({
      items: [{ code: 'ZCAR', name: 'Test caries' }],
    });
    expect(diagnoses.status, JSON.stringify(diagnoses.body)).toBe(200);
    const diagnosis = (diagnoses.body as DiagnosisItem[]).find((item) => item.code === 'ZCAR');
    if (!diagnosis) throw new Error('no diagnosis ZCAR');
    caries = diagnosis;

    dentist = await createStaff('dentist');
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

  it("moves the visits, diagnoses, plans and tooth status; the kept patient's tooth status wins", async () => {
    const kept = await createPatient('Merge Kept Records');
    const dropped = await createPatient('Merge Dropped Records');
    const keptVisit = await startVisit(kept);
    await setTooth(keptVisit, '14', 'permanent');
    await completed(keptVisit);
    const droppedVisit = await startVisit(dropped);
    const finding = await diagnose(droppedVisit, '36');
    const planned = await plan(droppedVisit, '36');
    await setTooth(droppedVisit, '14', 'primary');
    await setTooth(droppedVisit, '15', 'primary');
    await completed(droppedVisit);

    await merged(owner, kept, dropped);

    expect(await owned(dropped)).toEqual(nothing);
    expect(await owned(kept)).toEqual({ visits: 2, diagnoses: 1, plans: 1, toothStatus: 2 });
    const chart = await chartOf(kept);
    expect(chart.toothStatus).toEqual([
      { position: '14', present: 'permanent' },
      { position: '15', present: 'primary' },
    ]);
    expect(chart.diagnoses.map((record) => record.id)).toEqual([finding.record.id]);
    expect(chart.plans.map((record) => record.id)).toEqual([planned.record.id]);
    const visit = await dentist.agent.get(`/api/v1/visits/${droppedVisit.id}`);
    expect((visit.body as Visit).patientId).toBe(kept.id);

    const session = (await owner.get('/api/v1/session')).body as Session;
    expect(await repointAudit(kept)).toEqual([
      {
        actor_user_id: session.user.id,
        resource_type: 'patient',
        resource_id: kept.id,
        before: {
          toothStatusDropped: [
            { position: '14', present: 'primary', changedInVisitId: droppedVisit.id },
          ],
        },
        after: {
          droppedId: dropped.id,
          visits: 1,
          diagnoses: 1,
          plans: 1,
          planGroups: 0,
          toothStatusMoved: 1,
          toothStatusDropped: 1,
        },
      },
    ]);
  });

  it('audits nothing when the dropped patient has no clinical records', async () => {
    const kept = await createPatient('Merge Kept Empty');
    const dropped = await createPatient('Merge Dropped Empty');
    await merged(owner, kept, dropped);
    expect(await repointAudit(kept)).toEqual([]);
  });

  it('leaves the kept patient two live visits that both complete, both charged to the kept patient', async () => {
    const kept = await createPatient('Merge Kept Live');
    const dropped = await createPatient('Merge Dropped Live');
    const keptVisit = await startVisit(kept);
    await addFill(keptVisit, '16');
    const droppedVisit = await startVisit(dropped);
    await addFill(droppedVisit, '26');

    await merged(owner, kept, dropped);

    expect((await liveVisitsOf(kept)).map((ref) => ref.id)).toEqual([
      keptVisit.id,
      droppedVisit.id,
    ]);
    expect(await liveVisitsOf(dropped)).toEqual([]);
    // Charting goes on in the re-pointed visit, on the kept patient's record.
    const finding = await diagnose(droppedVisit, '26');
    expect(finding.record.patientId).toBe(kept.id);

    await completed(keptVisit);
    await completed(droppedVisit);
    expect(await chargesOf(keptVisit.id)).toEqual([{ patient_id: kept.id, amount: '50.00' }]);
    expect(await chargesOf(droppedVisit.id)).toEqual([{ patient_id: kept.id, amount: '50.00' }]);
  });

  it('rolls the merge back when the re-point fails', async () => {
    const kept = await createPatient('Merge Kept Failing');
    const dropped = await createPatient('Merge Dropped Failing');
    const visit = await startVisit(dropped);
    await diagnose(visit, '36');
    await setTooth(visit, '14', 'primary');
    const teeth = testApp.app.get(ToothStatusRepository, { strict: false });
    vi.spyOn(teeth, 'mergeInto').mockRejectedValueOnce(new Error('re-point failed'));

    const failed = await merge(owner, kept, dropped);
    expect(failed.status).toBe(500);
    expect(await owned(dropped)).toEqual({ visits: 1, diagnoses: 1, plans: 0, toothStatus: 1 });
    expect(await owned(kept)).toEqual(nothing);
    const patient = await owner.get(`/api/v1/patients/${dropped.id}`);
    expect(patient.body).toMatchObject({ mergedIntoId: null, archivedAt: null });

    await merged(owner, kept, dropped);
    expect(await owned(kept)).toEqual({ visits: 1, diagnoses: 1, plans: 0, toothStatus: 1 });
  });

  it('moves the named plans and the plans made without a visit', async () => {
    const kept = await createPatient('Merge Kept Named');
    const dropped = await createPatient('Merge Dropped Named');
    const records = `/api/v1/clinical/patients/${dropped.id}`;
    const { chart: grouped } = await post<PatientChartResult>(`${records}/plan-groups`, {
      title: 'Phase 1',
    });
    const groupId = grouped.planGroups[0]?.id;
    await post(`${records}/plans`, { procedureId: fill.id, toothCode: '46', groupId });

    await merged(owner, kept, dropped);

    const response = await dentist.agent.get(`/api/v1/clinical/patients/${kept.id}/chart`);
    const chart = response.body as PatientChart;
    expect(chart.planGroups).toMatchObject([{ id: groupId, patientId: kept.id }]);
    expect(chart.plans).toMatchObject([{ groupId, recordedInVisitId: null, patientId: kept.id }]);
    expect(await repointAudit(kept)).toEqual([
      expect.objectContaining({
        after: expect.objectContaining({ plans: 1, planGroups: 1 }) as unknown,
      }),
    ]);
  });

  it('lets front desk merge (no visit:write): the records follow', async () => {
    const kept = await createPatient('Merge Kept Front Desk');
    const dropped = await createPatient('Merge Dropped Front Desk');
    const visit = await startVisit(dropped);
    await plan(visit, '46');

    await merged(frontdesk.agent, kept, dropped);

    expect(await owned(kept)).toEqual({ visits: 1, diagnoses: 0, plans: 1, toothStatus: 0 });
    expect(await repointAudit(kept)).toEqual([
      expect.objectContaining({ actor_user_id: frontdesk.user.id }),
    ]);
  });

  it('follows a merge chain: A into B, then B into C leaves everything on C', async () => {
    const a = await createPatient('Merge Chain A');
    const b = await createPatient('Merge Chain B');
    const c = await createPatient('Merge Chain C');
    const first = await startVisit(a);
    await diagnose(first, '11');
    await setTooth(first, '15', 'primary');
    await completed(first);
    const second = await startVisit(b);
    await plan(second, '21');

    await merged(owner, b, a);
    await merged(owner, c, b);

    expect(await owned(a)).toEqual(nothing);
    expect(await owned(b)).toEqual(nothing);
    expect(await owned(c)).toEqual({ visits: 2, diagnoses: 1, plans: 1, toothStatus: 1 });
  });

  describe('locks (ADR-0023)', () => {
    /** Sessions blocked by `pid`: a request that reached the holder's lock and waits on it. */
    const blockedBy = async (pid: number) =>
      (
        await database.ownerPool.query<{ n: number }>(
          'select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))',
          [pid],
        )
      ).rows[0]?.n;

    /**
     * `work` in an open transaction of the tenant on its own connection, then `request` sent
     * while it is open: it must wait on the holder's locks, and settles only once they commit.
     */
    const whileHolding = async (
      work: (holder: PoolClient) => Promise<void>,
      request: () => Promise<Response>,
    ): Promise<Response> => {
      const holder = await database.ownerPool.connect();
      try {
        await holder.query('begin');
        await holder.query("select set_config('app.tenant_id', $1, true)", [tenant.id]);
        await work(holder);
        const {
          rows: [backend],
        } = await holder.query<{ pid: number }>('select pg_backend_pid() as pid');
        if (!backend) throw new Error('no backend pid');
        let settled = false;
        const pending = request().then((response) => {
          settled = true;
          return response;
        });
        await expect.poll(() => blockedBy(backend.pid)).toBe(1);
        expect(settled).toBe(false);
        await holder.query('commit');
        return await pending;
      } catch (error) {
        await holder.query('rollback');
        throw error;
      } finally {
        holder.release();
      }
    };

    it("waits for charting on the kept patient's live visit: its tooth status wins", async () => {
      const kept = await createPatient('Merge Kept Charting');
      const dropped = await createPatient('Merge Dropped Charting');
      const keptVisit = await startVisit(kept);
      const droppedVisit = await startVisit(dropped);
      await setTooth(droppedVisit, '14', 'primary');

      // A charting change in flight on the kept visit: the visit locked, tooth 14 set.
      const response = await whileHolding(
        async (holder) => {
          await holder.query('select id from visits where id = $1 for update', [keptVisit.id]);
          await holder.query(
            `insert into tooth_status (id, patient_id, position, present, changed_in_visit_id,
                                       changed_by)
             values ($1, $2, '14', 'permanent', $3, $4)`,
            [newId(), kept.id, keptVisit.id, dentist.user.id],
          );
        },
        () => merge(owner, kept, dropped),
      );

      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect((await chartOf(kept)).toothStatus).toEqual([{ position: '14', present: 'permanent' }]);
      expect(await owned(dropped)).toEqual(nothing);
    });

    it('re-points visits first: a record written in a dropped visit in flight moves too', async () => {
      const kept = await createPatient('Merge Kept In Flight');
      const dropped = await createPatient('Merge Dropped In Flight');
      const visit = await startVisit(dropped);

      // A diagnosis being recorded in the dropped patient's visit: the visit locked, the row in.
      const response = await whileHolding(
        async (holder) => {
          await holder.query('select id from visits where id = $1 for update', [visit.id]);
          await holder.query(
            `insert into patient_diagnoses (id, patient_id, tooth_code, diagnosis_id, code, name,
                                            dentist_id, recorded_by, recorded_in_visit_id,
                                            recorded_at)
             values ($1, $2, '36', $3, $4, $5, $6, $7, $8, now())`,
            [
              newId(),
              dropped.id,
              caries.id,
              caries.code,
              caries.name,
              dentist.user.profileId,
              dentist.user.id,
              visit.id,
            ],
          );
        },
        () => merge(owner, kept, dropped),
      );

      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(await owned(dropped)).toEqual(nothing);
      expect(await owned(kept)).toEqual({ visits: 1, diagnoses: 1, plans: 0, toothStatus: 0 });
    });
  });
});
