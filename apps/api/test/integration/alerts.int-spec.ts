import type {
  AlertTray,
  Appointment,
  Patient,
  ProblemDetails,
  StaffUser,
  StartVisitResult,
} from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AlertHub } from '../../src/modules/alerts/application/alert-hub';
import { newId } from '../../src/platform/kernel/id';
import { ok, provisionClinic, type StaffMember, type TestClinic } from '../support/clinic';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { createTestApp, type TestApp } from '../support/test-app';

/** A Monday, 09:00 in the clinic's zone (UTC by default). */
const NOW = new Date('2026-06-15T09:00:00Z');

/** Feature 15: the tray of "Your patients", the follows, and the ping that refreshes it. */
describe('alerts: arrival alerts (feature 15)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let clinic: TestClinic;
  let other: TestClinic;
  let reyes: StaffMember;
  let lee: StaffMember;
  let mia: StaffMember;
  let desk: StaffMember;
  let reyesId: string;
  let leeId: string;

  const tray = (agent: TestAgent) => ok<AlertTray>(agent.get('/api/v1/alerts/tray'));
  const follow = (agent: TestAgent, dentistIds: string[]) =>
    agent.put('/api/v1/alerts/follows').send({ dentistIds });

  const newPatient = (name: string): Promise<Patient> =>
    ok<Patient>(
      clinic.owner
        .post('/api/v1/patients')
        .set('Idempotency-Key', newId())
        .send({ fullName: `${name} ${newId().slice(-6)}`, phone: '+96170123456' }),
      201,
    );

  /** Booked for later today with Dr. Reyes and checked in by the front desk. */
  let slot = 0;
  const arrived = async (patient: Patient): Promise<Appointment> => {
    slot += 1;
    const booked = await ok<Appointment>(
      desk.agent
        .post('/api/v1/scheduling/appointments')
        .set('Idempotency-Key', newId())
        .send({
          branchId: clinic.branch.id,
          patientId: patient.id,
          dentistId: reyesId,
          startsAt: new Date(NOW.getTime() + slot * 3_600_000).toISOString(),
          durationMin: 30,
          reason: 'Check-up',
          override: true,
        }),
      201,
    );
    return ok<Appointment>(
      desk.agent.post(`/api/v1/scheduling/appointments/${booked.id}/check-in`).send({}),
    );
  };

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    testApp.clock.set(NOW);
    clinic = await provisionClinic(testApp, 'Alerts');
    other = await provisionClinic(testApp, 'Elsewhere');
    reyes = await clinic.staff(['dentist'], 'Dr. Reyes');
    lee = await clinic.staff(['dentist'], 'Dr. Lee');
    mia = await clinic.staff(['assistant'], 'Mia', 'assistant');
    desk = await clinic.staff(['frontdesk'], 'Jamie', 'assistant');
    const users = await ok<StaffUser[]>(clinic.owner.get('/api/v1/users'));
    const profile = (id: string) => users.find((user) => user.id === id)?.profileId ?? '';
    reyesId = profile(reyes.user.id);
    leeId = profile(lee.user.id);
  }, 120_000);

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  it('shows the dentist and their followers who arrived, then who the front desk started', async () => {
    expect((await follow(mia.agent, [reyesId])).status).toBe(200);
    const patient = await newPatient('Sofia Mendes');
    const appointment = await arrived(patient);

    const forReyes = await tray(reyes.agent);
    expect(forReyes.waiting).toEqual([
      expect.objectContaining({
        appointmentId: appointment.id,
        patientId: patient.id,
        patientName: patient.fullName,
        dentistId: reyesId,
        dentistName: 'Dr. Reyes',
      }),
    ]);
    expect((await tray(mia.agent)).waiting.map((item) => item.appointmentId)).toEqual([
      appointment.id,
    ]);
    expect((await tray(mia.agent)).follows).toEqual([reyesId]);
    expect((await tray(lee.agent)).waiting).toEqual([]);

    // The front desk starts it once the patient is in the room (ADR-0074).
    const { visit } = await ok<StartVisitResult>(
      desk.agent.post('/api/v1/visits').send({
        patientId: patient.id,
        dentistId: reyesId,
        roomId: clinic.room.id,
        type: 'examination',
        appointmentId: appointment.id,
      }),
      201,
    );
    const after = await tray(reyes.agent);
    expect(after.waiting).toEqual([]);
    expect(after.inRoom).toEqual([
      expect.objectContaining({
        visitId: visit.id,
        patientName: patient.fullName,
        roomName: clinic.room.name,
        status: 'in_progress',
        startedBy: desk.user.id,
        startedByName: 'Jamie',
      }),
    ]);
    expect((await tray(mia.agent)).inRoom.map((item) => item.visitId)).toEqual([visit.id]);
    expect((await tray(lee.agent)).inRoom).toEqual([]);

    await ok(reyes.agent.post(`/api/v1/visits/${visit.id}/discard`).send({}));
    expect((await tray(reyes.agent)).inRoom).toEqual([]);
    expect((await follow(mia.agent, [])).status).toBe(200);
  });

  it('lets only who reads every visit follow other dentists, and only active dentists', async () => {
    const refused = await follow(lee.agent, [reyesId]);
    expect(refused.status).toBe(403);
    expect((await follow(lee.agent, [leeId])).status).toBe(200);

    const unknown = await follow(mia.agent, [newId()]);
    expect(unknown.status).toBe(422);
    expect((unknown.body as ProblemDetails).code).toBe('alerts.dentist_invalid');

    expect((await desk.agent.get('/api/v1/alerts/tray')).status).toBe(403);
    expect((await follow(desk.agent, [reyesId])).status).toBe(403);
  });

  it("keeps clinics apart: another clinic's patients never reach these trays", async () => {
    // Another clinic, its owner a dentist, with a patient checked in for them.
    const users = await ok<StaffUser[]>(other.owner.get('/api/v1/users'));
    const otherDentist =
      users.find((user) => user.displayName === 'Elsewhere Owner')?.profileId ?? '';
    const patient = await ok<Patient>(
      other.owner
        .post('/api/v1/patients')
        .set('Idempotency-Key', newId())
        .send({ fullName: `Far Away ${newId().slice(-6)}`, phone: '+96170123456' }),
      201,
    );
    const booked = await ok<Appointment>(
      other.owner
        .post('/api/v1/scheduling/appointments')
        .set('Idempotency-Key', newId())
        .send({
          branchId: other.branch.id,
          patientId: patient.id,
          dentistId: otherDentist,
          startsAt: new Date(NOW.getTime() + 30 * 60_000).toISOString(),
          durationMin: 30,
          reason: 'Check-up',
          override: true,
        }),
      201,
    );
    await ok(other.owner.post(`/api/v1/scheduling/appointments/${booked.id}/check-in`).send({}));
    expect((await tray(other.owner)).waiting.map((item) => item.patientId)).toEqual([patient.id]);

    // Following that dentist from here is refused; nothing of theirs shows here.
    const refused = await follow(mia.agent, [otherDentist]);
    expect(refused.status).toBe(422);
    for (const agent of [reyes.agent, mia.agent, clinic.owner]) {
      const mine = await tray(agent);
      expect(mine.waiting.map((item) => item.patientId)).not.toContain(patient.id);
    }
  });

  it("pings the clinic's open streams when a patient arrives, and no other clinic's", async () => {
    const hub = testApp.app.get(AlertHub);
    const pings = { mine: 0, theirs: 0 };
    const stopMine = hub.subscribe(clinic.tenant.id, () => {
      pings.mine += 1;
    });
    const stopTheirs = hub.subscribe(other.tenant.id, () => {
      pings.theirs += 1;
    });
    try {
      await arrived(await newPatient('Lina Haddad'));
      await expect.poll(() => pings.mine).toBeGreaterThan(0);
      expect(pings.theirs).toBe(0);
    } finally {
      stopMine();
      stopTheirs();
    }
    expect(hub.size(clinic.tenant.id)).toBe(0);
  });
});
