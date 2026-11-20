import type {
  Appointment,
  AuditPage,
  FollowUp,
  OperationalAttention,
  Patient,
  ProblemDetails,
  StaffUser,
  StartVisitResult,
  WaitlistEntry,
  WaitlistOpeningDetail,
  WaitlistOpenings,
  WaitlistPage,
} from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../src/platform/kernel/id';
import { ok, provisionClinic, type StaffMember, type TestClinic } from '../support/clinic';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { signIn } from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';

/** Thu 19 Nov 2026, 09:00 in Beirut (UTC+2 in November): the acceptance's now. */
const NOW = new Date('2026-11-19T07:00:00Z');
const at = (day: string, time: string) => new Date(`${day}T${time}:00+02:00`).toISOString();
const TUE = '2026-11-24';
const DEC10 = '2026-12-10';
const MON_TO_WED = { weekdays: [1, 2, 3], betweenFrom: '14:00', betweenTo: '18:00' };

/** Feature 21: the waitlist's entries, openings, the fill, and the rules that keep it true. */
describe('scheduling: the waitlist (feature 21)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let clinic: TestClinic;
  let owner: TestAgent;
  let reyes: StaffMember;
  let desk: StaffMember;
  let reyesId: string;
  let leeId: string;

  const base = '/api/v1/scheduling';

  const newPatient = async (name: string): Promise<Patient> =>
    ok<Patient>(
      owner
        .post('/api/v1/patients')
        .set('Idempotency-Key', newId())
        .send({ fullName: `${name} ${newId().slice(-6)}`, phone: '+96170123456' }),
      201,
    );

  const book = (
    patientId: string,
    startsAt: string,
    extra: Record<string, unknown> = {},
    agent: TestAgent = desk.agent,
  ) =>
    ok<Appointment>(
      agent
        .post(`${base}/appointments`)
        .set('Idempotency-Key', newId())
        .send({
          branchId: clinic.branch.id,
          patientId,
          dentistId: reyesId,
          startsAt,
          durationMin: 60,
          reason: 'Filling',
          override: true,
          ...extra,
        }),
      201,
    );

  /** Fills the dentist's day around the times a test frees, so its openings are known. */
  const busyDay = async (day: string, spans: [string, number][], dentistId = reyesId) => {
    for (const [time, minutes] of spans) {
      await book((await newPatient('Filler')).id, at(day, time), {
        durationMin: minutes,
        dentistId,
      });
    }
  };

  const post = <T>(agent: TestAgent, path: string, body: unknown = {}, status = 200) =>
    ok<T>(agent.post(`${base}/${path}`).send(body as object), status);

  const problem = async (request: PromiseLike<{ status: number; body: unknown }>) => {
    const response = await request;
    return { ...(response.body as ProblemDetails), status: response.status };
  };

  const addEntry = (patientId: string, body: Record<string, unknown> = {}, agent = desk.agent) =>
    agent.post(`${base}/waitlist`).send({
      branchId: clinic.branch.id,
      patientId,
      dentistId: reyesId,
      reason: 'Filling',
      durationMin: 30,
      ...body,
    });

  const opening = (appointmentId: string) =>
    ok<WaitlistOpeningDetail>(desk.agent.get(`${base}/waitlist/openings/${appointmentId}`));

  const fill = (
    entryId: string,
    body: Record<string, unknown>,
    agent: TestAgent = desk.agent,
    key = newId(),
  ) => agent.post(`${base}/waitlist/${entryId}/fill`).set('Idempotency-Key', key).send(body);

  const waitlistOf = (patientId: string) =>
    ok<WaitlistEntry[]>(desk.agent.get(`${base}/patients/${patientId}/waitlist`));
  const list = (query: Record<string, string> = {}) =>
    ok<WaitlistPage>(
      desk.agent.get(`${base}/waitlist`).query({ branchId: clinic.branch.id, ...query }),
    );

  /** An awaiting follow-up of Dr. Reyes for the patient: a visit completed with a next step. */
  const followUpFor = async (patientId: string, durationMin: number): Promise<FollowUp> => {
    const started = await ok<StartVisitResult>(
      reyes.agent.post('/api/v1/visits').send({
        patientId,
        dentistId: reyesId,
        roomId: clinic.spareRoom.id,
        type: 'examination',
      }),
      201,
    );
    await ok(
      reyes.agent.post(`/api/v1/visits/${started.visit.id}/complete`).send({
        nextAppointment: {
          kind: 'planned_treatment',
          title: 'Crown prep',
          durationMin,
          timing: 'within_1_month',
        },
      }),
    );
    const [followUp] = await ok<FollowUp[]>(
      desk.agent.get(`${base}/patients/${patientId}/follow-ups`),
    );
    if (!followUp) throw new Error('no follow-up');
    return followUp;
  };

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    testApp.clock.set(NOW);
    clinic = await provisionClinic(testApp, 'Waitlist');
    const session = await ok<{ user: { email: string } }>(clinic.owner.get('/api/v1/session'));
    owner = await signIn(testApp.app, session.user.email, undefined, { rememberMe: true });
    const remembered = async (member: StaffMember): Promise<StaffMember> => ({
      ...member,
      agent: await signIn(testApp.app, member.user.email, undefined, { rememberMe: true }),
    });
    reyes = await remembered(await clinic.staff(['dentist'], 'Dr. Reyes'));
    const lee = await remembered(await clinic.staff(['dentist'], 'Dr. Lee'));
    desk = await remembered(await clinic.staff(['frontdesk'], 'Jamie', 'assistant'));
    const users = await ok<StaffUser[]>(owner.get('/api/v1/users'));
    const profile = (id: string) => users.find((user) => user.id === id)?.profileId ?? '';
    reyesId = profile(reyes.user.id);
    leeId = profile(lee.user.id);
  }, 120_000);

  beforeEach(() => {
    testApp.clock.set(NOW);
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  it('runs the acceptance: the tick, an opening, the call, the move, the chain', async () => {
    // Rami wants an earlier time than Thu 10 Dec 10:00, on Mon–Wed afternoons.
    const rami = await newPatient('Rami');
    await busyDay(DEC10, [
      ['09:00', 60],
      ['11:00', 60],
    ]);
    const ramis = await book(rami.id, at(DEC10, '10:00'), { waitlist: MON_TO_WED });
    expect(ramis.waitlist).toMatchObject({ wishes: { weekdays: [1, 2, 3], betweenFrom: '14:00' } });
    expect((await waitlistOf(rami.id))[0]).toMatchObject({
      until: DEC10,
      appointment: { id: ramis.id },
    });

    // Unticked in Edit, it goes; ticked again, it is back.
    const edit = (waitlist: unknown) =>
      ok<Appointment>(
        desk.agent.patch(`${base}/appointments/${ramis.id}`).set('Idempotency-Key', newId()).send({
          dentistId: reyesId,
          startsAt: ramis.startsAt,
          durationMin: 60,
          reason: ramis.reason,
          roomId: 'auto',
          waitlist,
        }),
      );
    expect((await edit(null)).waitlist).toBeNull();
    expect(await waitlistOf(rami.id)).toEqual([]);
    expect((await edit(MON_TO_WED)).waitlist).not.toBeNull();
    const [ramiEntry] = await waitlistOf(rami.id);

    // Maya waits with no appointment, Saturdays with Dr. Lee: until 30 days ahead.
    const maya = await newPatient('Maya');
    const mayaEntry = await ok<WaitlistEntry>(
      addEntry(maya.id, { dentistId: leeId, wishes: { weekdays: [6] }, source: 'slot_finder' }),
      201,
    );
    expect(mayaEntry).toMatchObject({ until: '2026-12-19', appointment: null, status: 'waiting' });
    expect(await problem(addEntry(maya.id, { dentistId: leeId }))).toMatchObject({
      status: 409,
      code: 'waitlist.entry_exists',
      entryId: mayaEntry.id,
    });

    // Noor's awaiting follow-up (45 minutes, Dr. Reyes) goes on the list and stays on the worklist.
    const noor = await newPatient('Noor');
    const followUp = await followUpFor(noor.id, 45);
    const noorEntry = await ok<WaitlistEntry>(
      addEntry(noor.id, {
        reason: followUp.title,
        durationMin: 45,
        followUpId: followUp.id,
        planIds: followUp.planIds,
        source: 'follow_up',
      }),
      201,
    );
    const worklist = await ok<FollowUp[]>(
      desk.agent.get(`${base}/follow-ups?branchId=${clinic.branch.id}`),
    );
    expect(worklist.find((row) => row.id === followUp.id)).toMatchObject({ onWaitlist: true });

    // Dr. Reyes is booked all Tuesday afternoon; Kenji's 15:00–16:00 is cancelled.
    await busyDay(TUE, [
      ['14:00', 60],
      ['16:00', 120],
    ]);
    const kenji = await book((await newPatient('Kenji')).id, at(TUE, '15:00'));
    await post(desk.agent, `appointments/${kenji.id}/cancel`, { reason: 'Travelling' });
    const tuesday = await opening(kenji.id);
    expect(tuesday.opening).toMatchObject({
      startsAt: at(TUE, '15:00'),
      endsAt: at(TUE, '16:00'),
      fitCount: 2,
      leftOpen: false,
    });
    expect(tuesday.fits.map((fit) => fit.entry.id)).toEqual([ramiEntry?.id, noorEntry.id]);
    expect(tuesday.fits[0]?.entry.callPhone).toBe('+96170123456');
    expect(tuesday.fits[0]?.starts[0]).toBe(at(TUE, '15:00'));
    const lane = await ok<WaitlistOpenings>(
      desk.agent.get(`${base}/waitlist/openings?branchId=${clinic.branch.id}`),
    );
    expect(lane.openings.find((item) => item.id === kenji.id)).toMatchObject({ fitCount: 2 });

    // No answer on Rami puts him under Noor, with the attempt.
    const ramiId = ramiEntry?.id ?? '';
    const tried = await post<WaitlistEntry>(desk.agent, `waitlist/${ramiId}/attempt`, {
      outcome: 'no_answer',
    });
    expect(tried).toMatchObject({ triedToday: true, lastAttempt: { outcome: 'no_answer' } });
    expect((await opening(kenji.id)).fits.map((fit) => fit.entry.id)).toEqual([
      noorEntry.id,
      ramiId,
    ]);

    // He calls back: Book moves his appointment, confirmed, and the entry is booked.
    const moved = await ok<Appointment>(
      fill(ramiId, { openingId: kenji.id, startsAt: at(TUE, '15:00'), confirmed: true }),
    );
    expect(moved).toMatchObject({
      startsAt: at(TUE, '15:00'),
      status: 'confirmed',
      fromWaitlist: true,
      lineage: { moves: 1, firstStartsAt: at(DEC10, '10:00') },
      waitlist: null,
    });
    expect((await opening(kenji.id)).opening).toBeNull();
    const booked = await list({ status: 'booked' });
    expect(booked.items.find((item) => item.id === ramiId)).toMatchObject({
      status: 'booked',
      bookedAppointmentId: moved.id,
    });

    // The chain: his old time is an opening Noor fits; the 15 minutes left fit nobody.
    const chain = await opening(ramis.id);
    expect(chain.opening).toMatchObject({
      startsAt: at(DEC10, '10:00'),
      endsAt: at(DEC10, '11:00'),
    });
    expect(chain.fits.map((fit) => fit.entry.id)).toEqual([noorEntry.id]);
    const noors = await ok<Appointment>(
      fill(noorEntry.id, { openingId: ramis.id, startsAt: at(DEC10, '10:00') }),
    );
    expect(noors).toMatchObject({
      endsAt: at(DEC10, '10:45'),
      followUp: { id: followUp.id },
      fromWaitlist: true,
    });
    const after = await ok<FollowUp[]>(
      desk.agent.get(`${base}/follow-ups?branchId=${clinic.branch.id}`),
    );
    expect(after.map((row) => row.id)).not.toContain(followUp.id);
    expect(await opening(ramis.id)).toMatchObject({ opening: { fitCount: 0 }, fits: [] });

    // Every step is on the Activity screen under Schedule.
    const page = await ok<AuditPage>(owner.get(`/api/v1/audit?area=schedule&patientId=${rami.id}`));
    expect(page.items.map((item) => item.action)).toEqual(
      expect.arrayContaining([
        'waitlist_entry.add',
        'waitlist_entry.remove',
        'waitlist_entry.no_answer',
        'waitlist_entry.book',
      ]),
    );
  });

  it('refuses a taken time: the race, the override, the retry', async () => {
    const day = '2026-11-25';
    await busyDay(day, [
      ['08:00', 120],
      ['11:00', 420],
    ]);
    const freed = await book((await newPatient('Freed')).id, at(day, '10:00'));
    await post(desk.agent, `appointments/${freed.id}/cancel`);
    const [first, second] = [await newPatient('First'), await newPatient('Second')];
    const a = await ok<WaitlistEntry>(addEntry(first.id, { durationMin: 60 }), 201);
    const b = await ok<WaitlistEntry>(addEntry(second.id, { durationMin: 60 }), 201);
    const body = { openingId: freed.id, startsAt: at(day, '10:00') };
    const [one, two] = await Promise.all([fill(a.id, body), fill(b.id, body, owner)]);
    expect([one.status, two.status].sort()).toEqual([200, 409]);
    const refused = (one.status === 409 ? one : two).body as ProblemDetails;
    expect(['waitlist.opening_taken', 'appointment.conflict']).toContain(refused.code);
    const range = await ok<Appointment[]>(
      desk.agent.get(`${base}/appointments`).query({
        branchId: clinic.branch.id,
        from: at(day, '00:00'),
        to: at(day, '23:59'),
      }),
    );
    const at10 = range.filter(
      (item) => item.startsAt === at(day, '10:00') && item.status !== 'cancelled',
    );
    expect(at10, 'never double-booked').toHaveLength(1);

    // The loser's owner, who may override, still cannot fill over that appointment.
    const loser = one.status === 409 ? a : b;
    expect(await problem(fill(loser.id, body, owner))).toMatchObject({ status: 409 });
    expect((await waitlistOf(loser.id === a.id ? first.id : second.id))[0]?.status).toBe('waiting');
  });

  it('never double-books against an ordinary booking, and a cancel racing a move fails cleanly', async () => {
    const day = '2026-11-30';
    await busyDay(day, [
      ['08:00', 120],
      ['11:00', 420],
    ]);
    const freed = await book((await newPatient('Freed')).id, at(day, '10:00'));
    await post(desk.agent, `appointments/${freed.id}/cancel`);
    const waiting = await ok<WaitlistEntry>(
      addEntry((await newPatient('Waiting')).id, { durationMin: 60 }),
      201,
    );
    const walkIn = await newPatient('Walk-in');
    const [filled, booked] = await Promise.all([
      fill(waiting.id, { openingId: freed.id, startsAt: at(day, '10:00') }),
      owner
        .post(`${base}/appointments`)
        .set('Idempotency-Key', newId())
        .send({
          branchId: clinic.branch.id,
          patientId: walkIn.id,
          dentistId: reyesId,
          startsAt: at(day, '10:00'),
          durationMin: 60,
          reason: 'Walk-in',
          roomId: clinic.spareRoom.id,
        }),
    ]);
    expect([filled.status, booked.status].filter((status) => status < 300)).toHaveLength(1);

    // A move from the waitlist and a cancel of the same appointment: one wins, no 500.
    const other = '2026-12-07';
    await busyDay(other, [
      ['08:00', 60],
      ['10:00', 480],
    ]);
    const gap = await book((await newPatient('Gap')).id, at(other, '09:00'));
    await post(desk.agent, `appointments/${gap.id}/cancel`);
    const mover = await newPatient('Mover');
    const later = await book(mover.id, at('2026-12-14', '09:00'), { waitlist: {} });
    const [entry] = await waitlistOf(mover.id);
    const [moved, cancelled] = await Promise.all([
      fill(entry?.id ?? '', { openingId: gap.id, startsAt: at(other, '09:00') }),
      owner.post(`${base}/appointments/${later.id}/cancel`).send({}),
    ]);
    expect([moved.status, cancelled.status].every((status) => status < 500)).toBe(true);
    expect(
      [moved.status, cancelled.status].filter((status) => status < 300).length,
    ).toBeGreaterThan(0);
  });

  it('replays a retried fill and refuses the key with another request', async () => {
    const day = '2026-11-27';
    await busyDay(day, [
      ['08:00', 60],
      ['10:00', 480],
    ]);
    const freed = await book((await newPatient('Freed')).id, at(day, '09:00'));
    await post(desk.agent, `appointments/${freed.id}/cancel`);
    const patient = await newPatient('Retry');
    const entry = await ok<WaitlistEntry>(addEntry(patient.id), 201);
    const key = newId();
    const body = { openingId: freed.id, startsAt: at(day, '09:00') };
    const first = await ok<Appointment>(fill(entry.id, body, desk.agent, key));
    const again = await ok<Appointment>(fill(entry.id, body, desk.agent, key));
    expect(again.id).toBe(first.id);
    expect(
      await problem(fill(entry.id, { ...body, startsAt: at(day, '09:15') }, desk.agent, key)),
    ).toMatchObject({ status: 409, code: 'appointment.idempotency_mismatch' });
  });

  it('follows a move, and the cancel tick and its restore', async () => {
    const day = '2026-12-01';
    const sami = await newPatient('Sami');
    const theirs = await book(sami.id, at(day, '09:00'), { dentistId: leeId, waitlist: {} });
    const moved = await ok<Appointment>(
      desk.agent
        .post(`${base}/appointments/${theirs.id}/reschedule`)
        .set('Idempotency-Key', newId())
        .send({ startsAt: at(day, '11:00') }),
    );
    expect(moved.waitlist).not.toBeNull();
    const [followed] = await waitlistOf(sami.id);
    expect(followed?.appointment?.id).toBe(moved.id);

    // Cancelling with the tick: the entry waits without the appointment, until 30 days ahead.
    await post(desk.agent, `appointments/${moved.id}/cancel`, { waitlist: true });
    const [kept] = await waitlistOf(sami.id);
    expect(kept).toMatchObject({
      id: followed?.id,
      appointment: null,
      dentistId: leeId,
      reason: 'Filling',
      durationMin: 60,
      until: '2026-12-19',
    });
    // Restore gives it back to the appointment.
    await post(desk.agent, `appointments/${moved.id}/restore`);
    expect((await waitlistOf(sami.id))[0]?.appointment?.id).toBe(moved.id);

    // Cancelled with the tick and no entry: a new one, removed again by Restore.
    const other = await newPatient('Other');
    const plain = await book(other.id, at(day, '14:00'), { dentistId: leeId });
    await post(desk.agent, `appointments/${plain.id}/cancel`, { waitlist: true });
    expect(await waitlistOf(other.id)).toHaveLength(1);
    await post(desk.agent, `appointments/${plain.id}/restore`);
    expect(await waitlistOf(other.id)).toEqual([]);

    // Cancelled without the tick: the appointment's entry is removed.
    await post(desk.agent, `appointments/${moved.id}/cancel`);
    expect(await waitlistOf(sami.id)).toEqual([]);
  });

  it('ends entries by itself: checked in, past its date; and a follow-up booked another way', async () => {
    const today = '2026-11-19';
    const patient = await newPatient('Expiring');
    const todays = await book(patient.id, at(today, '12:00'), { waitlist: { sameDay: true } });
    await post(desk.agent, `appointments/${todays.id}/check-in`);
    const expired = await list({ status: 'expired' });
    expect(expired.items.map((item) => item.patient.id)).toContain(patient.id);
    expect(await waitlistOf(patient.id)).toEqual([]);

    const later = await newPatient('Later');
    const entry = await ok<WaitlistEntry>(addEntry(later.id, { until: '2026-11-20' }), 201);
    testApp.clock.set(new Date('2026-11-21T07:00:00Z'));
    const gone = await list({ status: 'expired' });
    expect(gone.items.find((item) => item.id === entry.id)).toMatchObject({ status: 'expired' });
    expect((await list()).items.map((item) => item.id)).not.toContain(entry.id);
    // An expired entry does not block a new one.
    await ok(addEntry(later.id), 201);
    testApp.clock.set(NOW);

    // A booking that takes the entry's follow-up fills it.
    const withFollowUp = await newPatient('Follow');
    const followUp = await followUpFor(withFollowUp.id, 30);
    const linked = await ok<WaitlistEntry>(
      addEntry(withFollowUp.id, { followUpId: followUp.id, reason: followUp.title }),
      201,
    );
    await book(withFollowUp.id, at('2026-12-02', '09:00'), {
      followUpId: followUp.id,
      durationMin: 30,
    });
    const filled = await list({ status: 'booked' });
    expect(filled.items.find((item) => item.id === linked.id)).toMatchObject({ status: 'booked' });

    // Declining a follow-up removes its entry.
    const declining = await newPatient('Declining');
    const declined = await followUpFor(declining.id, 30);
    await ok(addEntry(declining.id, { followUpId: declined.id, reason: declined.title }), 201);
    await post(desk.agent, `follow-ups/${declined.id}/decline`, { reason: 'Moved away' });
    expect(await waitlistOf(declining.id)).toEqual([]);
  });

  it('keeps the older entry on merge, removes on archive, and goes Any dentist on deactivate', async () => {
    const [keptPatient, droppedPatient] = [await newPatient('Kept'), await newPatient('Dropped')];
    const older = await ok<WaitlistEntry>(addEntry(keptPatient.id), 201);
    await ok(addEntry(droppedPatient.id), 201);
    await ok(
      owner
        .post('/api/v1/patients/merge')
        .send({ keepId: keptPatient.id, dropId: droppedPatient.id, reason: 'Same person' }),
    );
    expect((await waitlistOf(keptPatient.id)).map((entry) => entry.id)).toEqual([older.id]);

    const archived = await newPatient('Archived');
    await ok(addEntry(archived.id), 201);
    await ok(owner.post('/api/v1/patients/archive').send({ ids: [archived.id] }));
    const removed = await list({ status: 'removed' });
    expect(removed.items.find((item) => item.patient.id === archived.id)).toMatchObject({
      removeReason: 'Patient archived',
    });

    const leaving = await clinic.staff(['dentist'], 'Dr. Leaving');
    const users = await ok<StaffUser[]>(owner.get('/api/v1/users'));
    const leavingId = users.find((user) => user.id === leaving.user.id)?.profileId ?? '';
    const named = await newPatient('Named');
    const entry = await ok<WaitlistEntry>(addEntry(named.id, { dentistId: leavingId }), 201);
    await ok(owner.post(`/api/v1/users/${leaving.user.id}/deactivate`).send({ reason: 'Left' }));
    expect((await waitlistOf(named.id))[0]).toMatchObject({ id: entry.id, dentistId: null });
    const trail = await ok<AuditPage>(
      owner.get(`/api/v1/audit?area=schedule&patientId=${named.id}`),
    );
    expect(trail.items.find((item) => item.action === 'waitlist_entry.any_dentist')).toMatchObject({
      actorKind: 'system',
    });
  });

  it("leaves an opening open, counts the dashboard's line, and keeps the column rule", async () => {
    const day = '2026-12-03';
    await busyDay(day, [
      ['08:00', 60],
      ['10:00', 480],
    ]);
    const freed = await book((await newPatient('Freed')).id, at(day, '09:00'));
    await post(desk.agent, `appointments/${freed.id}/cancel`);
    await ok(addEntry((await newPatient('Fits')).id), 201);
    const count = async () =>
      (
        await ok<OperationalAttention>(
          owner
            .get('/api/v1/dashboards/operational/attention')
            .query({ branchId: clinic.branch.id }),
        )
      ).openingsToFill;
    const before = await count();
    const lane = async () =>
      (
        await ok<WaitlistOpenings>(
          desk.agent.get(`${base}/waitlist/openings?branchId=${clinic.branch.id}`),
        )
      ).openings.filter((item) => item.fitCount > 0 && !item.leftOpen).length;
    expect(before).toBe(await lane());
    await post(desk.agent, `waitlist/openings/${freed.id}/leave-open`);
    expect((await opening(freed.id)).opening).toMatchObject({ leftOpen: true });
    expect(await count()).toBe((before ?? 0) - 1);

    // Dr. Reyes ticks his own appointments, not Dr. Lee's, and sees no Waitlist view.
    const patient = await newPatient('Column');
    const own = '2026-12-04';
    await book(
      patient.id,
      at(own, '09:00'),
      { waitlist: {}, override: false, durationMin: 30 },
      reyes.agent,
    );
    const lees = await problem(
      reyes.agent
        .post(`${base}/appointments`)
        .set('Idempotency-Key', newId())
        .send({
          branchId: clinic.branch.id,
          patientId: (await newPatient('Lees')).id,
          dentistId: leeId,
          startsAt: at(own, '09:00'),
          durationMin: 30,
          reason: 'Check-up',
          waitlist: {},
        }),
    );
    expect(lees.status).toBe(403);
    expect((await reyes.agent.get(`${base}/waitlist?branchId=${clinic.branch.id}`)).status).toBe(
      403,
    );
    expect((await problem(addEntry(patient.id, { dentistId: null }, reyes.agent))).status).toBe(
      403,
    );
  });
});
