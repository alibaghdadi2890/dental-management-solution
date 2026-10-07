import type {
  AuditEntry,
  AuditPage,
  Branch,
  LiveVisitRef,
  Patient,
  ProblemDetails,
  Room,
  Session,
  StaffUser,
  StartDefaults,
  StartVisitResult,
  Tenant,
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

interface Clinic {
  tenant: Tenant;
  owner: TestAgent;
  ownerUserId: string;
  ownerProfileId: string;
  branch: Branch;
}

interface Staff {
  agent: TestAgent;
  user: StaffUser;
}

const problem = (body: unknown) => body as ProblemDetails;

describe('clinical: visit lifecycle (start, resume, pause, discard, live)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let admin: TestAgent;
  let main: Clinic;
  let bare: Clinic;
  let north: Branch;
  let dentist: Staff;
  let assistant: Staff;
  let frontdesk: Staff;
  let northDentist: Staff;
  let rooms: Room[];
  let inactiveRoom: Room;

  const provision = async (name: string): Promise<Clinic> => {
    const ownerEmail = uniqueEmail('owner');
    const response = await admin.post('/api/v1/platform/tenants').send({
      clinic: { name, slug: `vis-${newId().slice(-12)}` },
      firstBranch: { name: `${name} Main` },
      owner: { displayName: `${name} Owner`, email: ownerEmail, temporaryPassword: TEMPORARY },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const owner = await signInAndSetPassword(testApp.app, ownerEmail, TEMPORARY);
    const [branch] = (await owner.get('/api/v1/branches')).body as Branch[];
    if (!branch) throw new Error('provisioning created no branch');
    const session = (await owner.get('/api/v1/session')).body as Session;
    const users = (await owner.get('/api/v1/users')).body as StaffUser[];
    const profile = users.find((user) => user.id === session.user.id);
    if (!profile) throw new Error('provisioning created no owner profile');
    return {
      tenant: response.body as Tenant,
      owner,
      ownerUserId: session.user.id,
      ownerProfileId: profile.profileId,
      branch,
    };
  };

  const createStaff = async (
    clinic: Clinic,
    role: 'dentist' | 'assistant' | 'frontdesk',
    branchId = clinic.branch.id,
  ): Promise<Staff> => {
    const email = uniqueEmail(role);
    const response = await clinic.owner.post('/api/v1/users').send({
      displayName: `The ${role} ${newId().slice(-6)}`,
      email,
      practitionerType: role,
      roleKeys: [role],
      branchIds: [branchId],
      temporaryPassword: TEMPORARY,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const agent = await signInAndSetPassword(testApp.app, email, TEMPORARY);
    return { agent, user: response.body as StaffUser };
  };

  const createPatient = async (clinic: Clinic, fullName: string): Promise<Patient> => {
    const response = await clinic.owner
      .post('/api/v1/patients')
      .set('Idempotency-Key', newId())
      .send({ fullName, phone: '71 000 000' });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as Patient;
  };

  const start = (agent: TestAgent, body: Record<string, unknown>) =>
    agent.post('/api/v1/visits').send(body);

  /** Starts a new visit and expects 201. */
  const started = async (agent: TestAgent, body: Record<string, unknown>): Promise<Visit> => {
    const response = await start(agent, body);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const result = response.body as StartVisitResult;
    expect(result.resumed).toBe(false);
    return result.visit;
  };

  const act = async (agent: TestAgent, visitId: string, action: string) =>
    agent.post(`/api/v1/visits/${visitId}/${action}`);

  const acted = async (agent: TestAgent, visitId: string, action: string): Promise<Visit> => {
    const response = await act(agent, visitId, action);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return (response.body as VisitResult).visit;
  };

  const live = async (agent: TestAgent, query = ''): Promise<LiveVisitRef[]> => {
    const response = await agent.get(`/api/v1/visits/live${query}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body as LiveVisitRef[];
  };

  const auditOf = async (agent: TestAgent, query: string): Promise<AuditEntry[]> =>
    ((await agent.get(`/api/v1/audit?${query}&limit=100`)).body as AuditPage).items;

  const visitRow = async (id: string) =>
    (
      await database.ownerPool.query<{
        status: string;
        started_by: string;
        discarded_by: string | null;
        paused_at: Date | null;
      }>('select status, started_by, discarded_by, paused_at from visits where id = $1', [id])
    ).rows[0];

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    testApp.clock.set(new Date(NOON));
    admin = await signIn(testApp.app, await createPlatformAdmin(testApp.app), undefined, {
      rememberMe: true,
    });
    main = await provision('Visits Clinic');
    bare = await provision('Roomless Clinic');

    const branch = await main.owner.post('/api/v1/branches').send({ name: 'North' });
    expect(branch.status, JSON.stringify(branch.body)).toBe(201);
    north = branch.body as Branch;

    const saved = await main.owner.post('/api/v1/rooms/batch').send({
      items: [
        ...['Room 1', 'Room 2', 'Room 3', 'Room 4', 'Room 5'].map((name) => ({
          branchId: main.branch.id,
          name,
          active: true,
        })),
        { branchId: main.branch.id, name: 'Closed', active: false },
        { branchId: north.id, name: 'North 1', active: true },
      ],
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const all = saved.body as Room[];
    rooms = all.filter((room) => room.branchId === main.branch.id && room.active);
    const closed = all.find((room) => !room.active);
    if (!closed || rooms.length !== 5) throw new Error('rooms not created');
    inactiveRoom = closed;

    dentist = await createStaff(main, 'dentist');
    assistant = await createStaff(main, 'assistant');
    frontdesk = await createStaff(main, 'frontdesk');
    northDentist = await createStaff(main, 'dentist', north.id);
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  const room = (index: number) => {
    const found = rooms[index];
    if (!found) throw new Error(`no room ${String(index)}`);
    return found.id;
  };

  describe('start and resume', () => {
    it('starts a visit (201), then resumes the same one (200) for the same patient', async () => {
      const patient = await createPatient(main, 'Start Resume');
      const visit = await started(main.owner, {
        patientId: patient.id,
        dentistId: main.ownerProfileId,
        roomId: room(0),
      });
      expect(visit).toMatchObject({
        patientId: patient.id,
        branchId: main.branch.id,
        roomId: room(0),
        dentistId: main.ownerProfileId,
        startedBy: main.ownerUserId,
        status: 'in_progress',
        localDate: TODAY,
        startedAt: new Date(NOON).toISOString(),
        pausedAt: null,
        pausedSeconds: 0,
        completedAt: null,
        durationMinutes: null,
        notes: '',
        discountMode: 'percent',
        discountValue: '0.00',
        currency: 'USD',
        services: [],
        money: { subtotal: '0.00', discount: '0.00', total: '0.00', capped: false },
        serverNow: new Date(NOON).toISOString(),
      });

      const again = await start(main.owner, {
        patientId: patient.id,
        dentistId: main.ownerProfileId,
        roomId: room(1),
      });
      expect(again.status, JSON.stringify(again.body)).toBe(200);
      const resumed = again.body as StartVisitResult;
      expect(resumed.resumed).toBe(true);
      expect(resumed.visit.id).toBe(visit.id);
      expect(resumed.visit.roomId).toBe(room(0));

      expect((await visitRow(visit.id))?.started_by).toBe(main.ownerUserId);
      const audit = await auditOf(main.owner, `resourceType=visit&resourceId=${visit.id}`);
      expect(audit.map((entry) => entry.action)).toEqual(['visit.start']);
      await expect
        .poll(async () =>
          (await auditOf(main.owner, 'resourceType=event'))
            .filter((entry) => entry.action === 'VisitStarted')
            .map((entry) => (entry.after as { visitId: string }).visitId),
        )
        .toContain(visit.id);

      await acted(main.owner, visit.id, 'discard');
    });

    it('serialises parallel starts of one patient on the advisory lock: one creates, one resumes', async () => {
      // A roomless branch, so only the per-patient lock (not the room index) keeps it to one.
      const patient = await createPatient(bare, 'Parallel Start');
      const body = { patientId: patient.id, dentistId: bare.ownerProfileId };
      const key = 'hashtextextended($1::text, 0)';
      const lockKey = `visit-start:${patient.id}`;
      const holder = await database.ownerPool.connect();
      try {
        await holder.query(`select pg_advisory_lock(${key})`, [lockKey]);
        let settled = 0;
        const pending = [start(bare.owner, body), start(bare.owner, body)].map((request) =>
          request.then((response) => {
            settled += 1;
            return response;
          }),
        );
        // Both starts reach the lock and wait on it (pg_locks splits the bigint key in two oids).
        await expect
          .poll(async () => {
            const waiting = await database.ownerPool.query<{ n: number }>(
              `select count(*)::int as n from pg_locks
               where locktype = 'advisory' and not granted
                 and ((classid::bigint << 32) | objid::bigint) = ${key}`,
              [lockKey],
            );
            return waiting.rows[0]?.n;
          })
          .toBe(2);
        expect(settled).toBe(0);
        await holder.query(`select pg_advisory_unlock(${key})`, [lockKey]);

        const responses = await Promise.all(pending);
        expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
        const results = responses.map((response) => response.body as StartVisitResult);
        expect(results.filter((result) => result.resumed)).toHaveLength(1);
        expect(new Set(results.map((result) => result.visit.id)).size).toBe(1);
      } finally {
        holder.release();
      }
      const count = await database.ownerPool.query<{ n: number }>(
        'select count(*)::int as n from visits where patient_id = $1',
        [patient.id],
      );
      expect(count.rows[0]?.n).toBe(1);
    });

    it('refuses a second patient in a room that a live visit holds (409 visit.room_busy)', async () => {
      const first = await createPatient(main, 'Room Holder');
      const second = await createPatient(main, 'Room Seeker');
      const holding = await started(main.owner, {
        patientId: first.id,
        dentistId: main.ownerProfileId,
        roomId: room(2),
      });
      const response = await start(dentist.agent, {
        patientId: second.id,
        dentistId: dentist.user.profileId,
        roomId: room(2),
      });
      expect(response.status).toBe(409);
      expect(problem(response.body).code).toBe('visit.room_busy');

      await acted(main.owner, holding.id, 'discard');
    });

    it('requires a room when the branch has active rooms, and refuses an inactive or foreign one', async () => {
      const patient = await createPatient(main, 'Room Rules');
      const base = { patientId: patient.id, dentistId: main.ownerProfileId };

      const missing = await start(main.owner, base);
      expect(missing.status).toBe(422);
      expect(problem(missing.body).code).toBe('visit.room_required');

      const closed = await start(main.owner, { ...base, roomId: inactiveRoom.id });
      expect(closed.status).toBe(422);
      expect(problem(closed.body).code).toBe('visit.room_invalid');

      const unknown = await start(main.owner, { ...base, roomId: newId() });
      expect(unknown.status).toBe(422);
      expect(problem(unknown.body).code).toBe('visit.room_invalid');
    });

    it('starts without a room in a branch that has no rooms', async () => {
      const patient = await createPatient(bare, 'No Rooms');
      const visit = await started(bare.owner, {
        patientId: patient.id,
        dentistId: bare.ownerProfileId,
      });
      expect(visit.roomId).toBeNull();

      const other = await createPatient(bare, 'No Rooms Either');
      const second = await started(bare.owner, {
        patientId: other.id,
        dentistId: bare.ownerProfileId,
      });
      expect(second.roomId).toBeNull();
    });

    it('refuses a dentist who is not assigned to the branch (422 visit.dentist_invalid)', async () => {
      const patient = await createPatient(main, 'Wrong Dentist');
      const foreign = await start(main.owner, {
        patientId: patient.id,
        dentistId: northDentist.user.profileId,
        roomId: room(3),
      });
      expect(foreign.status).toBe(422);
      expect(problem(foreign.body).code).toBe('visit.dentist_invalid');

      const notADentist = await start(main.owner, {
        patientId: patient.id,
        dentistId: assistant.user.profileId,
        roomId: room(3),
      });
      expect(notADentist.status).toBe(422);
      expect(problem(notADentist.body).code).toBe('visit.dentist_invalid');
    });

    it('resumes the live visit of a patient archived since it started', async () => {
      const patient = await createPatient(main, 'Archived Mid Visit');
      const visit = await started(main.owner, {
        patientId: patient.id,
        dentistId: main.ownerProfileId,
        roomId: room(3),
      });
      const archive = await main.owner.post('/api/v1/patients/archive').send({ ids: [patient.id] });
      expect(archive.status, JSON.stringify(archive.body)).toBe(200);

      const again = await start(main.owner, {
        patientId: patient.id,
        dentistId: main.ownerProfileId,
        roomId: room(3),
      });
      expect(again.status, JSON.stringify(again.body)).toBe(200);
      expect(again.body as StartVisitResult).toMatchObject({
        resumed: true,
        visit: { id: visit.id },
      });

      await acted(main.owner, visit.id, 'discard');
      const fresh = await start(main.owner, {
        patientId: patient.id,
        dentistId: main.ownerProfileId,
        roomId: room(3),
      });
      expect(fresh.status).toBe(409);
      expect(problem(fresh.body).code).toBe('patient.archived');
    });

    it('refuses a merged-away patient (409 patient.merged)', async () => {
      const kept = await createPatient(main, 'Merge Kept');
      const dropped = await createPatient(main, 'Merge Dropped');
      const merged = await main.owner
        .post('/api/v1/patients/merge')
        .send({ keepId: kept.id, dropId: dropped.id, reason: 'Same person' });
      expect(merged.status, JSON.stringify(merged.body)).toBe(200);

      const response = await start(main.owner, {
        patientId: dropped.id,
        dentistId: main.ownerProfileId,
        roomId: room(3),
      });
      expect(response.status).toBe(409);
      expect(problem(response.body).code).toBe('patient.merged');
    });

    it('requires a session branch (422 visit.branch_required)', async () => {
      const closing = await main.owner.post('/api/v1/branches').send({ name: 'Closing' });
      expect(closing.status, JSON.stringify(closing.body)).toBe(201);
      const branch = closing.body as Branch;
      const stranded = await createStaff(main, 'dentist', branch.id);
      const closed = await main.owner
        .patch(`/api/v1/branches/${branch.id}`)
        .send({ active: false });
      expect(closed.status, JSON.stringify(closed.body)).toBe(200);

      const patient = await createPatient(main, 'No Branch');
      const response = await start(stranded.agent, {
        patientId: patient.id,
        dentistId: stranded.user.profileId,
      });
      expect(response.status, JSON.stringify(response.body)).toBe(422);
      expect(problem(response.body).code).toBe('visit.branch_required');
    });

    it('refuses an archived patient (409 patient.archived) and an unknown one (404)', async () => {
      const patient = await createPatient(main, 'Archived Visit');
      await main.owner.post('/api/v1/patients/archive').send({ ids: [patient.id] });
      const archived = await start(main.owner, {
        patientId: patient.id,
        dentistId: main.ownerProfileId,
        roomId: room(3),
      });
      expect(archived.status).toBe(409);
      expect(problem(archived.body).code).toBe('patient.archived');

      const unknown = await start(main.owner, {
        patientId: newId(),
        dentistId: main.ownerProfileId,
        roomId: room(3),
      });
      expect(unknown.status).toBe(404);
    });

    it('lets front desk read a visit but not start one', async () => {
      const patient = await createPatient(main, 'Front Desk');
      const refused = await start(frontdesk.agent, {
        patientId: patient.id,
        dentistId: main.ownerProfileId,
        roomId: room(3),
      });
      expect(refused.status).toBe(403);
      expect((await frontdesk.agent.get('/api/v1/visits/start-defaults')).status).toBe(403);

      const visit = await started(main.owner, {
        patientId: patient.id,
        dentistId: main.ownerProfileId,
        roomId: room(3),
      });
      const read = await frontdesk.agent.get(`/api/v1/visits/${visit.id}`);
      expect(read.status, JSON.stringify(read.body)).toBe(200);
      expect((read.body as Visit).id).toBe(visit.id);
      expect((await act(frontdesk.agent, visit.id, 'pause')).status).toBe(403);

      await acted(main.owner, visit.id, 'discard');
    });

    it('answers 404 visit.not_found for an unknown visit', async () => {
      const response = await main.owner.get(`/api/v1/visits/${newId()}`);
      expect(response.status).toBe(404);
      expect(problem(response.body).code).toBe('visit.not_found');
    });
  });

  describe('pause, resume, notes and discount', () => {
    it('pauses and resumes idempotently; paused time is added to pausedSeconds', async () => {
      const patient = await createPatient(main, 'Pause Resume');
      const visit = await started(main.owner, {
        patientId: patient.id,
        dentistId: main.ownerProfileId,
        roomId: room(4),
      });

      const paused = await acted(main.owner, visit.id, 'pause');
      expect(paused).toMatchObject({ status: 'paused', pausedAt: new Date(NOON).toISOString() });
      testApp.clock.advance({ seconds: 2 });
      const pausedAgain = await acted(main.owner, visit.id, 'pause');
      expect(pausedAgain).toMatchObject({ status: 'paused', pausedAt: paused.pausedAt });

      const resumed = await acted(main.owner, visit.id, 'resume');
      expect(resumed).toMatchObject({ status: 'in_progress', pausedAt: null, pausedSeconds: 2 });
      const resumedAgain = await acted(main.owner, visit.id, 'resume');
      expect(resumedAgain).toMatchObject({ status: 'in_progress', pausedSeconds: 2 });

      const audit = await auditOf(main.owner, `resourceType=visit&resourceId=${visit.id}`);
      expect(audit.map((entry) => entry.action).sort()).toEqual([
        'visit.pause',
        'visit.resume',
        'visit.start',
      ]);

      await acted(main.owner, visit.id, 'discard');
      testApp.clock.set(new Date(NOON));
    });

    it('saves notes and the discount and audits each as visit.update', async () => {
      const patient = await createPatient(main, 'Notes Discount');
      const visit = await started(main.owner, {
        patientId: patient.id,
        dentistId: main.ownerProfileId,
        roomId: room(4),
      });

      const notes = await main.owner
        .patch(`/api/v1/visits/${visit.id}/notes`)
        .send({ notes: 'Sensitive on 16.' });
      expect(notes.status, JSON.stringify(notes.body)).toBe(200);
      expect((notes.body as VisitResult).visit.notes).toBe('Sensitive on 16.');

      const discount = await main.owner
        .patch(`/api/v1/visits/${visit.id}/discount`)
        .send({ mode: 'amount', value: '15' });
      expect(discount.status, JSON.stringify(discount.body)).toBe(200);
      expect((discount.body as VisitResult).visit).toMatchObject({
        discountMode: 'amount',
        discountValue: '15.00',
        money: { subtotal: '0.00', discount: '0.00', total: '0.00', capped: true },
      });

      const read = (await main.owner.get(`/api/v1/visits/${visit.id}`)).body as Visit;
      expect(read).toMatchObject({
        notes: 'Sensitive on 16.',
        discountMode: 'amount',
        discountValue: '15.00',
      });

      const updates = (
        await auditOf(main.owner, `resourceType=visit&resourceId=${visit.id}`)
      ).filter((entry) => entry.action === 'visit.update');
      expect(updates.map((entry) => entry.after)).toEqual(
        expect.arrayContaining([
          { notes: 'Sensitive on 16.' },
          { discountMode: 'amount', discountValue: '15.00' },
        ]),
      );

      const tooLong = await main.owner
        .patch(`/api/v1/visits/${visit.id}/notes`)
        .send({ notes: 'x'.repeat(20001) });
      expect(tooLong.status).toBe(400);
      expect(problem(tooLong.body).errors?.[0]?.path).toBe('notes');

      await main.owner.patch(`/api/v1/visits/${visit.id}/notes`).send({ notes: '  ' });
      await acted(main.owner, visit.id, 'discard');
    });
  });

  describe('complete', () => {
    it('completes a paused visit: the pause ends, money and duration freeze, the room frees', async () => {
      const patient = await createPatient(main, 'Complete Paused');
      const visit = await started(assistant.agent, {
        patientId: patient.id,
        dentistId: dentist.user.profileId,
        roomId: room(2),
      });
      testApp.clock.advance({ seconds: 90 });
      await acted(assistant.agent, visit.id, 'pause');
      testApp.clock.advance({ minutes: 10 });

      const completed = await acted(assistant.agent, visit.id, 'complete');
      const completedAt = new Date(new Date(NOON).getTime() + 690_000).toISOString();
      expect(completed).toMatchObject({
        id: visit.id,
        status: 'completed',
        pausedAt: null,
        pausedSeconds: 600,
        completedAt,
        durationMinutes: 2,
        money: { subtotal: '0.00', discount: '0.00', total: '0.00', capped: false },
      });
      expect(await visitRow(visit.id)).toMatchObject({ status: 'completed', paused_at: null });
      const completedBy = await database.ownerPool.query<{ completed_by: string }>(
        'select completed_by from visits where id = $1',
        [visit.id],
      );
      expect(completedBy.rows[0]?.completed_by).toBe(assistant.user.id);
      expect((await main.owner.get(`/api/v1/visits/${visit.id}`)).body).toMatchObject({
        status: 'completed',
        completedAt,
      });
      expect((await live(main.owner, `?patientId=${patient.id}`)).map((ref) => ref.id)).toEqual([]);

      const audit = await auditOf(main.owner, `resourceType=visit&resourceId=${visit.id}`);
      expect(audit.find((entry) => entry.action === 'visit.complete')).toMatchObject({
        actorUserId: assistant.user.id,
        before: { status: 'paused', pausedSeconds: 0 },
        after: { status: 'completed', pausedAt: null, pausedSeconds: 600, total: '0.00' },
      });
      await expect
        .poll(async () =>
          (await auditOf(main.owner, 'resourceType=event'))
            .filter((entry) => entry.action === 'VisitCompleted')
            .map((entry) => entry.after),
        )
        .toContainEqual({
          visitId: visit.id,
          patientId: patient.id,
          currency: 'USD',
          total: '0.00',
          localDate: TODAY,
        });

      const other = await createPatient(main, 'Complete Room Reuse');
      const reused = await started(main.owner, {
        patientId: other.id,
        dentistId: main.ownerProfileId,
        roomId: room(2),
      });
      await acted(main.owner, reused.id, 'discard');
      testApp.clock.set(new Date(NOON));
    });

    it('completes the live visit of a patient archived since it started', async () => {
      const patient = await createPatient(main, 'Complete Archived');
      const visit = await started(main.owner, {
        patientId: patient.id,
        dentistId: main.ownerProfileId,
        roomId: room(2),
      });
      const archive = await main.owner.post('/api/v1/patients/archive').send({ ids: [patient.id] });
      expect(archive.status, JSON.stringify(archive.body)).toBe(200);
      expect((await acted(main.owner, visit.id, 'complete')).status).toBe('completed');
    });

    it('refuses a second completion (409), front desk (403) and a discarded or unknown visit (404)', async () => {
      const patient = await createPatient(main, 'Complete Refused');
      const visit = await started(main.owner, {
        patientId: patient.id,
        dentistId: main.ownerProfileId,
        roomId: room(2),
      });
      const forbidden = await act(frontdesk.agent, visit.id, 'complete');
      expect(forbidden.status).toBe(403);
      await acted(main.owner, visit.id, 'complete');
      const again = await act(main.owner, visit.id, 'complete');
      expect(again.status).toBe(409);
      expect(problem(again.body).code).toBe('visit.not_live');

      const discardedVisit = await started(main.owner, {
        patientId: patient.id,
        dentistId: main.ownerProfileId,
        roomId: room(2),
      });
      await acted(main.owner, discardedVisit.id, 'discard');
      for (const id of [discardedVisit.id, newId()]) {
        const missing = await act(main.owner, id, 'complete');
        expect(missing.status).toBe(404);
        expect(problem(missing.body).code).toBe('visit.not_found');
      }
    });
  });

  describe('discard', () => {
    it('discards an empty paused visit: the room is free again and the visit reads as not found', async () => {
      const patient = await createPatient(main, 'Discard Empty');
      const visit = await started(assistant.agent, {
        patientId: patient.id,
        dentistId: dentist.user.profileId,
        roomId: room(0),
      });
      const paused = await acted(assistant.agent, visit.id, 'pause');
      await assistant.agent
        .patch(`/api/v1/visits/${visit.id}/discount`)
        .send({ mode: 'percent', value: '10' });

      const discarded = await acted(assistant.agent, visit.id, 'discard');
      expect(discarded).toMatchObject({ id: visit.id, status: 'discarded', pausedAt: null });
      const row = await visitRow(visit.id);
      expect(row).toMatchObject({ status: 'discarded', paused_at: null });
      expect(row?.discarded_by).toBe(assistant.user.id);

      expect((await main.owner.get(`/api/v1/visits/${visit.id}`)).status).toBe(404);
      const again = await act(assistant.agent, visit.id, 'pause');
      expect(again.status).toBe(409);
      expect(problem(again.body).code).toBe('visit.not_live');

      const other = await createPatient(main, 'Room Reuse');
      const reused = await started(main.owner, {
        patientId: other.id,
        dentistId: main.ownerProfileId,
        roomId: room(0),
      });
      await acted(main.owner, reused.id, 'discard');

      const audit = await auditOf(main.owner, `resourceType=visit&resourceId=${visit.id}`);
      const discardEntry = audit.find((entry) => entry.action === 'visit.discard');
      expect(discardEntry?.before).toEqual({ status: 'paused', pausedAt: paused.pausedAt });
      expect(discardEntry?.after).toMatchObject({ status: 'discarded', pausedAt: null });
    });

    it('refuses to discard a visit with notes, a service or a tooth change (409 visit.not_empty)', async () => {
      const patient = await createPatient(main, 'Discard Busy');
      const visit = await started(main.owner, {
        patientId: patient.id,
        dentistId: main.ownerProfileId,
        roomId: room(1),
      });

      await main.owner.patch(`/api/v1/visits/${visit.id}/notes`).send({ notes: 'Examined.' });
      const withNotes = await act(main.owner, visit.id, 'discard');
      expect(withNotes.status).toBe(409);
      expect(problem(withNotes.body).code).toBe('visit.not_empty');
      await main.owner.patch(`/api/v1/visits/${visit.id}/notes`).send({ notes: '' });

      await database.ownerPool.query(
        `insert into visit_services (id, tenant_id, visit_id, procedure_id, code, name, charge_unit,
                                     tooth_code, base_amount, recorded_by)
         select $1, tenant_id, $2, id, code, name, charge_unit,
                case when charge_unit = 'per_tooth' then '16' end, price_amount, $3
         from procedures where tenant_id = $4 limit 1`,
        [newId(), visit.id, main.ownerUserId, main.tenant.id],
      );
      const withService = await act(main.owner, visit.id, 'discard');
      expect(withService.status).toBe(409);
      expect(problem(withService.body).code).toBe('visit.not_empty');

      await database.ownerPool.query(
        'update visit_services set deleted_at = now() where visit_id = $1',
        [visit.id],
      );
      await database.ownerPool.query(
        `insert into tooth_presences (id, tenant_id, patient_id, tooth_code, presence,
                                      dentist_id, recorded_in_visit_id, recorded_by)
         values ($1, $2, $3, '14', 'missing', $4, $5, $6)`,
        [newId(), main.tenant.id, patient.id, visit.dentistId, visit.id, main.ownerUserId],
      );
      const withTooth = await act(main.owner, visit.id, 'discard');
      expect(withTooth.status).toBe(409);
      expect(problem(withTooth.body).code).toBe('visit.not_empty');

      // Taken back (an Undo): the visit is empty again.
      await database.ownerPool.query(
        'update tooth_presences set deleted_at = now() where recorded_in_visit_id = $1',
        [visit.id],
      );
      expect((await acted(main.owner, visit.id, 'discard')).status).toBe('discarded');
    });
  });

  describe('live visits and start defaults', () => {
    it('lists "mine" for the dentist and for whoever started it, not for another dentist', async () => {
      const patient = await createPatient(main, 'Live Mine');
      const visit = await started(assistant.agent, {
        patientId: patient.id,
        dentistId: dentist.user.profileId,
        roomId: room(2),
      });

      const forDentist = await live(dentist.agent, '?mine=true');
      const ref = forDentist.find((item) => item.id === visit.id);
      expect(ref).toMatchObject({
        patientId: patient.id,
        patientName: 'Live Mine',
        dentistName: dentist.user.displayName,
        status: 'in_progress',
        startedAt: new Date(NOON).toISOString(),
        pausedAt: null,
        pausedSeconds: 0,
        serverNow: new Date(NOON).toISOString(),
      });
      expect((await live(assistant.agent, '?mine=true')).map((item) => item.id)).toContain(
        visit.id,
      );
      expect((await live(main.owner, '?mine=true')).map((item) => item.id)).not.toContain(visit.id);
      expect((await live(main.owner)).map((item) => item.id)).toContain(visit.id);
      expect(
        (await live(frontdesk.agent, `?patientId=${patient.id}`)).map((item) => item.id),
      ).toEqual([visit.id]);

      await acted(assistant.agent, visit.id, 'discard');
      expect(await live(main.owner, `?patientId=${patient.id}`)).toEqual([]);
    });

    it('lists a platform admin\'s own starts as "mine" (no staff profile)', async () => {
      const patient = await createPatient(main, 'Admin Start');
      const response = await admin
        .post('/api/v1/visits')
        .set('X-Tenant-Id', main.tenant.id)
        .send({ patientId: patient.id, dentistId: main.ownerProfileId, roomId: room(3) });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      const visit = (response.body as StartVisitResult).visit;
      const adminId = ((await admin.get('/api/v1/session')).body as Session).user.id;
      expect(visit.startedBy).toBe(adminId);

      const mine = await admin
        .get('/api/v1/visits/live?mine=true')
        .set('X-Tenant-Id', main.tenant.id);
      expect(mine.status, JSON.stringify(mine.body)).toBe(200);
      expect((mine.body as LiveVisitRef[]).map((item) => item.id)).toEqual([visit.id]);

      await acted(main.owner, visit.id, 'discard');
    });

    it('defaults the dentist to a branch dentist caller and the room to their last free room today', async () => {
      const patient = await createPatient(main, 'Defaults');
      const visit = await started(dentist.agent, {
        patientId: patient.id,
        dentistId: dentist.user.profileId,
        roomId: room(4),
      });

      const busy = await dentist.agent.get('/api/v1/visits/start-defaults');
      expect(busy.status, JSON.stringify(busy.body)).toBe(200);
      expect(busy.body as StartDefaults).toEqual({
        dentistId: dentist.user.profileId,
        roomId: null,
      });

      await acted(dentist.agent, visit.id, 'discard');
      const free = (await dentist.agent.get('/api/v1/visits/start-defaults')).body as StartDefaults;
      expect(free).toEqual({ dentistId: dentist.user.profileId, roomId: room(4) });

      const forAssistant = (await assistant.agent.get('/api/v1/visits/start-defaults'))
        .body as StartDefaults;
      expect(forAssistant.dentistId).toBeNull();
    });
  });
});
