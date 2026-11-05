import type {
  Appointment,
  AppointmentCheckResult,
  AuditPage,
  FollowUp,
  Patient,
  ProblemDetails,
  Slot,
  SlotDay,
  StaffUser,
  StartVisitResult,
  TodayBoard,
} from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../src/platform/kernel/id';
import { ok, provisionClinic, type StaffMember, type TestClinic } from '../support/clinic';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { signIn } from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';

/** A Monday, 09:00 in Beirut (UTC+3 in June). */
const NOW = new Date('2026-06-15T06:00:00Z');
const at = (time: string, day = '2026-06-15') => `${day}T${time}:00+03:00`;
const TOMORROW = '2026-06-16';

/** Feature 14: the calendar's rules, its races, and what other modules' events do to it. */
describe('scheduling: appointments and follow-ups (feature 14)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let clinic: TestClinic;
  let owner: TestAgent;
  let reyes: StaffMember;
  let lee: StaffMember;
  let desk: StaffMember;
  let reyesId: string;
  let leeId: string;

  const newPatient = async (name = 'Sofia Mendes'): Promise<Patient> =>
    ok<Patient>(
      owner
        .post('/api/v1/patients')
        .set('Idempotency-Key', newId())
        .send({ fullName: `${name} ${newId().slice(-6)}`, phone: '+96170123456' }),
      201,
    );

  const bookRequest = (agent: TestAgent, body: Record<string, unknown>, key = newId()) =>
    agent
      .post('/api/v1/scheduling/appointments')
      .set('Idempotency-Key', key)
      .send({ branchId: clinic.branch.id, reason: 'Check-up', durationMin: 30, ...body });

  /** A booked appointment on a day of its own, so tests never meet each other. */
  let nextDay = 0;
  const freshDay = () => {
    nextDay += 1;
    const day = new Date(Date.UTC(2026, 6, 1 + nextDay));
    if (day.getUTCDay() === 0) return freshDay();
    return day.toISOString().slice(0, 10);
  };

  const book = async (
    patientId: string,
    startsAt: string,
    extra: Record<string, unknown> = {},
  ): Promise<Appointment> =>
    ok<Appointment>(
      bookRequest(desk.agent, {
        patientId,
        dentistId: reyesId,
        startsAt,
        roomId: 'auto',
        override: true,
        ...extra,
      }),
      201,
    );

  const post = <T>(agent: TestAgent, path: string, body: unknown = {}, status = 200) =>
    ok<T>(agent.post(`/api/v1/scheduling/${path}`).send(body as object), status);

  const problem = async (request: PromiseLike<{ status: number; body: unknown }>) => {
    const response = await request;
    return { ...(response.body as ProblemDetails), status: response.status };
  };

  const startVisit = (agent: TestAgent, patientId: string, appointmentId?: string, status = 201) =>
    ok<StartVisitResult>(
      agent.post('/api/v1/visits').send({
        patientId,
        dentistId: reyesId,
        roomId: clinic.spareRoom.id,
        type: 'examination',
        ...(appointmentId ? { appointmentId } : {}),
      }),
      status,
    );

  const appointment = (id: string) =>
    ok<Appointment>(owner.get(`/api/v1/scheduling/appointments/${id}`));

  const NEXT = {
    kind: 'healing_review',
    title: 'Healing review',
    durationMin: 15,
    timing: 'within_1_week',
  };

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    testApp.clock.set(NOW);
    clinic = await provisionClinic(testApp, 'Scheduling');
    const session = await ok<{ user: { email: string } }>(clinic.owner.get('/api/v1/session'));
    owner = await signIn(testApp.app, session.user.email, undefined, { rememberMe: true });
    // Remembered sessions: these tests move the clock past the idle timeout.
    const remembered = async (member: StaffMember): Promise<StaffMember> => ({
      ...member,
      agent: await signIn(testApp.app, member.user.email, undefined, { rememberMe: true }),
    });
    reyes = await remembered(await clinic.staff(['dentist'], 'Dr. Reyes'));
    lee = await remembered(await clinic.staff(['dentist'], 'Dr. Lee'));
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

  describe('booking and conflicts', () => {
    it('books with Auto in a free room, confirmed, and audits it in the feed', async () => {
      const patient = await newPatient();
      const day = freshDay();
      const booked = await book(patient.id, at('14:45', day), { confirmed: true });
      expect(booked).toMatchObject({
        status: 'confirmed',
        roomAuto: true,
        roomName: clinic.room.name,
        dentistName: 'Dr. Reyes',
        localDate: day,
        bookedByName: 'Jamie',
        unresolved: false,
      });
      expect(booked.patient).toMatchObject({ id: patient.id, registrationIncomplete: false });
      const page = await ok<AuditPage>(
        owner.get(`/api/v1/audit?area=schedule&patientId=${patient.id}`),
      );
      expect(page.items.map((item) => item.action)).toContain('appointment.book');
    });

    it('refuses the same room, the same patient, whatever the override', async () => {
      const [first, second] = [await newPatient(), await newPatient()];
      const day = freshDay();
      const startsAt = at('15:00', day);
      await book(first.id, startsAt, { roomId: clinic.room.id });
      const room = await problem(
        bookRequest(desk.agent, {
          patientId: second.id,
          dentistId: leeId,
          startsAt,
          roomId: clinic.room.id,
          override: true,
        }),
      );
      expect(room).toMatchObject({ status: 409, code: 'appointment.conflict' });
      const patient = await problem(
        bookRequest(desk.agent, {
          patientId: first.id,
          dentistId: leeId,
          startsAt,
          roomId: clinic.spareRoom.id,
          override: true,
        }),
      );
      expect(patient).toMatchObject({ status: 409, code: 'appointment.conflict' });
      expect((patient as unknown as { conflicts: { kind: string }[] }).conflicts[0]?.kind).toBe(
        'patient',
      );
    });

    it('lets adjacent appointments share a room', async () => {
      const [first, second] = [await newPatient(), await newPatient()];
      const day = freshDay();
      await book(first.id, at('10:00', day), { roomId: clinic.room.id });
      await book(second.id, at('10:30', day), { roomId: clinic.room.id });
    });

    it('needs the override for a dentist overlap, and records what it went through', async () => {
      const [first, second, third] = [await newPatient(), await newPatient(), await newPatient()];
      const day = freshDay();
      const startsAt = at('11:00', day);
      await book(first.id, startsAt, { roomId: clinic.room.id });
      const refused = await problem(
        bookRequest(reyes.agent, {
          patientId: second.id,
          dentistId: reyesId,
          startsAt,
          roomId: clinic.spareRoom.id,
          override: true,
        }),
      );
      expect(refused).toMatchObject({ status: 409, code: 'appointment.conflict' });
      const passed = await book(third.id, startsAt, { roomId: clinic.spareRoom.id });
      expect(passed.overridden).toEqual(['dentist']);
    });

    it('warns outside the hours and on a closed day', async () => {
      const patient = await newPatient();
      const check = (startsAt: string) =>
        post<AppointmentCheckResult>(desk.agent, 'appointments/check', {
          branchId: clinic.branch.id,
          dentistId: reyesId,
          startsAt,
          durationMin: 30,
        });
      expect((await check(at('18:30', TOMORROW))).conflicts.map((c) => c.kind)).toEqual([
        'outside_hours',
      ]);
      expect((await check(at('10:00', '2026-06-21'))).conflicts.map((c) => c.kind)).toEqual([
        'closed_day',
      ]);
      const late = await book(patient.id, at('18:30', TOMORROW));
      expect(late.overridden).toEqual(['outside_hours']);
    });

    it('refuses the past, a room of no branch and a dentist not here', async () => {
      const patient = await newPatient();
      const base = { patientId: patient.id, dentistId: reyesId, startsAt: at('08:00') };
      expect(await problem(bookRequest(desk.agent, base))).toMatchObject({
        code: 'appointment.in_past',
      });
      const day = freshDay();
      expect(
        await problem(
          bookRequest(desk.agent, { ...base, startsAt: at('10:00', day), roomId: newId() }),
        ),
      ).toMatchObject({ code: 'appointment.room_not_in_branch' });
      expect(
        await problem(
          bookRequest(desk.agent, { ...base, startsAt: at('10:00', day), dentistId: newId() }),
        ),
      ).toMatchObject({ code: 'appointment.dentist_not_in_branch' });
    });

    it('keeps a dentist to their own column', async () => {
      const patient = await newPatient();
      const refused = await problem(
        bookRequest(reyes.agent, {
          patientId: patient.id,
          dentistId: leeId,
          startsAt: at('10:00', freshDay()),
        }),
      );
      expect(refused.status).toBe(403);
    });

    it('lets one of two concurrent bookings of a room through, the other answers a conflict', async () => {
      const [first, second] = [await newPatient(), await newPatient()];
      const startsAt = at('09:00', freshDay());
      const results = await Promise.all(
        [first, second].map((patient, index) =>
          bookRequest(desk.agent, {
            patientId: patient.id,
            dentistId: index === 0 ? reyesId : leeId,
            startsAt,
            roomId: clinic.room.id,
          }),
        ),
      );
      expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
      const refused = results.find((result) => result.status === 409);
      expect(refused?.body).toMatchObject({ code: 'appointment.conflict' });
    });

    it('moves a concurrent Auto booking to another room rather than failing', async () => {
      const [first, second] = [await newPatient(), await newPatient()];
      const startsAt = at('09:30', freshDay());
      const results = await Promise.all(
        [first, second].map((patient, index) =>
          bookRequest(desk.agent, {
            patientId: patient.id,
            dentistId: index === 0 ? reyesId : leeId,
            startsAt,
            roomId: 'auto',
          }),
        ),
      );
      expect(results.map((result) => result.status)).toEqual([201, 201]);
      const rooms = results.map((result) => (result.body as Appointment).roomId);
      expect(new Set(rooms).size).toBe(2);
    });

    it('replays a retried booking and refuses the key on another request', async () => {
      const patient = await newPatient();
      const key = newId();
      const body = { patientId: patient.id, dentistId: reyesId, startsAt: at('12:00', freshDay()) };
      const first = await ok<Appointment>(bookRequest(desk.agent, body, key), 201);
      const again = await ok<Appointment>(bookRequest(desk.agent, body, key), 201);
      expect(again.id).toBe(first.id);
      expect(
        await problem(bookRequest(desk.agent, { ...body, durationMin: 45 }, key)),
      ).toMatchObject({ status: 409, code: 'appointment.idempotency_mismatch' });
    });
  });

  describe('moving', () => {
    const reschedule = (agent: TestAgent, id: string, body: object, key = newId()) =>
      agent
        .post(`/api/v1/scheduling/appointments/${id}/reschedule`)
        .set('Idempotency-Key', key)
        .send(body);

    it('makes a new row, unconfirmed, in the lineage, and counts the moves', async () => {
      const patient = await newPatient();
      const [from, to] = [freshDay(), freshDay()];
      const first = await book(patient.id, at('14:00', from), { confirmed: true });
      const moved = await ok<Appointment>(
        reschedule(desk.agent, first.id, { startsAt: at('10:30', to), dentistId: leeId }),
      );
      expect(moved).toMatchObject({ status: 'booked', dentistName: 'Dr. Lee' });
      expect(moved.lineage).toMatchObject({ moves: 1, firstStartsAt: first.startsAt });
      const old = await appointment(first.id);
      expect(old.status).toBe('rescheduled');
      expect(old.lineage.movedToStartsAt).toBe(moved.startsAt);
    });

    it('chooses an Auto room again and keeps one picked by hand, refusing its clash', async () => {
      const [other, patient] = [await newPatient(), await newPatient()];
      const day = freshDay();
      await book(other.id, at('11:00', day), { roomId: clinic.room.id, dentistId: leeId });
      const auto = await book(patient.id, at('09:00', day));
      const moved = await ok<Appointment>(
        reschedule(desk.agent, auto.id, { startsAt: at('11:00', day) }),
      );
      expect(moved.roomId).toBe(clinic.spareRoom.id);

      const fixed = await book((await newPatient()).id, at('14:00', day), {
        roomId: clinic.room.id,
      });
      expect(
        await problem(reschedule(desk.agent, fixed.id, { startsAt: at('11:00', day) })),
      ).toMatchObject({ status: 409, code: 'appointment.conflict' });
      expect((await appointment(fixed.id)).status).toBe('booked');
    });

    it('takes a column the caller cannot write on either side', async () => {
      const patient = await newPatient();
      const mine = await ok<Appointment>(
        bookRequest(reyes.agent, {
          patientId: patient.id,
          dentistId: reyesId,
          startsAt: at('10:00', freshDay()),
        }),
        201,
      );
      const across = await reschedule(reyes.agent, mine.id, {
        startsAt: at('12:00', freshDay()),
        dentistId: leeId,
      });
      expect(across.status).toBe(403);
      const theirs = await book((await newPatient()).id, at('10:00', freshDay()), {
        dentistId: leeId,
      });
      expect(
        (await reschedule(reyes.agent, theirs.id, { startsAt: at('12:00', freshDay()) })).status,
      ).toBe(403);
    });

    it('resizes the same row, keeping its status', async () => {
      const patient = await newPatient();
      const booked = await book(patient.id, at('10:00', freshDay()), { confirmed: true });
      const resized = await post<Appointment>(desk.agent, `appointments/${booked.id}/resize`, {
        durationMin: 45,
      });
      expect(resized).toMatchObject({ id: booked.id, status: 'confirmed' });
      expect(new Date(resized.endsAt).getTime() - new Date(resized.startsAt).getTime()).toBe(
        45 * 60_000,
      );
    });

    it('does not move what has arrived', async () => {
      const patient = await newPatient();
      testApp.clock.set(NOW);
      const booked = await book(patient.id, at('15:00'));
      await post(desk.agent, `appointments/${booked.id}/check-in`);
      expect(
        await problem(reschedule(desk.agent, booked.id, { startsAt: at('16:00') })),
      ).toMatchObject({ status: 409, code: 'appointment.action_unavailable' });
    });
  });

  describe('status actions', () => {
    it('checks in today only and undoes a mistaken check-in', async () => {
      const patient = await newPatient();
      const today = await book(patient.id, at('13:00'), { confirmed: true });
      const later = await book(patient.id, at('13:00', freshDay()));
      expect(
        await problem(
          desk.agent.post(`/api/v1/scheduling/appointments/${later.id}/check-in`).send({}),
        ),
      ).toMatchObject({ code: 'appointment.action_unavailable' });
      const arrived = await post<Appointment>(desk.agent, `appointments/${today.id}/check-in`, {
        roomId: clinic.spareRoom.id,
      });
      expect(arrived).toMatchObject({ status: 'checked_in', roomId: clinic.spareRoom.id });
      expect(arrived.checkedInAt).not.toBeNull();
      const undone = await post<Appointment>(desk.agent, `appointments/${today.id}/undo-check-in`);
      expect(undone).toMatchObject({ status: 'confirmed', checkedInAt: null });
    });

    it('undoes a check-in only from arrived', async () => {
      const patient = await newPatient();
      const booked = await book(patient.id, at('13:30'));
      expect(
        await problem(
          desk.agent.post(`/api/v1/scheduling/appointments/${booked.id}/undo-check-in`).send({}),
        ),
      ).toMatchObject({ status: 409, code: 'appointment.action_unavailable' });
    });

    it('flags an unresolved appointment and marks it no-show', async () => {
      const patient = await newPatient();
      const booked = await book(patient.id, at('09:30'));
      expect(
        await problem(desk.agent.post(`/api/v1/scheduling/appointments/${booked.id}/no-show`)),
      ).toMatchObject({ code: 'appointment.action_unavailable' });
      testApp.clock.set(new Date('2026-06-15T07:30:00Z'));
      const board = await ok<TodayBoard>(
        desk.agent.get(`/api/v1/scheduling/today?branchId=${clinic.branch.id}`),
      );
      expect(board.appointments.find((item) => item.id === booked.id)?.unresolved).toBe(true);
      expect(board.unresolvedCount).toBeGreaterThan(0);
      const noShow = await post<Appointment>(desk.agent, `appointments/${booked.id}/no-show`);
      expect(noShow).toMatchObject({ status: 'no_show', unresolved: false });
    });

    it('changes a room, and a taken room answers a conflict', async () => {
      const [first, second] = [await newPatient(), await newPatient()];
      const day = freshDay();
      await book(first.id, at('10:00', day), { roomId: clinic.room.id });
      const booked = await book(second.id, at('10:00', day), {
        dentistId: leeId,
        roomId: clinic.spareRoom.id,
      });
      expect(
        await problem(
          desk.agent
            .post(`/api/v1/scheduling/appointments/${booked.id}/room`)
            .send({ roomId: clinic.room.id }),
        ),
      ).toMatchObject({ status: 409, code: 'appointment.conflict' });
      const none = await post<Appointment>(desk.agent, `appointments/${booked.id}/room`, {
        roomId: null,
      });
      expect(none).toMatchObject({ roomId: null, roomAuto: false });
    });
  });

  describe('restore and edit (ADR-0075)', () => {
    const cancel = (id: string) =>
      post<Appointment>(desk.agent, `appointments/${id}/cancel`, { reason: 'Travelling' });
    const restore = (id: string, body: object = {}) =>
      desk.agent.post(`/api/v1/scheduling/appointments/${id}/restore`).send(body);
    const edit = (agent: TestAgent, id: string, body: object, key = newId()) =>
      agent.patch(`/api/v1/scheduling/appointments/${id}`).set('Idempotency-Key', key).send(body);
    const formOf = (row: Appointment) => ({
      dentistId: row.dentistId,
      startsAt: row.startsAt,
      durationMin: (Date.parse(row.endsAt) - Date.parse(row.startsAt)) / 60_000,
      reason: row.reason,
      visitType: row.visitType,
      roomId: row.roomAuto ? 'auto' : row.roomId,
      confirmed: row.status === 'confirmed',
      override: true,
    });

    it('restores the same row to the status it had, and audits it', async () => {
      const patient = await newPatient();
      const day = freshDay();
      const confirmed = await book(patient.id, at('10:00', day), { confirmed: true });
      const unconfirmed = await book((await newPatient()).id, at('11:00', day));
      await cancel(confirmed.id);
      await cancel(unconfirmed.id);
      const back = await ok<Appointment>(restore(confirmed.id));
      expect(back).toMatchObject({ id: confirmed.id, status: 'confirmed', cancelReason: null });
      expect((await ok<Appointment>(restore(unconfirmed.id))).status).toBe('booked');
      const page = await ok<AuditPage>(
        owner.get(`/api/v1/audit?area=schedule&patientId=${patient.id}`),
      );
      expect(page.items.map((item) => item.action)).toContain('appointment.restore');
      expect(await problem(restore(confirmed.id))).toMatchObject({
        status: 409,
        code: 'appointment.action_unavailable',
      });
    });

    it('refuses once the start has passed', async () => {
      const booked = await book((await newPatient()).id, at('15:00'));
      await cancel(booked.id);
      testApp.clock.set(new Date('2026-06-15T12:30:00Z'));
      expect(await problem(restore(booked.id))).toMatchObject({
        status: 409,
        code: 'appointment.action_unavailable',
      });
    });

    it('chooses an Auto room again and refuses a room picked by hand that is taken', async () => {
      const day = freshDay();
      const auto = await book((await newPatient()).id, at('10:00', day));
      const fixed = await book((await newPatient()).id, at('12:00', day), {
        roomId: clinic.room.id,
      });
      await cancel(auto.id);
      await cancel(fixed.id);
      const taken = { roomId: clinic.room.id, dentistId: leeId };
      await book((await newPatient()).id, at('10:00', day), taken);
      await book((await newPatient()).id, at('12:00', day), taken);
      expect((await ok<Appointment>(restore(auto.id))).roomId).toBe(clinic.spareRoom.id);
      expect(await problem(restore(fixed.id))).toMatchObject({
        status: 409,
        code: 'appointment.conflict',
      });
      expect((await appointment(fixed.id)).status).toBe('cancelled');
    });

    it('needs the override for a warning, and keeps a colleague to their column', async () => {
      const day = freshDay();
      const booked = await book((await newPatient()).id, at('10:00', day));
      await cancel(booked.id);
      await book((await newPatient()).id, at('10:00', day), { roomId: clinic.spareRoom.id });
      expect(await problem(restore(booked.id))).toMatchObject({
        status: 409,
        code: 'appointment.conflict',
      });
      const denied = await lee.agent
        .post(`/api/v1/scheduling/appointments/${booked.id}/restore`)
        .send({ override: true });
      expect(denied.status).toBe(403);
      const back = await ok<Appointment>(restore(booked.id, { override: true }));
      expect(back.overridden).toContain('dentist');
    });

    it('edits in place: reason, type, duration, room, and confirming', async () => {
      const booked = await book((await newPatient()).id, at('10:00', freshDay()));
      const edited = await ok<Appointment>(
        edit(desk.agent, booked.id, {
          ...formOf(booked),
          reason: 'Crown fitting',
          visitType: 'treatment',
          durationMin: 45,
          roomId: clinic.spareRoom.id,
          confirmed: true,
        }),
      );
      expect(edited).toMatchObject({
        id: booked.id,
        status: 'confirmed',
        reason: 'Crown fitting',
        visitType: 'treatment',
        roomId: clinic.spareRoom.id,
        roomAuto: false,
      });
      expect(Date.parse(edited.endsAt) - Date.parse(edited.startsAt)).toBe(45 * 60_000);
      const again = await ok<Appointment>(edit(desk.agent, booked.id, formOf(edited)));
      expect(again.updatedAt).toBe(edited.updatedAt);
    });

    it('keeps an Auto room in place while it is free', async () => {
      const day = freshDay();
      const other = await book((await newPatient()).id, at('10:00', day), {
        roomId: clinic.room.id,
        dentistId: leeId,
      });
      const auto = await book((await newPatient()).id, at('10:00', day));
      expect(auto.roomId).toBe(clinic.spareRoom.id);
      await cancel(other.id);
      const edited = await ok<Appointment>(
        edit(desk.agent, auto.id, { ...formOf(auto), reason: 'Review' }),
      );
      expect(edited).toMatchObject({ roomId: clinic.spareRoom.id, roomAuto: true });
    });

    it('edits in place without the override it was booked through, and keeps no room', async () => {
      const day = freshDay();
      await book((await newPatient()).id, at('10:00', day), { roomId: clinic.room.id });
      const overlap = await book((await newPatient()).id, at('10:00', day), {
        roomId: clinic.spareRoom.id,
      });
      expect(overlap.overridden).toContain('dentist');
      const reason = { ...formOf(overlap), reason: 'Review', override: false };
      expect((await ok<Appointment>(edit(reyes.agent, overlap.id, reason))).reason).toBe('Review');
      expect(
        await problem(edit(reyes.agent, overlap.id, { ...reason, durationMin: 45 })),
      ).toMatchObject({ status: 409, code: 'appointment.conflict' });

      await post(desk.agent, `appointments/${overlap.id}/room`, { roomId: null });
      const kept = await ok<Appointment>(
        edit(desk.agent, overlap.id, { ...reason, roomId: 'none', reason: 'Filling' }),
      );
      expect(kept).toMatchObject({ roomId: null, roomAuto: false, reason: 'Filling' });
    });

    it('moves on a new start or dentist: a new row in the lineage, with the form', async () => {
      const first = await book((await newPatient()).id, at('10:00', freshDay()), {
        confirmed: true,
      });
      const body = {
        ...formOf(first),
        startsAt: at('11:00', freshDay()),
        dentistId: leeId,
        reason: 'Extraction',
        confirmed: false,
      };
      const key = newId();
      const moved = await ok<Appointment>(edit(desk.agent, first.id, body, key));
      expect(moved).toMatchObject({
        status: 'booked',
        dentistName: 'Dr. Lee',
        reason: 'Extraction',
      });
      expect(moved.id).not.toBe(first.id);
      expect(moved.lineage.moves).toBe(1);
      expect((await appointment(first.id)).status).toBe('rescheduled');
      expect((await ok<Appointment>(edit(desk.agent, first.id, body, key))).id).toBe(moved.id);
      expect(
        await problem(edit(desk.agent, first.id, { ...body, reason: 'Other' }, key)),
      ).toMatchObject({ status: 409, code: 'appointment.idempotency_mismatch' });
    });

    it('refuses what has arrived, the past, and a column the caller cannot write', async () => {
      const arrived = await book((await newPatient()).id, at('15:00'));
      await post(desk.agent, `appointments/${arrived.id}/check-in`);
      expect(
        await problem(edit(desk.agent, arrived.id, { ...formOf(arrived), reason: 'Other' })),
      ).toMatchObject({ status: 409, code: 'appointment.action_unavailable' });
      const later = await book((await newPatient()).id, at('15:30'));
      expect(
        await problem(edit(desk.agent, later.id, { ...formOf(later), startsAt: at('08:00') })),
      ).toMatchObject({ code: 'appointment.in_past' });
      const theirs = await book((await newPatient()).id, at('10:00', freshDay()), {
        dentistId: leeId,
      });
      const edited = { ...formOf(theirs), reason: 'Review' };
      expect((await edit(reyes.agent, theirs.id, edited)).status).toBe(403);
      expect((await edit(desk.agent, theirs.id, edited)).status).toBe(200);
    });
  });

  describe('slots', () => {
    const slotsOf = (days: SlotDay[]): Slot[] => days.flatMap((day) => day.slots);
    const clock = (slot: Slot) =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Beirut',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(slot.startsAt));

    it('takes out the dentist, the patient and the closed day, a room per slot', async () => {
      const patient = await newPatient();
      const day = freshDay();
      await book((await newPatient()).id, at('09:00', day), { roomId: clinic.room.id });
      await book(patient.id, at('11:00', day), { dentistId: leeId, roomId: clinic.spareRoom.id });
      const days = await ok<SlotDay[]>(
        desk.agent.get('/api/v1/scheduling/slots').query({
          branchId: clinic.branch.id,
          dentistId: reyesId,
          patientId: patient.id,
          durationMin: 30,
          stepMin: 30,
          from: day,
          to: day,
        }),
      );
      const times = slotsOf(days).map(clock);
      expect(times).not.toContain('09:00');
      expect(times).not.toContain('11:00');
      expect(times).toContain('09:30');
      const free = slotsOf(days).find((slot) => clock(slot) === '09:30');
      expect(free?.roomId).not.toBeNull();
    });

    it('never offers the past, and shows warnings for move mode', async () => {
      const days = await ok<SlotDay[]>(
        desk.agent.get('/api/v1/scheduling/slots').query({
          branchId: clinic.branch.id,
          dentistId: reyesId,
          durationMin: 30,
          stepMin: 30,
          from: '2026-06-15',
          to: '2026-06-15',
        }),
      );
      expect(slotsOf(days).map(clock)[0]).toBe('09:00');
      const warned = await ok<SlotDay[]>(
        desk.agent.get('/api/v1/scheduling/slots').query({
          branchId: clinic.branch.id,
          dentistId: reyesId,
          durationMin: 30,
          stepMin: 30,
          from: '2026-06-15',
          to: '2026-06-15',
          includeWarnings: 'true',
        }),
      );
      const evening = slotsOf(warned).find((slot) => clock(slot) === '19:00');
      expect(evening?.warnings).toEqual(['outside_hours']);
    });

    it('refuses a range past two months', async () => {
      expect(
        await problem(
          desk.agent.get('/api/v1/scheduling/slots').query({
            branchId: clinic.branch.id,
            dentistId: reyesId,
            durationMin: 30,
            from: '2026-06-15',
            to: '2026-09-15',
          }),
        ),
      ).toMatchObject({ status: 422, code: 'appointment.invalid_range' });
    });
  });

  describe('visits and follow-ups', () => {
    const complete = (agent: TestAgent, visitId: string, nextAppointment?: object) =>
      agent
        .post(`/api/v1/visits/${visitId}/complete`)
        .send(nextAppointment ? { nextAppointment } : undefined);

    const finishVisit = async (patientId: string, nextAppointment?: object) => {
      const { visit } = await startVisit(reyes.agent, patientId);
      await ok(complete(reyes.agent, visit.id, nextAppointment));
      return visit;
    };

    const followUpOf = async (patientId: string): Promise<FollowUp> => {
      const [followUp] = await ok<FollowUp[]>(
        desk.agent.get(`/api/v1/scheduling/patients/${patientId}/follow-ups`),
      );
      if (!followUp) throw new Error('no follow-up');
      return followUp;
    };

    const worklist = () =>
      ok<FollowUp[]>(desk.agent.get(`/api/v1/scheduling/follow-ups?branchId=${clinic.branch.id}`));

    it('takes an appointment through a visit: start, discard, start, complete', async () => {
      const patient = await newPatient();
      const booked = await book(patient.id, at('16:00'));
      const { visit } = await startVisit(reyes.agent, patient.id, booked.id);
      expect(visit.appointmentId).toBe(booked.id);
      const started = await appointment(booked.id);
      expect(started.status).toBe('in_room');
      expect(started.checkedInAt).not.toBeNull();
      await ok(reyes.agent.post(`/api/v1/visits/${visit.id}/discard`));
      expect((await appointment(booked.id)).status).toBe('checked_in');
      const again = await startVisit(reyes.agent, patient.id, booked.id);
      await ok(complete(reyes.agent, again.visit.id));
      expect((await appointment(booked.id)).status).toBe('completed');
    });

    it('links a resumed visit to the appointment (G9)', async () => {
      const patient = await newPatient();
      const booked = await book(patient.id, at('16:30'));
      const { visit } = await startVisit(reyes.agent, patient.id);
      const resumed = await startVisit(reyes.agent, patient.id, booked.id, 200);
      expect(resumed).toMatchObject({ resumed: true, visit: { id: visit.id } });
      expect(resumed.visit.appointmentId).toBe(booked.id);
      expect((await appointment(booked.id)).status).toBe('in_room');
      await ok(reyes.agent.post(`/api/v1/visits/${visit.id}/discard`));
    });

    it('vetoes a start on someone else’s appointment or a closed one', async () => {
      const [patient, other] = [await newPatient(), await newPatient()];
      const booked = await book(other.id, at('17:00'));
      const wrong = await problem(
        reyes.agent.post('/api/v1/visits').send({
          patientId: patient.id,
          dentistId: reyesId,
          roomId: clinic.room.id,
          type: 'examination',
          appointmentId: booked.id,
        }),
      );
      expect(wrong).toMatchObject({ status: 422, code: 'appointment.not_for_patient' });
      const live = await ok<{ id: string }[]>(
        owner.get(`/api/v1/visits/live?patientId=${patient.id}`),
      );
      expect(live).toEqual([]);
    });

    it('lets a colleague start a visit from a dentist’s appointment (G10)', async () => {
      const patient = await newPatient();
      const booked = await book(patient.id, at('17:30'), { dentistId: leeId });
      const { visit } = await startVisit(reyes.agent, patient.id, booked.id);
      expect((await appointment(booked.id)).status).toBe('in_room');
      await ok(reyes.agent.post(`/api/v1/visits/${visit.id}/discard`));
    });

    it('creates the follow-up with the completion, due from the visit date', async () => {
      const patient = await newPatient();
      const visit = await finishVisit(patient.id, {
        ...NEXT,
        note: 'Prefers afternoons',
        clinicalPrep: 'Allow extra time',
      });
      const followUp = await followUpOf(patient.id);
      expect(followUp).toMatchObject({
        status: 'awaiting',
        dueOn: '2026-06-22',
        expiresOn: '2026-07-22',
        sourceVisitId: visit.id,
        recommendedByName: 'Dr. Reyes',
        preferredDentistId: reyesId,
        preferredDentistAvailable: true,
      });
      expect((await worklist()).map((item) => item.id)).toContain(followUp.id);
    });

    it('rolls the completion back when the follow-up cannot be created (A15)', async () => {
      const patient = await newPatient();
      const { visit } = await startVisit(reyes.agent, patient.id);
      const bad = await problem(
        complete(reyes.agent, visit.id, { ...NEXT, bookedAppointmentId: newId() }),
      );
      expect(bad.status).toBe(404);
      const after = await ok<{ status: string }>(reyes.agent.get(`/api/v1/visits/${visit.id}`));
      expect(after.status).toBe('in_progress');
      await ok(complete(reyes.agent, visit.id));
    });

    it('books before completion: the follow-up is created booked and held (A15)', async () => {
      const patient = await newPatient();
      const { visit } = await startVisit(reyes.agent, patient.id);
      const booked = await ok<Appointment>(
        bookRequest(reyes.agent, {
          patientId: patient.id,
          dentistId: reyesId,
          startsAt: at('09:30', freshDay()),
          sourceVisitId: visit.id,
        }),
        201,
      );
      await ok(complete(reyes.agent, visit.id, { ...NEXT, bookedAppointmentId: booked.id }));
      const followUp = await followUpOf(patient.id);
      expect(followUp).toMatchObject({ status: 'booked', appointmentId: booked.id });
      expect((await appointment(booked.id)).followUp?.title).toBe('Healing review');
    });

    it('leaves the follow-up awaiting when that appointment was cancelled since', async () => {
      const patient = await newPatient();
      const { visit } = await startVisit(reyes.agent, patient.id);
      const booked = await ok<Appointment>(
        bookRequest(reyes.agent, {
          patientId: patient.id,
          dentistId: reyesId,
          startsAt: at('09:45', freshDay()),
          sourceVisitId: visit.id,
        }),
        201,
      );
      await post(desk.agent, `appointments/${booked.id}/cancel`);
      await ok(complete(reyes.agent, visit.id, { ...NEXT, bookedAppointmentId: booked.id }));
      expect((await followUpOf(patient.id)).status).toBe('awaiting');
    });

    it('follows a booked appointment that was moved before completion (A15)', async () => {
      const patient = await newPatient();
      const { visit } = await startVisit(reyes.agent, patient.id);
      const booked = await ok<Appointment>(
        bookRequest(reyes.agent, {
          patientId: patient.id,
          dentistId: reyesId,
          startsAt: at('09:45', freshDay()),
          sourceVisitId: visit.id,
        }),
        201,
      );
      const moved = await ok<Appointment>(
        desk.agent
          .post(`/api/v1/scheduling/appointments/${booked.id}/reschedule`)
          .set('Idempotency-Key', newId())
          .send({ startsAt: at('10:45', freshDay()) }),
      );
      await ok(complete(reyes.agent, visit.id, { ...NEXT, bookedAppointmentId: booked.id }));
      expect(await followUpOf(patient.id)).toMatchObject({
        status: 'booked',
        appointmentId: moved.id,
      });
    });

    it('refuses a booked appointment from another visit, rolling back', async () => {
      const [patient, other] = [await newPatient(), await newPatient()];
      const foreign = await book(other.id, at('08:30', freshDay()));
      const { visit } = await startVisit(reyes.agent, patient.id);
      expect(
        await problem(
          complete(reyes.agent, visit.id, { ...NEXT, bookedAppointmentId: foreign.id }),
        ),
      ).toMatchObject({ code: 'appointment.not_for_patient' });
      await ok(reyes.agent.post(`/api/v1/visits/${visit.id}/discard`));
    });

    it('creates none on Skip', async () => {
      const patient = await newPatient();
      await finishVisit(patient.id);
      expect(
        await ok<FollowUp[]>(
          desk.agent.get(`/api/v1/scheduling/patients/${patient.id}/follow-ups`),
        ),
      ).toEqual([]);
    });

    const bookFollowUp = async (patientId: string) => {
      const followUp = await followUpOf(patientId);
      const booked = await book(patientId, at('10:00', freshDay()), { followUpId: followUp.id });
      return { followUp, booked };
    };

    it('books a follow-up off the list; a second booking of it is refused', async () => {
      const patient = await newPatient();
      await finishVisit(patient.id, NEXT);
      const { followUp } = await bookFollowUp(patient.id);
      expect((await followUpOf(patient.id)).status).toBe('booked');
      expect((await worklist()).map((item) => item.id)).not.toContain(followUp.id);
      expect(
        await problem(
          bookRequest(desk.agent, {
            patientId: patient.id,
            dentistId: reyesId,
            startsAt: at('12:00', freshDay()),
            followUpId: followUp.id,
          }),
        ),
      ).toMatchObject({ status: 409, code: 'follow_up.not_awaiting' });
    });

    it('moves the link on reschedule and keeps it booked (G6)', async () => {
      const patient = await newPatient();
      await finishVisit(patient.id, NEXT);
      const { booked } = await bookFollowUp(patient.id);
      const moved = await ok<Appointment>(
        desk.agent
          .post(`/api/v1/scheduling/appointments/${booked.id}/reschedule`)
          .set('Idempotency-Key', newId())
          .send({ startsAt: at('10:00', freshDay()) }),
      );
      expect(moved.followUp?.title).toBe('Healing review');
      expect(await followUpOf(patient.id)).toMatchObject({
        status: 'booked',
        appointmentId: moved.id,
      });
    });

    it('puts it back on cancel and on no-show, with a fresh window (G7)', async () => {
      const patient = await newPatient();
      await finishVisit(patient.id, NEXT);
      const { booked } = await bookFollowUp(patient.id);
      testApp.clock.set(new Date('2026-08-20T06:00:00Z'));
      await post(desk.agent, `appointments/${booked.id}/cancel`, { reason: 'Travelling' });
      const reopened = await followUpOf(patient.id);
      expect(reopened).toMatchObject({ status: 'awaiting', expired: false });
      expect(reopened.expiresOn).toBe('2026-09-19');
      expect((await worklist()).map((item) => item.id)).toContain(reopened.id);
      expect((await appointment(booked.id)).cancelReason).toBe('Travelling');
    });

    it('takes it back on restore while it is on the list, else drops the link (ADR-0075)', async () => {
      const patient = await newPatient();
      await finishVisit(patient.id, NEXT);
      const { followUp, booked } = await bookFollowUp(patient.id);
      await post(desk.agent, `appointments/${booked.id}/cancel`);
      const back = await post<Appointment>(desk.agent, `appointments/${booked.id}/restore`);
      expect(back.followUp?.id).toBe(followUp.id);
      expect(await followUpOf(patient.id)).toMatchObject({
        status: 'booked',
        appointmentId: booked.id,
      });

      await post(desk.agent, `appointments/${booked.id}/cancel`);
      const other = await book(patient.id, at('12:00', freshDay()), { followUpId: followUp.id });
      const restored = await post<Appointment>(desk.agent, `appointments/${booked.id}/restore`);
      expect(restored.followUp).toBeNull();
      expect((await followUpOf(patient.id)).appointmentId).toBe(other.id);
    });

    it('marks it done when its appointment completes', async () => {
      const patient = await newPatient();
      await finishVisit(patient.id, NEXT);
      const followUp = await followUpOf(patient.id);
      const booked = await book(patient.id, at('18:00'), { followUpId: followUp.id });
      const { visit } = await startVisit(reyes.agent, patient.id, booked.id);
      await ok(complete(reyes.agent, visit.id));
      expect((await followUpOf(patient.id)).status).toBe('done');
    });

    it('tags Will call, declines with a reason, and hides expired ones', async () => {
      const [called, declined, old] = [await newPatient(), await newPatient(), await newPatient()];
      await finishVisit(called.id, NEXT);
      await finishVisit(declined.id, NEXT);
      await finishVisit(old.id, NEXT);
      const tagged = await post<FollowUp>(
        desk.agent,
        `follow-ups/${(await followUpOf(called.id)).id}/will-call`,
      );
      expect(tagged.willCallByName).toBe('Jamie');
      expect((await worklist()).map((item) => item.id)).toContain(tagged.id);
      await post(desk.agent, `follow-ups/${(await followUpOf(declined.id)).id}/decline`, {
        reason: 'Travelling',
      });
      expect(await followUpOf(declined.id)).toMatchObject({
        status: 'declined',
        declinedReason: 'Travelling',
      });
      testApp.clock.set(new Date('2026-07-24T06:00:00Z'));
      expect(await followUpOf(old.id)).toMatchObject({ status: 'awaiting', expired: true });
      expect((await worklist()).map((item) => item.id)).not.toContain(
        (await followUpOf(old.id)).id,
      );
    });

    it('keeps the worklist from anyone without write_all', async () => {
      const response = await reyes.agent.get(
        `/api/v1/scheduling/follow-ups?branchId=${clinic.branch.id}`,
      );
      expect(response.status).toBe(403);
    });
  });

  describe('other modules’ changes', () => {
    it('refuses to archive a patient with an upcoming appointment (D2)', async () => {
      const patient = await newPatient();
      const booked = await book(patient.id, at('10:00', freshDay()));
      const archive = () => owner.post('/api/v1/patients/archive').send({ ids: [patient.id] });
      expect(await problem(archive())).toMatchObject({
        status: 409,
        code: 'patient.has_upcoming_appointments',
      });
      await post(desk.agent, `appointments/${booked.id}/cancel`);
      await ok(archive());
    });

    it('declines awaiting follow-ups on archive, not an unresolved past booking (G15)', async () => {
      const patient = await newPatient();
      const { visit } = await startVisit(reyes.agent, patient.id);
      await ok(
        reyes.agent.post(`/api/v1/visits/${visit.id}/complete`).send({ nextAppointment: NEXT }),
      );
      await book(patient.id, at('09:15'));
      testApp.clock.set(new Date('2026-06-15T10:00:00Z'));
      await ok(owner.post('/api/v1/patients/archive').send({ ids: [patient.id] }));
      const [followUp] = await ok<FollowUp[]>(
        desk.agent.get(`/api/v1/scheduling/patients/${patient.id}/follow-ups`),
      );
      expect(followUp).toMatchObject({ status: 'declined', declinedReason: 'Patient archived' });
    });

    it('refuses to move an archived patient’s past booking to a later time (D2)', async () => {
      const patient = await newPatient();
      const booked = await book(patient.id, at('09:15'));
      testApp.clock.set(new Date('2026-06-15T06:30:00Z'));
      await ok(owner.post('/api/v1/patients/archive').send({ ids: [patient.id] }));
      expect(
        await problem(
          desk.agent
            .post(`/api/v1/scheduling/appointments/${booked.id}/reschedule`)
            .set('Idempotency-Key', newId())
            .send({ startsAt: at('15:00') }),
        ),
      ).toMatchObject({ status: 409, code: 'patient.archived' });
    });

    it('names the patient when an archive is refused (D2)', async () => {
      const patient = await newPatient('Named Person');
      await book(patient.id, at('10:00', freshDay()));
      const refused = await problem(
        owner.post('/api/v1/patients/archive').send({ ids: [patient.id] }),
      );
      expect(refused).toMatchObject({ patientName: patient.fullName });
    });

    it('cancels the waiting side on merge when the dropped record has arrived (G14)', async () => {
      const [kept, dropped] = [await newPatient('Kept'), await newPatient('Dropped')];
      const mine = await book(kept.id, at('19:00'), { roomId: clinic.room.id });
      const arrived = await book(dropped.id, at('19:00'), {
        dentistId: leeId,
        roomId: clinic.spareRoom.id,
      });
      await post(desk.agent, `appointments/${arrived.id}/check-in`);
      await ok(
        owner
          .post('/api/v1/patients/merge')
          .send({ keepId: kept.id, dropId: dropped.id, reason: 'Same person' }),
      );
      expect((await appointment(mine.id)).status).toBe('cancelled');
      expect(await appointment(arrived.id)).toMatchObject({
        status: 'checked_in',
        patient: { id: kept.id },
      });
    });

    it('refuses a merge when both records have arrived for the same time (G14)', async () => {
      const [kept, dropped] = [await newPatient('Kept'), await newPatient('Dropped')];
      const first = await book(kept.id, at('20:30'), { roomId: clinic.room.id });
      const second = await book(dropped.id, at('20:30'), {
        dentistId: leeId,
        roomId: clinic.spareRoom.id,
      });
      await post(desk.agent, `appointments/${first.id}/check-in`);
      await post(desk.agent, `appointments/${second.id}/check-in`);
      expect(
        await problem(
          owner
            .post('/api/v1/patients/merge')
            .send({ keepId: kept.id, dropId: dropped.id, reason: 'Same person' }),
        ),
      ).toMatchObject({ status: 409, code: 'patient.merge_appointments_in_progress' });
    });

    it('re-points on merge, cancelling an overlap (G14)', async () => {
      const [kept, dropped] = [await newPatient('Kept'), await newPatient('Dropped')];
      const day = freshDay();
      const mine = await book(kept.id, at('10:00', day), { roomId: clinic.room.id });
      const overlap = await book(dropped.id, at('10:15', day), {
        dentistId: leeId,
        roomId: clinic.spareRoom.id,
      });
      const clear = await book(dropped.id, at('14:00', day));
      await ok(
        owner
          .post('/api/v1/patients/merge')
          .send({ keepId: kept.id, dropId: dropped.id, reason: 'Same person' }),
      );
      expect(await appointment(overlap.id)).toMatchObject({
        status: 'cancelled',
        cancelReason: 'Duplicate after merge',
      });
      expect((await appointment(clear.id)).patient.id).toBe(kept.id);
      expect((await appointment(mine.id)).status).toBe('booked');
    });

    it('refuses to deactivate a dentist with open appointments, signing nobody out (G16)', async () => {
      const dentist = await clinic.staff(['dentist'], 'Dr. Leaving');
      const users = await ok<StaffUser[]>(owner.get('/api/v1/users'));
      const profileId = users.find((user) => user.id === dentist.user.id)?.profileId ?? '';
      const patient = await newPatient();
      const booked = await book(patient.id, at('10:00'), { dentistId: profileId });
      const deactivate = () =>
        owner.post(`/api/v1/users/${dentist.user.id}/deactivate`).send({ reason: 'Left' });
      expect(await problem(deactivate())).toMatchObject({
        status: 409,
        code: 'staff.has_open_appointments',
      });
      const still = await ok<{ user: unknown }>(dentist.agent.get('/api/v1/session'));
      expect(still.user).toBeTruthy();
      await post(desk.agent, `appointments/${booked.id}/cancel`);
      await ok(deactivate());
      const range = await ok<Appointment[]>(
        desk.agent.get('/api/v1/scheduling/appointments').query({
          branchId: clinic.branch.id,
          from: '2026-06-15T00:00:00Z',
          to: '2026-06-16T00:00:00Z',
        }),
      );
      expect(range.map((item) => item.id)).not.toContain(booked.id);
      expect((await appointment(booked.id)).status, 'it stays on the record').toBe('cancelled');
    });

    it('seeds a new branch and follows its hours', async () => {
      const branch = await ok<{ id: string }>(
        owner.post('/api/v1/branches').send({ name: `North ${newId().slice(-6)}` }),
        201,
      );
      const hours = await ok<{ days: { weekday: number; isOpen: boolean; to: string }[] }>(
        desk.agent.get(`/api/v1/scheduling/branches/${branch.id}/opening-hours`),
      );
      expect(hours.days).toHaveLength(7);
      expect(hours.days.find((day) => day.weekday === 0)?.isOpen).toBe(false);
      const days = hours.days.map((day) => (day.weekday === 6 ? { ...day, to: '13:00' } : day));
      expect(
        (
          await desk.agent
            .put(`/api/v1/scheduling/branches/${branch.id}/opening-hours`)
            .send({ days })
        ).status,
      ).toBe(403);
      const saved = await ok<{ days: { weekday: number; to: string }[] }>(
        owner.put(`/api/v1/scheduling/branches/${branch.id}/opening-hours`).send({ days }),
      );
      expect(saved.days.find((day) => day.weekday === 6)?.to).toBe('13:00');
    });

    it('applies a changed window at once', async () => {
      const saved = await ok<{ followUpWindowDays: number }>(
        owner.put('/api/v1/scheduling/settings').send({ followUpWindowDays: 60 }),
      );
      expect(saved.followUpWindowDays).toBe(60);
      expect(
        await ok<{ followUpWindowDays: number }>(desk.agent.get('/api/v1/scheduling/settings')),
      ).toEqual({ followUpWindowDays: 60 });
      await ok(owner.put('/api/v1/scheduling/settings').send({ followUpWindowDays: 30 }));
    });
  });

  describe('quick patients', () => {
    it('needs a phone, flags the record, and clears when the important fields are in', async () => {
      const refused = await desk.agent
        .post('/api/v1/patients')
        .set('Idempotency-Key', newId())
        .send({ fullName: 'Zed Haddad', registrationIncomplete: true });
      expect(refused.status).toBe(400);
      const patient = await ok<Patient>(
        desk.agent
          .post('/api/v1/patients')
          .set('Idempotency-Key', newId())
          .send({
            fullName: `Zed ${newId().slice(-6)}`,
            phone: '+96170111222',
            registrationIncomplete: true,
          }),
        201,
      );
      expect(patient.registrationIncomplete).toBe(true);
      const partly = await ok<Patient>(
        desk.agent.patch(`/api/v1/patients/${patient.id}`).send({ dateOfBirth: '1990-01-01' }),
      );
      expect(partly.registrationIncomplete).toBe(true);
      const done = await ok<Patient>(
        desk.agent.patch(`/api/v1/patients/${patient.id}`).send({ sex: 'male' }),
      );
      expect(done.registrationIncomplete).toBe(false);
    });

    it('matches a duplicate by name or phone without a date of birth', async () => {
      const name = `Dup ${newId().slice(-6)}`;
      const phone = `+9617${Math.floor(1_000_000 + Math.random() * 8_000_000)}`;
      await ok(
        owner
          .post('/api/v1/patients')
          .set('Idempotency-Key', newId())
          .send({ fullName: name, phone, dateOfBirth: '1980-02-02' }),
        201,
      );
      const check = (query: Record<string, string>) =>
        ok<{ fullName: string }[]>(
          desk.agent.get('/api/v1/patients/duplicates/check').query(query),
        );
      expect(await check({ fullName: name })).toHaveLength(1);
      expect(await check({ fullName: 'Nobody Here', phone })).toHaveLength(1);
      expect(await check({ fullName: name, dateOfBirth: '1999-09-09' })).toHaveLength(0);
    });
  });
});
