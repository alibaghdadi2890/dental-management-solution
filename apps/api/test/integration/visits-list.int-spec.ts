import type {
  Branch,
  OwingCount,
  Patient,
  PatientPage,
  Room,
  ServiceItem,
  StaffUser,
  StartVisitResult,
  Tenant,
  UnpaidVisitsSummary,
  Visit,
  VisitBalance,
  VisitListSummary,
  VisitPage,
  VisitResult,
  VisitStats,
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
/** Older than 90 days, younger than 180: in "All" and "12 months", not in the default 90 days. */
const OLD_DAY = '2026-02-01';

describe('clinical + billing: the visits list, its summary and the visit-based patient views (4b)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let tenant: Tenant;
  let owner: TestAgent;
  let dentist: { agent: TestAgent; user: StaffUser };
  let room: Room;
  let filling: ServiceItem;
  let alba: Patient;
  let bruno: Patient;
  let carla: Patient;
  let albaToday: Visit;
  let albaOld: string;
  let brunoVoided: Visit;
  let carlaLive: Visit;

  const ok = async <T>(request: PromiseLike<{ status: number; body: unknown }>, status = 200) => {
    const response = await request;
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    return response.body as T;
  };

  const createPatient = (fullName: string) =>
    ok<Patient>(owner.post('/api/v1/patients').send({ fullName, phone: '71 000 000' }), 201);

  const start = async (patient: Patient, roomId?: string) =>
    (
      await ok<StartVisitResult>(
        dentist.agent.post('/api/v1/visits').send({
          patientId: patient.id,
          dentistId: dentist.user.profileId,
          ...(roomId ? { roomId } : { roomId: room.id }),
        }),
        201,
      )
    ).visit;

  const completedVisit = async (patient: Patient) => {
    const visit = await start(patient);
    await ok(
      dentist.agent
        .post(`/api/v1/visits/${visit.id}/services`)
        .send({ procedureId: filling.id, toothCode: '16', surfaces: ['O'] }),
      201,
    );
    return (await ok<VisitResult>(dentist.agent.post(`/api/v1/visits/${visit.id}/complete`))).visit;
  };

  const ids = (page: { items: { id: string }[] }) => page.items.map((item) => item.id);

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    testApp.clock.set(new Date(NOON));
    const admin = await signIn(testApp.app, await createPlatformAdmin(testApp.app), undefined, {
      rememberMe: true,
    });
    const ownerEmail = uniqueEmail('owner');
    const provisioned = await admin.post('/api/v1/platform/tenants').send({
      clinic: { name: 'List Clinic', slug: `lst-${newId().slice(-12)}` },
      firstBranch: { name: 'List Main' },
      owner: { displayName: 'List Owner', email: ownerEmail, temporaryPassword: TEMPORARY },
    });
    expect(provisioned.status, JSON.stringify(provisioned.body)).toBe(201);
    tenant = provisioned.body as Tenant;
    owner = await signInAndSetPassword(testApp.app, ownerEmail, TEMPORARY);
    const [branch] = (await owner.get('/api/v1/branches')).body as Branch[];
    if (!branch) throw new Error('provisioning created no branch');
    const rooms = await ok<Room[]>(
      owner.post('/api/v1/rooms/batch').send({
        items: [
          { branchId: branch.id, name: 'Room 1', code: 'R1', active: true },
          { branchId: branch.id, name: 'Room 2', code: 'R2', active: true },
        ],
      }),
    );
    const [first, second] = rooms;
    if (!first || !second) throw new Error('room batch returned too few rooms');
    room = first;
    const services = await ok<ServiceItem[]>(
      owner.put('/api/v1/catalog/services').send({
        items: [{ code: 'ZFILL', name: 'Listing filling', chargeUnit: 'per_tooth', price: '50' }],
      }),
    );
    const found = services.find((item) => item.code === 'ZFILL');
    if (!found) throw new Error('no filling');
    filling = found;

    const email = uniqueEmail('dentist');
    const user = await ok<StaffUser>(
      owner.post('/api/v1/users').send({
        displayName: 'Dr List',
        email,
        practitionerType: 'dentist',
        roleKeys: ['dentist'],
        branchIds: [branch.id],
        temporaryPassword: TEMPORARY,
      }),
      201,
    );
    dentist = { agent: await signInAndSetPassword(testApp.app, email, TEMPORARY), user };

    alba = await createPatient('Alba Listing');
    bruno = await createPatient('Bruno Listing');
    carla = await createPatient('Carla Listing');

    // Alba: a visit 129 days ago (written directly) and one today.
    albaOld = newId();
    await database.ownerPool.query(
      `with minted as (
         insert into visit_counters (tenant_id, last_value) values ($2, 1)
         on conflict (tenant_id) do update set last_value = visit_counters.last_value + 1
         returning last_value
       )
       insert into visits (id, tenant_id, display_number, patient_id, branch_id, dentist_id,
                           started_by, status, local_date, started_at, completed_at, completed_by,
                           duration_minutes, currency, subtotal, discount_amount, total)
       select $1, $2, minted.last_value, $3, $4, $5, $6, 'completed', $7::date,
              ($7 || 'T09:00:00Z')::timestamptz, ($7 || 'T09:30:00Z')::timestamptz, $6, 30,
              'USD', 20, 0, 20
       from minted`,
      [albaOld, tenant.id, alba.id, branch.id, dentist.user.profileId, dentist.user.id, OLD_DAY],
    );
    albaToday = await completedVisit(alba);
    // Bruno: a discarded visit, then a completed one, voided.
    const discarded = await start(bruno);
    await ok(dentist.agent.post(`/api/v1/visits/${discarded.id}/discard`));
    const brunoDone = await completedVisit(bruno);
    brunoVoided = (
      await ok<VisitResult>(
        dentist.agent
          .post(`/api/v1/visits/${brunoDone.id}/void`)
          .send({ expectedUpdatedAt: brunoDone.updatedAt, reason: 'Wrong patient' }),
      )
    ).visit;
    // Carla: live in Room 2.
    carlaLive = await start(carla, second.id);
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  it('lists, filters, pages and sums the branch visits', async () => {
    const all = await ok<VisitPage>(owner.get('/api/v1/visits'));
    expect(ids(all)).toEqual([carlaLive.id, brunoVoided.id, albaToday.id]);
    const live = all.items[0];
    expect(live).toMatchObject({
      status: 'in_progress',
      displayNumber: carlaLive.displayNumber,
      patient: { id: carla.id, fullName: 'Carla Listing', displayNumber: carla.displayNumber },
      dentist: { id: dentist.user.profileId, name: 'Dr List' },
      room: { name: 'Room 2' },
      total: '0.00',
    });
    expect(all.items[2]).toMatchObject({
      status: 'completed',
      total: '50.00',
      services: [{ name: 'Listing filling', toothCode: '16', final: { amount: '50.00' } }],
    });

    const query = async (search: string) =>
      ids(await ok<VisitPage>(owner.get(`/api/v1/visits?${search}`)));
    expect(await query('range=all')).toEqual([carlaLive.id, brunoVoided.id, albaToday.id, albaOld]);
    expect(await query('range=30d&tab=in_progress')).toEqual([carlaLive.id]);
    expect(await query('tab=voided_amended')).toEqual([brunoVoided.id]);
    expect(await query(`range=all&patientId=${alba.id}&tab=history`)).toEqual([
      albaToday.id,
      albaOld,
    ]);
    expect(await query(`roomId=${room.id}`)).toEqual([brunoVoided.id, albaToday.id]);
    expect(await query('q=bruno')).toEqual([brunoVoided.id]);
    expect(await query(`q=V-${String(albaToday.displayNumber).padStart(6, '0')}`)).toEqual([
      albaToday.id,
    ]);
    expect(await query('q=listing%20fill')).toEqual([brunoVoided.id, albaToday.id]);

    const walked: string[] = [];
    let cursor: string | null = null;
    do {
      const page: VisitPage = await ok<VisitPage>(
        owner.get(`/api/v1/visits?range=all&limit=1${cursor ? `&cursor=${cursor}` : ''}`),
      );
      walked.push(...ids(page));
      cursor = page.nextCursor;
    } while (cursor);
    expect(walked).toEqual([carlaLive.id, brunoVoided.id, albaToday.id, albaOld]);

    expect(await ok<VisitListSummary>(owner.get('/api/v1/visits/summary?range=all'))).toEqual({
      count: 4,
      billed: [{ currency: 'USD', amount: '70.00' }],
      tabs: { all: 4, inProgress: 1, voidedAmended: 1, today: 3 },
    });
    const bad = await owner.get('/api/v1/visits?cursor=nope');
    expect(bad.status).toBe(422);
  });

  it('answers the patients list columns and the not-seen views from counted visits', async () => {
    expect(
      await ok<VisitStats>(
        owner.get(
          `/api/v1/clinical/patients/visit-stats?patientIds=${alba.id},${bruno.id},${carla.id}`,
        ),
      ),
    ).toEqual([
      { patientId: alba.id, lastVisitDate: TODAY, visitCount: 2 },
      { patientId: bruno.id, lastVisitDate: null, visitCount: 0 },
      { patientId: carla.id, lastVisitDate: null, visitCount: 0 },
    ]);
    const names = (page: PatientPage) => page.items.map((patient) => patient.fullName).sort();
    expect(
      names(await ok<PatientPage>(owner.get('/api/v1/billing/patients?view=notSeen'))),
    ).toEqual(['Bruno Listing', 'Carla Listing']);
    expect(
      names(await ok<PatientPage>(owner.get('/api/v1/billing/patients?lastVisit=never'))),
    ).toEqual(['Bruno Listing', 'Carla Listing']);
    expect(await ok<OwingCount>(owner.get('/api/v1/billing/patients/not-seen-count'))).toEqual({
      count: 2,
    });
  });

  it('serves visit balances, the Unpaid tab and the visits export', async () => {
    expect(
      await ok<VisitBalance[]>(
        owner.get(
          `/api/v1/billing/visits/balances?visitIds=${albaToday.id},${brunoVoided.id},${carlaLive.id}`,
        ),
      ),
    ).toEqual([
      {
        visitId: albaToday.id,
        currency: 'USD',
        charged: '50.00',
        paid: '0.00',
        outstanding: '50.00',
      },
      {
        visitId: brunoVoided.id,
        currency: 'USD',
        charged: '0.00',
        paid: '0.00',
        outstanding: '0.00',
      },
    ]);
    expect(ids(await ok<VisitPage>(owner.get('/api/v1/billing/visits/unpaid?range=all')))).toEqual([
      albaToday.id,
    ]);
    expect(
      await ok<UnpaidVisitsSummary>(owner.get('/api/v1/billing/visits/unpaid/summary')),
    ).toEqual({ count: 1, billed: [{ currency: 'USD', amount: '50.00' }], tabCount: 1 });

    const csv = await owner.get('/api/v1/billing/visits/export?range=all&lang=en');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const [header, ...rows] = csv.text.replace('﻿', '').trim().split('\r\n');
    expect(header).toBe(
      'Visit,Date,Time,Room,Patient,Patient ID,Dentist,Services,Subtotal,Discount,Total,Paid,Balance,Status',
    );
    expect(rows).toHaveLength(4);
    expect(rows[2]).toBe(
      `V-${String(albaToday.displayNumber).padStart(6, '0')},${TODAY},12:00,Room 1,Alba Listing,${alba.displayNumber},Dr List,Listing filling #16,50.00,0.00,50.00,0.00,50.00,Completed`,
    );
  });
});
