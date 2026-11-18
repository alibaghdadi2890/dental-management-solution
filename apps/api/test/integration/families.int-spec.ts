import type {
  FamilyLinkResult,
  FamilySuggestion,
  Patient,
  PatientContact,
  ProblemDetails,
} from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../src/platform/kernel/id';
import { ok, provisionClinic, type TestClinic } from '../support/clinic';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { createTestApp, type TestApp } from '../support/test-app';

const CHILD_DOB = '2016-03-01';

/** Possible families on the Patients list (families B, ADR-0093). */
describe('patients: possible families (families B)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let main: TestClinic;
  let other: TestClinic;

  const createPatient = (agent: TestAgent, body: Record<string, unknown>) =>
    ok<Patient>(agent.post('/api/v1/patients').set('Idempotency-Key', newId()).send(body), 201);
  const contactsOf = (agent: TestAgent, patientId: string) =>
    ok<PatientContact[]>(agent.get(`/api/v1/patients/${patientId}/contacts`));
  const families = (agent: TestAgent) =>
    ok<FamilySuggestion[]>(agent.get('/api/v1/patients/families'));
  const familyOf = async (agent: TestAgent, patientId: string) =>
    (await families(agent)).find((family) =>
      family.patients.some((patient) => patient.id === patientId),
    );
  const linkFamily = (agent: TestAgent, body: object) =>
    agent.post('/api/v1/patients/families/link').send(body);

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    main = await provisionClinic(testApp, 'Families');
    other = await provisionClinic(testApp, 'Elsewhere');
  }, 120_000);

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  it('lists people sharing a phone who are not one family, never those already linked', async () => {
    const lina = await createPatient(main.owner, {
      fullName: 'Lina Haddad',
      dateOfBirth: CHILD_DOB,
      phone: '71 650 001',
    });
    const omar = await createPatient(main.owner, {
      fullName: 'Omar Haddad',
      dateOfBirth: CHILD_DOB,
      phone: '71 650 001',
    });
    // Mona, a contact who is no patient, shares the phone: she is the guardian of another child.
    await createPatient(main.owner, {
      fullName: 'Kid Haddad',
      dateOfBirth: CHILD_DOB,
      contacts: [
        {
          target: { newContact: { fullName: 'Mona Haddad', phone: '71 650 001' } },
          relationship: 'parent',
          isGuardian: true,
        },
      ],
    });
    // Already one family: Rami links Sara, who shares his phone.
    const rami = await createPatient(main.owner, {
      fullName: 'Rami Saab',
      phone: '71 650 002',
      contacts: [
        {
          target: { newContact: { fullName: 'Sara Saab', phone: '71 650 002' } },
          relationship: 'spouse',
          isEmergencyContact: true,
        },
      ],
    });

    const family = await familyOf(main.owner, lina.id);
    expect(family).toMatchObject({
      phoneKey: '96171650001',
      phone: '+96171650001',
      sameFamilyName: true,
      contacts: [{ fullName: 'Mona Haddad' }],
    });
    expect(family?.patients.map((patient) => patient.id)).toEqual([lina.id, omar.id]);
    expect(await familyOf(main.owner, rami.id)).toBeUndefined();
    // Another clinic's patient with the same phone never joins.
    await createPatient(other.owner, { fullName: 'Lina Elsewhere', phone: '71 650 001' });
    expect((await familyOf(main.owner, lina.id))?.patients).toHaveLength(2);
    expect(await families(other.owner)).toEqual([]);
  });

  it('links a family to an existing contact: billing becomes primary, a link is widened', async () => {
    const lead = await createPatient(main.owner, {
      fullName: 'Lead Child',
      dateOfBirth: CHILD_DOB,
      contacts: [
        {
          target: { newContact: { fullName: 'Rola Aoun', phone: '71 651 001' } },
          relationship: 'parent',
          isGuardian: true,
        },
      ],
    });
    const [rola] = await contactsOf(main.owner, lead.id);
    const rolaId = rola?.contact.id ?? '';
    // Hadi already links Rola as an emergency contact; Jana pays through someone else.
    const hadi = await createPatient(main.owner, {
      fullName: 'Hadi Aoun',
      dateOfBirth: CHILD_DOB,
      phone: '71 651 001',
      contacts: [
        { target: { contactId: rolaId }, relationship: 'parent', isEmergencyContact: true },
      ],
    });
    const jana = await createPatient(main.owner, {
      fullName: 'Jana Aoun',
      dateOfBirth: CHILD_DOB,
      phone: '71 651 001',
      contacts: [
        {
          target: { newContact: { fullName: 'Old Payer', phone: '71 651 099' } },
          relationship: 'other',
          isBillingContact: true,
        },
      ],
    });
    expect(await familyOf(main.owner, jana.id)).toBeDefined();

    const result = await ok<FamilyLinkResult>(
      linkFamily(main.owner, {
        payer: { contactId: rolaId },
        members: [
          { patientId: hadi.id, relationship: 'parent', isGuardian: true, isBillingContact: true },
          { patientId: jana.id, relationship: 'parent', isBillingContact: true },
        ],
      }),
    );
    expect(result).toEqual({ linked: 2 });
    const hadiRola = (await contactsOf(main.owner, hadi.id)).find(
      (link) => link.contact.id === rolaId,
    );
    expect(hadiRola).toMatchObject({
      isGuardian: true,
      isBillingContact: true,
      isEmergencyContact: true,
      isPrimaryBilling: true,
    });
    const janaRola = (await contactsOf(main.owner, jana.id)).find(
      (link) => link.contact.id === rolaId,
    );
    expect(janaRola).toMatchObject({ isBillingContact: true, isPrimaryBilling: true });
    expect(await familyOf(main.owner, jana.id)).toBeUndefined();
  });

  it('links children to a parent who is a patient, or to someone new', async () => {
    const father = await createPatient(main.owner, {
      fullName: 'Fadi Nassar',
      phone: '71 652 001',
    });
    const son = await createPatient(main.owner, {
      fullName: 'Karim Nassar',
      dateOfBirth: CHILD_DOB,
      phone: '71 652 001',
    });
    await ok(
      linkFamily(main.owner, {
        payer: { patientId: father.id },
        members: [
          { patientId: son.id, relationship: 'parent', isGuardian: true, isBillingContact: true },
        ],
      }),
    );
    const [link] = await contactsOf(main.owner, son.id);
    expect(link?.contact.linkedPatient?.id).toBe(father.id);
    expect(await familyOf(main.owner, son.id)).toBeUndefined();

    const first = await createPatient(main.owner, { fullName: 'Twin One', phone: '71 653 001' });
    const second = await createPatient(main.owner, { fullName: 'Twin Two', phone: '71 653 001' });
    await ok(
      linkFamily(main.owner, {
        payer: { newContact: { fullName: 'Grandma Twin', phone: '71 653 001' } },
        members: [
          { patientId: first.id, relationship: 'other', isBillingContact: true },
          { patientId: second.id, relationship: 'other', isBillingContact: true },
        ],
      }),
    );
    const [a] = await contactsOf(main.owner, first.id);
    const [b] = await contactsOf(main.owner, second.id);
    expect(a?.contact.fullName).toBe('Grandma Twin');
    expect(b?.contact.id).toBe(a?.contact.id);
  });

  it('keeps "Not a family" until someone new shares the phone', async () => {
    const one = await createPatient(main.owner, { fullName: 'Nour Karam', phone: '71 654 001' });
    const two = await createPatient(main.owner, { fullName: 'Ziad Daher', phone: '71 654 001' });
    const family = await familyOf(main.owner, one.id);
    expect(family?.sameFamilyName).toBe(false);
    await ok(
      main.owner.post('/api/v1/patients/families/dismiss').send({
        phoneKey: family?.phoneKey,
        people: [one.id, two.id],
      }),
      204,
    );
    expect(await familyOf(main.owner, one.id)).toBeUndefined();
    const third = await createPatient(main.owner, { fullName: 'Rima Karam', phone: '71 654 001' });
    expect((await familyOf(main.owner, one.id))?.patients.map((p) => p.id)).toEqual([
      one.id,
      third.id,
      two.id,
    ]);
  });

  it("refuses another clinic's patient as a member or as the payer", async () => {
    const mine = await createPatient(main.owner, { fullName: 'Mine Only', phone: '71 655 001' });
    const theirs = await createPatient(other.owner, {
      fullName: 'Theirs Only',
      phone: '71 655 001',
    });
    const asMember = await linkFamily(main.owner, {
      payer: { patientId: mine.id },
      members: [{ patientId: theirs.id, relationship: 'other', isBillingContact: true }],
    });
    expect(asMember.status).toBe(422);
    expect((asMember.body as ProblemDetails).errors).toEqual([
      expect.objectContaining({ path: 'members.0.patientId', code: 'not_found' }),
    ]);
    const asPayer = await linkFamily(main.owner, {
      payer: { patientId: theirs.id },
      members: [{ patientId: mine.id, relationship: 'other', isBillingContact: true }],
    });
    expect(asPayer.status).toBe(422);
    expect(await contactsOf(main.owner, mine.id)).toEqual([]);
  });
});
