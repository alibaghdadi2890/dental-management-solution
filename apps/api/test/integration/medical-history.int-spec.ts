import type {
  AuditEntry,
  AuditPage,
  Branch,
  MedicalOption,
  Patient,
  PatientPage,
  ProblemDetails,
  Tenant,
} from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../src/platform/kernel/id';
import { historyInput, medicalOptions } from '../support/medical-options';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { createPlatformAdmin, signIn, signInAndSetPassword, uniqueEmail } from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';

const TEMPORARY = 'temporary-pw-1';
const OPTIONS = '/api/v1/medical-history/options';

interface Clinic {
  tenant: Tenant;
  owner: TestAgent;
  branch: Branch;
}

const problem = (body: unknown) => body as ProblemDetails;
const names = (options: MedicalOption[], kind: MedicalOption['kind']) =>
  options.filter((option) => option.kind === kind).map((option) => option.name);

describe('patients: medical history and its lists (feature 10, ADR-0046)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let admin: TestAgent;
  let main: Clinic;
  let dentist: TestAgent;

  const provision = async (name: string): Promise<Clinic> => {
    const ownerEmail = uniqueEmail('owner');
    const response = await admin.post('/api/v1/platform/tenants').send({
      clinic: { name, slug: `med-${newId().slice(-12)}` },
      firstBranch: { name: `${name} Main` },
      owner: { displayName: `${name} Owner`, email: ownerEmail, temporaryPassword: TEMPORARY },
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const owner = await signInAndSetPassword(testApp.app, ownerEmail, TEMPORARY);
    const [branch] = (await owner.get('/api/v1/branches')).body as Branch[];
    if (!branch) throw new Error('provisioning created no branch');
    return { tenant: response.body as Tenant, owner, branch };
  };

  const createPatient = async (agent: TestAgent, body: Record<string, unknown>) => {
    const response = await agent
      .post('/api/v1/patients')
      .set('Idempotency-Key', newId())
      .send({ phone: '71 000 000', ...body });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as Patient;
  };

  const auditOf = async (agent: TestAgent, query: string): Promise<AuditEntry[]> =>
    ((await agent.get(`/api/v1/audit?${query}&limit=100`)).body as AuditPage).items;

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    admin = await signIn(testApp.app, await createPlatformAdmin(testApp.app), undefined, {
      rememberMe: true,
    });
    main = await provision('History Clinic');
    const email = uniqueEmail('dentist');
    const created = await main.owner.post('/api/v1/users').send({
      displayName: 'Dr. Dana',
      email,
      practitionerType: 'dentist',
      roleKeys: ['dentist'],
      branchIds: [main.branch.id],
      temporaryPassword: TEMPORARY,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    dentist = await signInAndSetPassword(testApp.app, email, TEMPORARY);
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  describe('the lists', () => {
    it('starts a clinic with the default allergies and conditions; seeding again adds nothing', async () => {
      const { all } = await medicalOptions(main.owner);
      expect(names(all, 'allergy')).toEqual([
        'Chlorhexidine',
        'Latex',
        'Local anaesthetic',
        'NSAIDs',
        'Penicillin',
      ]);
      expect(names(all, 'condition')).toContain('Hypertension');
      expect(all.every((option) => option.active)).toBe(true);
      const again = await main.owner.post(`${OPTIONS}/seed-default`);
      expect(again.body).toEqual({ created: 0 });
    });

    it('adds, renames and deactivates in one batch, and audits each row', async () => {
      const { id } = await medicalOptions(main.owner);
      const nsaids = id('allergy', 'NSAIDs');
      const saved = await main.owner.put(OPTIONS).send({
        items: [
          { kind: 'allergy', name: ' Sulfa ' },
          { id: nsaids, kind: 'allergy', name: 'NSAIDs (ibuprofen)', active: false },
        ],
      });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      const options = saved.body as MedicalOption[];
      expect(options.find((option) => option.name === 'Sulfa')).toMatchObject({
        kind: 'allergy',
        active: true,
      });
      expect(options.find((option) => option.id === nsaids)).toMatchObject({
        name: 'NSAIDs (ibuprofen)',
        active: false,
      });
      const actions = (await auditOf(main.owner, 'resourceType=medical_option')).map(
        (entry) => entry.action,
      );
      expect(actions).toContain('medical_option.create');
      expect(actions).toContain('medical_option.update');
    });

    it('refuses a name already in its list, whatever its case, and allows it in the other list', async () => {
      const taken = await main.owner
        .put(OPTIONS)
        .send({ items: [{ kind: 'allergy', name: 'latex' }] });
      expect(taken.status).toBe(422);
      expect(problem(taken.body).errors?.[0]).toMatchObject({
        path: 'items.0.name',
        code: 'duplicate',
      });
      const other = await main.owner
        .put(OPTIONS)
        .send({ items: [{ kind: 'condition', name: 'Latex sensitivity' }] });
      expect(other.status, JSON.stringify(other.body)).toBe(200);
    });

    it('swaps two names in one batch', async () => {
      const { id } = await medicalOptions(main.owner);
      const hypertension = id('condition', 'Hypertension');
      const diabetes = id('condition', 'Diabetes');
      const swapped = await main.owner.put(OPTIONS).send({
        items: [
          { id: hypertension, kind: 'condition', name: 'Diabetes', active: true },
          { id: diabetes, kind: 'condition', name: 'Hypertension', active: true },
        ],
      });
      expect(swapped.status, JSON.stringify(swapped.body)).toBe(200);
      const names = new Map((swapped.body as MedicalOption[]).map((row) => [row.id, row.name]));
      expect(names.get(hypertension)).toBe('Diabetes');
      expect(names.get(diabetes)).toBe('Hypertension');
    });

    it('lets everyone read the lists and only catalog:write change them', async () => {
      expect((await dentist.get(OPTIONS)).status).toBe(200);
      const refused = await Promise.all([
        dentist.put(OPTIONS).send({ items: [{ kind: 'allergy', name: 'Iodine' }] }),
        dentist.post(`${OPTIONS}/seed-default`),
        dentist.delete(`${OPTIONS}/${newId()}`),
        dentist.post(`${OPTIONS}/${newId()}/deactivate`),
      ]);
      for (const response of refused) expect(response.status).toBe(403);
    });

    it('deletes an unused option, and only deactivates one a patient has', async () => {
      const added = await main.owner.put(OPTIONS).send({
        items: [
          { kind: 'allergy', name: 'Iodine' },
          { kind: 'allergy', name: 'Aspirin' },
        ],
      });
      const options = added.body as MedicalOption[];
      const iodine = options.find((option) => option.name === 'Iodine')?.id ?? '';
      const aspirin = options.find((option) => option.name === 'Aspirin')?.id ?? '';
      const patient = await createPatient(main.owner, {
        fullName: 'Uses Aspirin',
        medicalHistory: historyInput({ allergyIds: [aspirin] }),
      });

      expect((await main.owner.delete(`${OPTIONS}/${iodine}`)).status).toBe(204);
      const inUse = await main.owner.delete(`${OPTIONS}/${aspirin}`);
      expect(inUse.status).toBe(409);
      expect(problem(inUse.body).code).toBe('medical_option.in_use');

      const off = await main.owner.post(`${OPTIONS}/${aspirin}/deactivate`);
      expect(off.body).toMatchObject({ id: aspirin, active: false });
      // It stays on the patient who has it, and can stay through an edit; nobody else picks it.
      const kept = await main.owner.patch(`/api/v1/patients/${patient.id}`).send({
        medicalHistory: historyInput({ allergyIds: [aspirin], medication: 'None' }),
      });
      expect(kept.status, JSON.stringify(kept.body)).toBe(200);
      expect((kept.body as Patient).medicalHistory.allergies).toEqual([
        { id: aspirin, name: 'Aspirin' },
      ]);
      const picked = await main.owner
        .post('/api/v1/patients')
        .set('Idempotency-Key', newId())
        .send({
          fullName: 'Picks Aspirin',
          phone: '71 000 001',
          medicalHistory: historyInput({ allergyIds: [aspirin] }),
        });
      expect(picked.status).toBe(422);
      expect(problem(picked.body).errors?.[0]).toMatchObject({
        path: 'medicalHistory.allergyIds.0',
        code: 'inactive_option',
      });
    });

    it('adds a typed name with patient:write: new once, found whatever its case, offered again', async () => {
      const first = await dentist.post(OPTIONS).send({ kind: 'allergy', name: '  Kiwi ' });
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      expect(first.body).toMatchObject({ kind: 'allergy', name: 'Kiwi', active: true });
      const kiwi = (first.body as MedicalOption).id;

      const again = await dentist.post(OPTIONS).send({ kind: 'allergy', name: 'KIWI' });
      expect(again.body).toMatchObject({ id: kiwi, name: 'Kiwi' });
      // The other list is another name space.
      const condition = await dentist.post(OPTIONS).send({ kind: 'condition', name: 'Kiwi' });
      expect((condition.body as MedicalOption).id).not.toBe(kiwi);

      // "Aspirin" was marked inactive above: typing it for a patient offers it again.
      const aspirin = await dentist.post(OPTIONS).send({ kind: 'allergy', name: 'aspirin' });
      expect(aspirin.body).toMatchObject({ name: 'Aspirin', active: true });

      const patient = await createPatient(dentist, {
        fullName: 'Allergic To Kiwi',
        medicalHistory: historyInput({ allergyIds: [kiwi] }),
      });
      expect(patient.medicalHistory.allergies).toEqual([{ id: kiwi, name: 'Kiwi' }]);

      const created = (await auditOf(main.owner, `resourceId=${kiwi}`)).map((e) => e.action);
      expect(created).toEqual(['medical_option.create']);
      expect((await dentist.post(OPTIONS).send({ kind: 'allergy', name: ' ' })).status).toBe(400);
    });
  });

  describe("a patient's history", () => {
    it('is "not asked" until entered, and stores allergies, conditions and medication', async () => {
      const { id } = await medicalOptions(main.owner);
      const blank = await createPatient(main.owner, { fullName: 'Not Asked' });
      expect(blank.medicalHistory).toEqual({
        noKnownAllergies: false,
        allergies: [],
        noConditions: false,
        conditions: [],
        medication: null,
      });

      const penicillin = id('allergy', 'Penicillin');
      const patient = await createPatient(main.owner, {
        fullName: 'Has History',
        firstVisitType: 'emergency',
        medicalHistory: historyInput({
          allergyIds: [penicillin],
          noConditions: true,
          medication: ' Warfarin 5 mg ',
        }),
      });
      expect(patient).toMatchObject({
        firstVisitType: 'emergency',
        medicalHistory: {
          noKnownAllergies: false,
          allergies: [{ id: penicillin, name: 'Penicillin' }],
          noConditions: true,
          conditions: [],
          medication: 'Warfarin 5 mg',
        },
      });
      // The list row carries the names for the chips, and the alerts filter finds it.
      const page = (await main.owner.get('/api/v1/patients?q=Has History')).body as PatientPage;
      expect(page.items[0]).toMatchObject({ allergyNames: ['Penicillin'], conditionNames: [] });
      const alerted = (await main.owner.get('/api/v1/patients?alerts=yes')).body as PatientPage;
      expect(alerted.items.map((item) => item.id)).toContain(patient.id);
      expect(alerted.items.map((item) => item.id)).not.toContain(blank.id);
    });

    it('replaces the history on an edit, audits it by name, and writes nothing when unchanged', async () => {
      const { id } = await medicalOptions(main.owner);
      const penicillin = id('allergy', 'Penicillin');
      const latex = id('allergy', 'Latex');
      const patient = await createPatient(main.owner, {
        fullName: 'Edited History',
        medicalHistory: historyInput({ allergyIds: [penicillin] }),
      });

      const edited = await dentist.patch(`/api/v1/patients/${patient.id}`).send({
        medicalHistory: historyInput({ allergyIds: [latex], conditionIds: [] }),
      });
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      expect((edited.body as Patient).medicalHistory.allergies).toEqual([
        { id: latex, name: 'Latex' },
      ]);
      const [entry] = await auditOf(main.owner, `resourceId=${patient.id}`);
      expect(entry).toMatchObject({
        action: 'patient.update',
        before: { medicalHistory: { allergies: [{ name: 'Penicillin' }] } },
        after: { medicalHistory: { allergies: [{ name: 'Latex' }] } },
      });

      const same = await dentist.patch(`/api/v1/patients/${patient.id}`).send({
        medicalHistory: historyInput({ allergyIds: [latex] }),
      });
      expect(same.status).toBe(200);
      expect(await auditOf(main.owner, `resourceId=${patient.id}`)).toHaveLength(2);
    });

    it('refuses "none" with items, an item of the other list and an unknown one', async () => {
      const { id } = await medicalOptions(main.owner);
      const send = (medicalHistory: unknown) =>
        main.owner
          .post('/api/v1/patients')
          .set('Idempotency-Key', newId())
          .send({ fullName: 'Bad History', phone: '71 000 002', medicalHistory });

      const both = await send({
        noKnownAllergies: true,
        allergyIds: [id('allergy', 'Penicillin')],
      });
      expect(both.status).toBe(400);
      const wrongList = await send(historyInput({ allergyIds: [id('condition', 'Asthma')] }));
      expect(wrongList.status).toBe(422);
      expect(problem(wrongList.body).errors?.[0]).toMatchObject({
        path: 'medicalHistory.allergyIds.0',
        code: 'unknown_option',
      });
      const unknown = await send(historyInput({ conditionIds: [newId()] }));
      expect(unknown.status).toBe(422);
    });
  });

  describe('tenant isolation', () => {
    it("keeps another clinic's lists and their options out of reach", async () => {
      const other = await provision('Other History Clinic');
      const theirs = await medicalOptions(other.owner);
      const penicillin = theirs.id('allergy', 'Penicillin');
      const before = (await other.owner.get(OPTIONS)).body as MedicalOption[];

      const mine = (await main.owner.get(OPTIONS)).body as MedicalOption[];
      expect(mine.map((option) => option.id)).not.toContain(penicillin);
      // Another clinic's option is not an option here, by any route.
      const picked = await main.owner
        .post('/api/v1/patients')
        .set('Idempotency-Key', newId())
        .send({
          fullName: 'Cross Tenant',
          phone: '71 000 003',
          medicalHistory: historyInput({ allergyIds: [penicillin] }),
        });
      expect(picked.status).toBe(422);
      const renamed = await main.owner
        .put(OPTIONS)
        .send({ items: [{ id: penicillin, kind: 'allergy', name: 'Taken over' }] });
      expect(renamed.status).toBe(404);
      expect((await main.owner.delete(`${OPTIONS}/${penicillin}`)).status).toBe(404);
      expect((await main.owner.post(`${OPTIONS}/${penicillin}/deactivate`)).status).toBe(404);

      expect((await other.owner.get(OPTIONS)).body).toEqual(before);
    });
  });
});
