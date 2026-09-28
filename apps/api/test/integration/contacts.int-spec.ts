import type {
  AuditEntry,
  AuditPage,
  Branch,
  ContactLookupItem,
  ContactView,
  Patient,
  PatientContact,
  PatientListItem,
  PatientPage,
  ProblemDetails,
  StaffUser,
  Tenant,
} from '@dcm/contracts';
import type TestAgent from 'supertest/lib/agent';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContactsService } from '../../src/modules/patients';
import { PermissionDeniedError } from '../../src/platform/cls/permission-denied.error';
import { RequestContext } from '../../src/platform/cls/request-context';
import { newId } from '../../src/platform/kernel/id';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { createPlatformAdmin, signIn, signInAndSetPassword, uniqueEmail } from '../support/session';
import { createTestApp, type TestApp } from '../support/test-app';
import { asPlatformAdminIn } from '../support/tenants';

const TEMPORARY = 'temporary-pw-1';

/** A minor on any date this suite runs (the phone rule lets them go without a phone). */
const CHILD_DOB = '2018-05-01';

interface Clinic {
  tenant: Tenant;
  owner: TestAgent;
  branch: Branch;
}

type Roles = Partial<Record<'isGuardian' | 'isBillingContact' | 'isEmergencyContact', boolean>>;

const newContact = (fullName: string, phone: string) => ({ newContact: { fullName, phone } });

const linkInput = (target: object, relationship: string, roles: Roles = { isGuardian: true }) => ({
  target,
  relationship,
  ...roles,
});

const names = (contacts: PatientContact[]) => contacts.map((row) => row.contact.fullName);

const problem = (body: unknown) => body as ProblemDetails;

describe('patients: contacts & family (addendum C1–C12)', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let admin: TestAgent;
  let main: Clinic;

  const provision = async (name: string): Promise<Clinic> => {
    const ownerEmail = uniqueEmail('owner');
    const response = await admin.post('/api/v1/platform/tenants').send({
      clinic: { name, slug: `con-${newId().slice(-12)}` },
      firstBranch: { name: `${name} Main` },
      owner: { displayName: `${name} Owner`, email: ownerEmail, temporaryPassword: TEMPORARY },
    });
    expect(response.status).toBe(201);
    const owner = await signInAndSetPassword(testApp.app, ownerEmail, TEMPORARY);
    const [branch] = (await owner.get('/api/v1/branches')).body as Branch[];
    if (!branch) throw new Error('provisioning created no branch');
    return { tenant: response.body as Tenant, owner, branch };
  };

  const createStaff = async (
    clinic: Clinic,
    overrides: Record<string, unknown>,
  ): Promise<StaffUser & { email: string }> => {
    const email = uniqueEmail('staff');
    const response = await clinic.owner.post('/api/v1/users').send({
      displayName: 'Staff',
      email,
      practitionerType: 'frontdesk',
      roleKeys: ['frontdesk'],
      branchIds: [clinic.branch.id],
      temporaryPassword: TEMPORARY,
      ...overrides,
    });
    expect(response.status).toBe(201);
    return { ...(response.body as StaffUser), email };
  };

  /** A staff user holding only a custom role with `permissions`. */
  const signInWith = async (clinic: Clinic, permissions: string[]): Promise<TestAgent> => {
    const staff = await createStaff(clinic, { displayName: `Custom ${newId().slice(-6)}` });
    const roleId = newId();
    const tenantId = clinic.tenant.id;
    await database.ownerPool.query(
      `insert into roles (id, tenant_id, key, name, system) values ($1, $2, $3, 'Custom', false)`,
      [roleId, tenantId, `custom-${roleId.slice(-8)}`],
    );
    for (const permission of permissions) {
      await database.ownerPool.query(
        'insert into role_permissions (tenant_id, role_id, permission) values ($1, $2, $3)',
        [tenantId, roleId, permission],
      );
    }
    await database.ownerPool.query('delete from user_roles where user_id = $1', [staff.id]);
    await database.ownerPool.query(
      'insert into user_roles (tenant_id, user_id, role_id) values ($1, $2, $3)',
      [tenantId, staff.id, roleId],
    );
    return signInAndSetPassword(testApp.app, staff.email, TEMPORARY);
  };

  const createPatient = async (agent: TestAgent, body: Record<string, unknown>) => {
    const response = await agent.post('/api/v1/patients').send(body);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as Patient;
  };

  const contactsOf = async (agent: TestAgent, patientId: string) => {
    const response = await agent.get(`/api/v1/patients/${patientId}/contacts`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body as PatientContact[];
  };

  const link = (agent: TestAgent, patientId: string, body: object) =>
    agent.post(`/api/v1/patients/${patientId}/contacts`).send(body);

  const linked = async (agent: TestAgent, patientId: string, body: object) => {
    const response = await link(agent, patientId, body);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as PatientContact[];
  };

  const contactNamed = (contacts: PatientContact[], fullName: string) => {
    const row = contacts.find((entry) => entry.contact.fullName === fullName);
    if (!row) throw new Error(`no contact named ${fullName}`);
    return row;
  };

  const lookup = async (agent: TestAgent, q: string) => {
    const response = await agent.get(`/api/v1/contacts/lookup?q=${encodeURIComponent(q)}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body as ContactLookupItem[];
  };

  const auditOf = async (agent: TestAgent, query: string): Promise<AuditEntry[]> =>
    ((await agent.get(`/api/v1/audit?${query}&limit=100`)).body as AuditPage).items;

  /** Events recorded by the generic audit subscriber, newest first. */
  const events = async (agent: TestAgent, name: string) =>
    (await auditOf(agent, 'resourceType=event')).filter((entry) => entry.action === name);

  const counterOf = async (tenantId: string) =>
    (
      await database.ownerPool.query<{ last_value: number }>(
        'select last_value::int from patient_counters where tenant_id = $1',
        [tenantId],
      )
    ).rows[0]?.last_value ?? 0;

  const primaryCounts = async (patientId: string) =>
    (
      await database.ownerPool.query<{ guardian: number; billing: number; emergency: number }>(
        `select count(*) filter (where is_primary_guardian)::int as guardian,
                count(*) filter (where is_primary_billing)::int as billing,
                count(*) filter (where is_primary_emergency)::int as emergency
         from patient_contacts where patient_id = $1`,
        [patientId],
      )
    ).rows[0];

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    admin = await signIn(testApp.app, await createPlatformAdmin(testApp.app), undefined, {
      rememberMe: true,
    });
    main = await provision('Contacts Clinic');
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  describe('create with contacts (C4)', () => {
    it('creates a minor with a new guardian (billing, emergency) in one transaction', async () => {
      const child = await createPatient(main.owner, {
        fullName: 'Karim Haddad',
        dateOfBirth: CHILD_DOB,
        contacts: [
          linkInput(newContact('Rania Haddad', '71 100 001'), 'parent', {
            isGuardian: true,
            isBillingContact: true,
            isEmergencyContact: true,
          }),
        ],
      });
      expect(child.phone).toBeNull();
      const [guardian] = await contactsOf(main.owner, child.id);
      expect(guardian).toEqual({
        contact: {
          id: guardian?.contact.id,
          fullName: 'Rania Haddad',
          phone: '+96171100001',
          email: null,
          linkedPatient: null,
        },
        relationship: 'parent',
        isGuardian: true,
        isBillingContact: true,
        isEmergencyContact: true,
        isPrimaryGuardian: true,
        isPrimaryBilling: true,
        isPrimaryEmergency: true,
      });

      const entries = await auditOf(main.owner, `resourceType=patient&resourceId=${child.id}`);
      expect(entries.map((entry) => entry.action)).toEqual(['contact.link', 'patient.create']);
      expect(entries[0]?.after).toEqual({
        contactId: guardian?.contact.id,
        fullName: 'Rania Haddad',
        relationship: 'parent',
        isGuardian: true,
        isBillingContact: true,
        isEmergencyContact: true,
        isPrimaryGuardian: true,
        isPrimaryBilling: true,
        isPrimaryEmergency: true,
      });
      const [event] = await events(main.owner, 'ContactLinked');
      expect(event?.after).toEqual({ patientId: child.id, contactId: guardian?.contact.id });
    });

    it('rolls the patient, its number and its new contacts back when a link fails', async () => {
      const clinic = await provision('Atomic Contacts Clinic');
      await createPatient(clinic.owner, { fullName: 'First One', phone: '71 100 010' });
      const before = await counterOf(clinic.tenant.id);

      const refused = await clinic.owner.post('/api/v1/patients').send({
        fullName: 'Never Created',
        dateOfBirth: CHILD_DOB,
        contacts: [
          linkInput(newContact('Ghost Guardian', '71 100 011'), 'parent'),
          linkInput({ contactId: newId() }, 'other', { isEmergencyContact: true }),
        ],
      });
      expect(refused.status).toBe(422);
      expect(problem(refused.body)).toMatchObject({
        code: 'validation_failed',
        errors: [{ path: 'contacts.1.target.contactId', code: 'not_found' }],
      });

      const invalidPhone = await clinic.owner.post('/api/v1/patients').send({
        fullName: 'Never Created',
        dateOfBirth: CHILD_DOB,
        contacts: [linkInput(newContact('Bad Phone', '12'), 'parent')],
      });
      expect(invalidPhone.status).toBe(422);
      expect(problem(invalidPhone.body).errors?.[0]?.path).toBe(
        'contacts.0.target.newContact.phone',
      );

      const leftovers = await database.ownerPool.query<{ patients: number; contacts: number }>(
        `select (select count(*) from patients where tenant_id = $1 and full_name = 'Never Created')::int as patients,
                (select count(*) from contacts where tenant_id = $1)::int as contacts`,
        [clinic.tenant.id],
      );
      expect(leftovers.rows[0]).toEqual({ patients: 0, contacts: 0 });
      expect(await counterOf(clinic.tenant.id)).toBe(before);
      const next = await createPatient(clinic.owner, { fullName: 'Second', phone: '71 100 012' });
      expect(next.displayNumber).toBe('P-000002');
    });

    it('refuses two targets that resolve to the same contact', async () => {
      const mother = await createPatient(main.owner, {
        fullName: 'Dup Mother',
        phone: '71 100 020',
      });
      const [sibling] = (
        await linked(
          main.owner,
          (await createPatient(main.owner, { fullName: 'Dup Sibling', dateOfBirth: CHILD_DOB })).id,
          linkInput({ patientId: mother.id }, 'parent'),
        )
      ).map((row) => row.contact);
      const refused = await main.owner.post('/api/v1/patients').send({
        fullName: 'Dup Child',
        dateOfBirth: CHILD_DOB,
        contacts: [
          linkInput({ patientId: mother.id }, 'parent'),
          linkInput({ contactId: sibling?.id }, 'parent', { isBillingContact: true }),
        ],
      });
      expect(refused.status).toBe(422);
      expect(problem(refused.body).errors).toEqual([
        expect.objectContaining({ path: 'contacts.1', code: 'duplicate' }),
      ]);
    });
  });

  describe('a family (C4, C5, C12)', () => {
    it('offers the mother to a sibling by phone and links the same contact row', async () => {
      const childA = await createPatient(main.owner, {
        fullName: 'Sami Khoury',
        dateOfBirth: CHILD_DOB,
        contacts: [linkInput(newContact('Maya Khoury', '71 200 001'), 'parent')],
      });
      const [mother] = await contactsOf(main.owner, childA.id);
      if (!mother) throw new Error('no guardian');

      const offered = await lookup(main.owner, '200 001');
      expect(offered).toEqual([{ kind: 'contact', contact: mother.contact }]);

      const childB = await createPatient(main.owner, {
        fullName: 'Lea Khoury',
        dateOfBirth: CHILD_DOB,
        contacts: [linkInput({ contactId: mother.contact.id }, 'parent')],
      });
      expect(names(await contactsOf(main.owner, childA.id))).toEqual(['Maya Khoury']);
      expect(names(await contactsOf(main.owner, childB.id))).toEqual(['Maya Khoury']);
      const rows = await database.ownerPool.query<{ n: number }>(
        `select count(*)::int as n from contacts where tenant_id = $1 and name_key = 'maya khoury'`,
        [main.tenant.id],
      );
      expect(rows.rows[0]?.n).toBe(1);
    });

    it('makes the mother a patient with linkContactId: her own fields go, the patient speaks', async () => {
      const child = await createPatient(main.owner, {
        fullName: 'Omar Saab',
        dateOfBirth: CHILD_DOB,
        contacts: [linkInput(newContact('Nadia Saab', '71 300 001'), 'parent')],
      });
      const [before] = await contactsOf(main.owner, child.id);
      if (!before) throw new Error('no guardian');
      const contactId = before.contact.id;

      const mother = await createPatient(main.owner, {
        fullName: 'Nadia Saab-Aoun',
        phone: '71 300 002',
        linkContactId: contactId,
      });
      const [after] = await contactsOf(main.owner, child.id);
      expect(after?.contact).toEqual({
        id: contactId,
        fullName: 'Nadia Saab-Aoun',
        phone: '+96171300002',
        email: null,
        linkedPatient: { id: mother.id, displayNumber: mother.displayNumber, archived: false },
      });
      const stored = await database.ownerPool.query(
        'select full_name, name_key, phone, phone_search, email, linked_patient_id from contacts where id = $1',
        [contactId],
      );
      expect(stored.rows[0]).toEqual({
        full_name: null,
        name_key: null,
        phone: null,
        phone_search: null,
        email: null,
        linked_patient_id: mother.id,
      });
      const [update] = await auditOf(main.owner, `resourceType=contact&resourceId=${contactId}`);
      expect(update).toMatchObject({
        action: 'contact.update',
        before: { fullName: 'Nadia Saab', linkedPatientId: null },
        after: { fullName: null, linkedPatientId: mother.id },
      });

      // She is offered once, as that contact (a patient with a contact is not listed twice).
      const offered = await lookup(main.owner, 'Nadia Saab-Aoun');
      expect(offered).toEqual([{ kind: 'contact', contact: after?.contact }]);

      const again = await main.owner.post('/api/v1/patients').send({
        fullName: 'Someone Else',
        phone: '71 300 003',
        linkContactId: contactId,
      });
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({ code: 'contact.already_linked' });
      const unknown = await main.owner.post('/api/v1/patients').send({
        fullName: 'Someone Else',
        phone: '71 300 003',
        linkContactId: newId(),
      });
      expect(unknown.status).toBe(422);
      expect(problem(unknown.body).errors?.[0]).toMatchObject({
        path: 'linkContactId',
        code: 'not_found',
      });
    });

    it("bills a wife and the children to the husband's contact (patientsBilledBy)", async () => {
      const husband = await createPatient(main.owner, {
        fullName: 'Fadi Nassar',
        phone: '71 400 001',
      });
      const offered = await lookup(main.owner, 'Fadi Nassar');
      expect(offered).toEqual([
        {
          kind: 'patient',
          patient: {
            id: husband.id,
            displayNumber: husband.displayNumber,
            fullName: 'Fadi Nassar',
            phone: '+96171400001',
            dateOfBirth: null,
          },
        },
      ]);

      const wife = await createPatient(main.owner, {
        fullName: 'Hiba Nassar',
        phone: '71 400 002',
        contacts: [
          linkInput({ patientId: husband.id }, 'spouse', {
            isBillingContact: true,
            isEmergencyContact: true,
          }),
        ],
      });
      const children = [];
      for (const fullName of ['Jad Nassar', 'Tala Nassar']) {
        children.push(
          await createPatient(main.owner, {
            fullName,
            dateOfBirth: CHILD_DOB,
            contacts: [
              linkInput({ patientId: husband.id }, 'parent', {
                isGuardian: true,
                isBillingContact: true,
              }),
            ],
          }),
        );
      }
      const [spouse] = await contactsOf(main.owner, wife.id);
      expect(spouse).toMatchObject({
        relationship: 'spouse',
        isGuardian: false,
        isBillingContact: true,
        contact: {
          fullName: 'Fadi Nassar',
          phone: '+96171400001',
          linkedPatient: { id: husband.id },
        },
      });
      const contactId = spouse?.contact.id;
      for (const child of children) {
        expect((await contactsOf(main.owner, child.id))[0]?.contact.id).toBe(contactId);
      }
      // A patient with a contact is now offered as that contact only.
      expect((await lookup(main.owner, 'Fadi Nassar')).map((item) => item.kind)).toEqual([
        'contact',
      ]);

      const billed = await main.owner.get(`/api/v1/contacts/${contactId}/billed-patients`);
      expect(billed.status).toBe(200);
      expect((billed.body as PatientListItem[]).map((item) => item.id)).toEqual([
        wife.id,
        children[0]?.id,
        children[1]?.id,
      ]);

      const service = testApp.app.get(ContactsService);
      const byPhone = await asPlatformAdminIn(testApp.app, main.tenant.id, () =>
        service.findContactsByPhone('71400001'),
      );
      expect(byPhone.map((contact) => contact.id)).toEqual([contactId]);
      expect(
        await asPlatformAdminIn(testApp.app, main.tenant.id, () =>
          service.findContactsByPhone('not a phone'),
        ),
      ).toEqual([]);
    });
  });

  describe('primaries, roles and unlink (C2, C5)', () => {
    it('keeps one primary per role: first holder, explicit move, promotion on unlink', async () => {
      const child = await createPatient(main.owner, {
        fullName: 'Primary Child',
        dateOfBirth: CHILD_DOB,
      });
      await linked(
        main.owner,
        child.id,
        linkInput(newContact('Guardian One', '71 500 001'), 'parent'),
      );
      const afterSecond = await linked(
        main.owner,
        child.id,
        linkInput(newContact('Guardian Two', '71 500 002'), 'parent'),
      );
      const one = contactNamed(afterSecond, 'Guardian One');
      const two = contactNamed(afterSecond, 'Guardian Two');
      expect([one.isPrimaryGuardian, two.isPrimaryGuardian]).toEqual([true, false]);

      const moved = await main.owner
        .patch(`/api/v1/patients/${child.id}/contacts/${two.contact.id}`)
        .send({ isPrimaryGuardian: true });
      expect(moved.status).toBe(200);
      expect(names(moved.body as PatientContact[])).toEqual(['Guardian Two', 'Guardian One']);
      expect(contactNamed(moved.body as PatientContact[], 'Guardian One').isPrimaryGuardian).toBe(
        false,
      );
      expect(await primaryCounts(child.id)).toEqual({ guardian: 1, billing: 0, emergency: 0 });

      const unlinked = await main.owner.delete(
        `/api/v1/patients/${child.id}/contacts/${two.contact.id}`,
      );
      expect(unlinked.status).toBe(200);
      expect(unlinked.body).toEqual([expect.objectContaining({ isPrimaryGuardian: true })]);
      expect(names(unlinked.body as PatientContact[])).toEqual(['Guardian One']);
      expect(await primaryCounts(child.id)).toEqual({ guardian: 1, billing: 0, emergency: 0 });

      const [removal] = await auditOf(main.owner, `resourceType=patient&resourceId=${child.id}`);
      expect(removal).toMatchObject({
        action: 'contact.unlink',
        before: { contactId: two.contact.id, fullName: 'Guardian Two', isPrimaryGuardian: true },
        after: null,
      });
      const [event] = await events(main.owner, 'ContactUnlinked');
      expect(event?.after).toEqual({ patientId: child.id, contactId: two.contact.id });
      // The contact itself stays: the lookup still offers it.
      expect((await lookup(main.owner, 'Guardian Two')).length).toBe(1);
    });

    it('patches roles and the relationship, audited as contact.roles', async () => {
      const patient = await createPatient(main.owner, {
        fullName: 'Roles Adult',
        phone: '71 510 001',
      });
      const [row] = await linked(
        main.owner,
        patient.id,
        linkInput(newContact('Roles Sister', '71 510 002'), 'sibling', {
          isEmergencyContact: true,
        }),
      );
      const contactId = row?.contact.id;
      const url = `/api/v1/patients/${patient.id}/contacts/${contactId}`;

      const patched = await main.owner
        .patch(url)
        .send({ relationship: 'caregiver', isBillingContact: true });
      expect(patched.status).toBe(200);
      expect((patched.body as PatientContact[])[0]).toMatchObject({
        relationship: 'caregiver',
        isEmergencyContact: true,
        isBillingContact: true,
        isPrimaryBilling: true,
      });
      const [entry] = await auditOf(main.owner, `resourceType=patient&resourceId=${patient.id}`);
      expect(entry).toMatchObject({
        action: 'contact.roles',
        before: { relationship: 'sibling', isBillingContact: false },
        after: { relationship: 'caregiver', isBillingContact: true, isPrimaryBilling: true },
      });

      const unchanged = await main.owner.patch(url).send({ relationship: 'caregiver' });
      expect(unchanged.status).toBe(200);
      const [latest] = await auditOf(main.owner, `resourceType=patient&resourceId=${patient.id}`);
      expect(latest?.id).toBe(entry?.id);

      const roleless = await main.owner
        .patch(url)
        .send({ isBillingContact: false, isEmergencyContact: false });
      expect(roleless.status).toBe(422);
      expect(roleless.body).toMatchObject({ code: 'contact.role_required' });
      const notLinked = await main.owner
        .patch(`/api/v1/patients/${patient.id}/contacts/${newId()}`)
        .send({ relationship: 'other' });
      expect(notLinked.status).toBe(404);
      expect(notLinked.body).toMatchObject({ code: 'contact.not_found' });
    });

    it('refuses to make a patient their own contact, and linking twice', async () => {
      const patient = await createPatient(main.owner, {
        fullName: 'Self Patient',
        phone: '71 520 001',
      });
      const selfTarget = await link(
        main.owner,
        patient.id,
        linkInput({ patientId: patient.id }, 'other', { isEmergencyContact: true }),
      );
      expect(selfTarget.status).toBe(422);
      expect(selfTarget.body).toMatchObject({ code: 'contact.is_patient' });

      // Their contact exists once someone links them; linking it back to them is refused too.
      const other = await createPatient(main.owner, {
        fullName: 'Self Other',
        phone: '71 520 002',
      });
      const [own] = await linked(
        main.owner,
        other.id,
        linkInput({ patientId: patient.id }, 'sibling', { isEmergencyContact: true }),
      );
      const ownContact = await link(
        main.owner,
        patient.id,
        linkInput({ contactId: own?.contact.id }, 'other', { isEmergencyContact: true }),
      );
      expect(ownContact.status).toBe(422);
      expect(ownContact.body).toMatchObject({ code: 'contact.is_patient' });

      const twice = await link(
        main.owner,
        other.id,
        linkInput({ contactId: own?.contact.id }, 'sibling', { isBillingContact: true }),
      );
      expect(twice.status).toBe(409);
      expect(twice.body).toMatchObject({ code: 'contact.already_linked' });

      const unknown = await link(
        main.owner,
        other.id,
        linkInput({ contactId: newId() }, 'other', { isEmergencyContact: true }),
      );
      expect(unknown.status).toBe(422);
      expect(problem(unknown.body).errors?.[0]).toMatchObject({
        path: 'target.contactId',
        code: 'not_found',
      });
    });

    it('never answers 500 to two concurrent first guardians: exactly one is primary', async () => {
      const child = await createPatient(main.owner, {
        fullName: 'Race Child',
        dateOfBirth: CHILD_DOB,
      });
      const responses = await Promise.all(
        ['71 530 001', '71 530 002', '71 530 003'].map((phone, index) =>
          link(main.owner, child.id, linkInput(newContact(`Racer ${index}`, phone), 'parent')),
        ),
      );
      for (const response of responses) expect([201, 409]).toContain(response.status);
      expect(await primaryCounts(child.id)).toEqual({ guardian: 1, billing: 0, emergency: 0 });
    });
  });

  describe('archived and merged-away patients (C9)', () => {
    it("refuses new contact writes, but keeps and resolves the archived patient's links", async () => {
      const mother = await createPatient(main.owner, {
        fullName: 'Archived Mother',
        phone: '71 540 001',
      });
      const child = await createPatient(main.owner, {
        fullName: 'Archived Child',
        dateOfBirth: CHILD_DOB,
        contacts: [linkInput({ patientId: mother.id }, 'parent')],
      });
      const [guardian] = await contactsOf(main.owner, child.id);
      const archived = await main.owner
        .post('/api/v1/patients/archive')
        .send({ ids: [mother.id, child.id] });
      expect(archived.status).toBe(200);

      const [after] = await contactsOf(main.owner, child.id);
      expect(after?.contact.linkedPatient).toEqual({
        id: mother.id,
        displayNumber: mother.displayNumber,
        archived: true,
      });
      const refused = await link(
        main.owner,
        child.id,
        linkInput(newContact('Too Late', '71 540 002'), 'other', { isEmergencyContact: true }),
      );
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ code: 'patient.archived' });
      const unlink = await main.owner.delete(
        `/api/v1/patients/${child.id}/contacts/${guardian?.contact.id}`,
      );
      expect(unlink.status).toBe(409);
    });
  });

  describe('merged-away patients', () => {
    it('refuses contact writes on them (409 patient.merged) and them as link targets (422)', async () => {
      const kept = await createPatient(main.owner, { fullName: 'Gone Kept', phone: '71 550 001' });
      const gone = await createPatient(main.owner, {
        fullName: 'Gone Dropped',
        phone: '71 550 002',
      });
      const [sister] = await linked(
        main.owner,
        gone.id,
        linkInput(newContact('Gone Sister', '71 550 003'), 'sibling', { isEmergencyContact: true }),
      );
      const merged = await main.owner
        .post('/api/v1/patients/merge')
        .send({ keepId: kept.id, dropId: gone.id, reason: 'Same person' });
      expect(merged.status).toBe(200);
      const contactId = sister?.contact.id;

      const writes = await Promise.all([
        link(
          main.owner,
          gone.id,
          linkInput(newContact('Late', '71 550 004'), 'other', { isEmergencyContact: true }),
        ),
        main.owner
          .patch(`/api/v1/patients/${gone.id}/contacts/${contactId}`)
          .send({ isBillingContact: true }),
        main.owner.delete(`/api/v1/patients/${gone.id}/contacts/${contactId}`),
      ]);
      for (const response of writes) {
        expect(response.status).toBe(409);
        expect(response.body).toMatchObject({ code: 'patient.merged' });
      }

      const other = await createPatient(main.owner, {
        fullName: 'Gone Other',
        phone: '71 550 005',
      });
      const asTarget = await link(
        main.owner,
        other.id,
        linkInput({ patientId: gone.id }, 'sibling', { isEmergencyContact: true }),
      );
      expect(asTarget.status).toBe(422);
      expect(problem(asTarget.body).errors).toEqual([
        expect.objectContaining({ path: 'target.patientId', code: 'merged' }),
      ]);
      const onCreate = await main.owner.post('/api/v1/patients').send({
        fullName: 'Gone Child',
        dateOfBirth: CHILD_DOB,
        contacts: [linkInput({ patientId: gone.id }, 'parent')],
      });
      expect(onCreate.status).toBe(422);
      expect(problem(onCreate.body).errors).toEqual([
        expect.objectContaining({ path: 'contacts.0.target.patientId', code: 'merged' }),
      ]);
      expect(await contactsOf(main.owner, other.id)).toEqual([]);
    });
  });

  describe('editing a contact (PATCH /contacts/:id)', () => {
    it('edits an unlinked contact, and refuses a linked one', async () => {
      const child = await createPatient(main.owner, {
        fullName: 'Edit Child',
        dateOfBirth: CHILD_DOB,
        contacts: [linkInput(newContact('Edit Aunt', '71 600 001'), 'caregiver')],
      });
      const [aunt] = await contactsOf(main.owner, child.id);
      const contactId = aunt?.contact.id;

      const edited = await main.owner
        .patch(`/api/v1/contacts/${contactId}`)
        .send({ phone: '71 600 002', email: 'aunt@example.com' });
      expect(edited.status).toBe(200);
      expect(edited.body).toEqual({
        id: contactId,
        fullName: 'Edit Aunt',
        phone: '+96171600002',
        email: 'aunt@example.com',
        linkedPatient: null,
      });
      const [entry] = await auditOf(main.owner, `resourceType=contact&resourceId=${contactId}`);
      expect(entry).toMatchObject({
        action: 'contact.update',
        before: { fullName: 'Edit Aunt', phone: '+96171600001', email: null },
        after: { fullName: 'Edit Aunt', phone: '+96171600002', email: 'aunt@example.com' },
      });
      const [event] = await events(main.owner, 'ContactUpdated');
      expect(event?.after).toEqual({ contactId });
      expect((await lookup(main.owner, '600 002')).length).toBe(1);

      const invalid = await main.owner.patch(`/api/v1/contacts/${contactId}`).send({ phone: '12' });
      expect(invalid.status).toBe(422);
      expect(problem(invalid.body).errors?.[0]?.path).toBe('phone');

      const patient = await createPatient(main.owner, {
        fullName: 'Edit Patient',
        phone: '71 600 003',
      });
      const [asContact] = await linked(
        main.owner,
        child.id,
        linkInput({ patientId: patient.id }, 'other', { isEmergencyContact: true }),
      ).then((rows) => rows.filter((row) => row.contact.linkedPatient !== null));
      const refused = await main.owner
        .patch(`/api/v1/contacts/${asContact?.contact.id}`)
        .send({ fullName: 'Renamed' });
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ code: 'contact.linked' });

      const unknown = await main.owner.patch(`/api/v1/contacts/${newId()}`).send({ fullName: 'X' });
      expect(unknown.status).toBe(404);
      expect(unknown.body).toMatchObject({ code: 'contact.not_found' });
    });
  });

  describe('editing a contact without a change', () => {
    it('writes, audits and emits nothing', async () => {
      const child = await createPatient(main.owner, {
        fullName: 'Same Child',
        dateOfBirth: CHILD_DOB,
        contacts: [linkInput(newContact('Same Uncle', '71 610 001'), 'caregiver')],
      });
      const contactId = (await contactsOf(main.owner, child.id))[0]?.contact.id;
      const stamp = async () =>
        (
          await database.ownerPool.query<{ updated_at: Date }>(
            'select updated_at from contacts where id = $1',
            [contactId],
          )
        ).rows[0]?.updated_at.toISOString();
      const before = await stamp();
      const eventsBefore = (await events(main.owner, 'ContactUpdated')).length;

      const same = await main.owner
        .patch(`/api/v1/contacts/${contactId}`)
        .send({ fullName: 'Same Uncle', phone: '+961 71 610 001', email: '' });
      expect(same.status).toBe(200);
      expect(same.body).toMatchObject({
        fullName: 'Same Uncle',
        phone: '+96171610001',
        email: null,
      });
      expect(await stamp()).toBe(before);
      expect(await auditOf(main.owner, `resourceType=contact&resourceId=${contactId}`)).toEqual([]);
      expect((await events(main.owner, 'ContactUpdated')).length).toBe(eventsBefore);
    });
  });

  describe('the lookup (C5)', () => {
    it('merges both halves by name, contacts first on a tie, at most 10, no archived patient', async () => {
      await createPatient(main.owner, {
        fullName: 'Holder Of Many',
        phone: '71 620 001',
        contacts: ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'].map((suffix, index) =>
          linkInput(newContact(`Lkq ${suffix}`, `71 620 1${String(index)}0`), 'other', {
            isEmergencyContact: true,
          }),
        ),
      });
      const patient = (fullName: string, index: number) =>
        createPatient(main.owner, { fullName, phone: `71 620 2${String(index)}0` });
      await patient('Lkq A1', 0);
      for (const [index, suffix] of ['B1', 'B2', 'B3', 'B4', 'B5'].entries()) {
        await patient(`Lkq ${suffix}`, index + 1);
      }
      const archived = await patient('Lkq A0', 6);
      await main.owner.post('/api/v1/patients/archive').send({ ids: [archived.id] });
      // A patient who is someone's contact: offered once, as that contact.
      const asContact = await patient('Lkq C1', 7);
      await linked(
        main.owner,
        (await patient('Other Holder', 8)).id,
        linkInput({ patientId: asContact.id }, 'sibling', { isEmergencyContact: true }),
      );

      const rows = (await lookup(main.owner, 'Lkq')).map((item) =>
        item.kind === 'contact'
          ? `contact ${item.contact.fullName}`
          : `patient ${item.patient.fullName}`,
      );
      expect(rows).toEqual([
        'contact Lkq A1',
        'patient Lkq A1',
        'contact Lkq A2',
        'contact Lkq A3',
        'contact Lkq A4',
        'contact Lkq A5',
        'contact Lkq A6',
        'patient Lkq B1',
        'patient Lkq B2',
        'patient Lkq B3',
      ]);
      const once = await lookup(main.owner, 'Lkq C1');
      expect(once.map((item) => item.kind)).toEqual(['contact']);
      const [only] = once;
      expect(only?.kind === 'contact' ? only.contact.linkedPatient?.id : undefined).toBe(
        asContact.id,
      );
      expect(await lookup(main.owner, 'Lkq A0')).toEqual([]);
    });
  });

  describe('search and the list (C7)', () => {
    it("finds a child by the guardian's digits, with matchedContact and primaryGuardian", async () => {
      const child = await createPatient(main.owner, {
        fullName: 'Via Child',
        dateOfBirth: CHILD_DOB,
        contacts: [linkInput(newContact('Via Mother', '71 700 001'), 'parent')],
      });
      const page = (await main.owner.get('/api/v1/patients?q=700001')).body as PatientPage;
      const item = page.items.find((row) => row.id === child.id);
      expect(item).toMatchObject({
        phone: null,
        matchedContact: { fullName: 'Via Mother', relationship: 'parent' },
        primaryGuardian: { fullName: 'Via Mother', phone: '+96171700001', relationship: 'parent' },
      });
    });
  });

  describe('merge (C8)', () => {
    it('moves and deduplicates contacts, drops self-links and folds the linked contacts', async () => {
      const kept = await createPatient(main.owner, {
        fullName: 'Merge Adult',
        phone: '71 800 001',
      });
      const dropped = await createPatient(main.owner, {
        fullName: 'Merge Adult Dup',
        phone: '71 800 002',
      });
      // Both records link X; the dropped one also links Y and the kept patient himself.
      const [x] = await linked(
        main.owner,
        kept.id,
        linkInput(newContact('Merge Friend', '71 800 003'), 'other', { isEmergencyContact: true }),
      );
      await linked(
        main.owner,
        dropped.id,
        linkInput({ contactId: x?.contact.id }, 'other', { isBillingContact: true }),
      );
      await linked(
        main.owner,
        dropped.id,
        linkInput(newContact('Merge Brother', '71 800 004'), 'sibling', {
          isEmergencyContact: true,
        }),
      );
      await linked(
        main.owner,
        dropped.id,
        linkInput({ patientId: kept.id }, 'sibling', { isEmergencyContact: true }),
      );
      // Children link the kept and the dropped records as contacts: C1 both, C2 only dropped.
      const c1 = await createPatient(main.owner, {
        fullName: 'Merge Child One',
        dateOfBirth: CHILD_DOB,
        contacts: [
          linkInput({ patientId: dropped.id }, 'parent'),
          linkInput({ patientId: kept.id }, 'parent', { isBillingContact: true }),
        ],
      });
      const c2 = await createPatient(main.owner, {
        fullName: 'Merge Child Two',
        dateOfBirth: CHILD_DOB,
        contacts: [linkInput({ patientId: dropped.id }, 'parent')],
      });
      const droppedContactId = (await contactsOf(main.owner, c2.id))[0]?.contact.id;
      const keptContactId = contactNamed(await contactsOf(main.owner, c1.id), 'Merge Adult').contact
        .id;

      const merged = await main.owner
        .post('/api/v1/patients/merge')
        .send({ keepId: kept.id, dropId: dropped.id, reason: 'Same person' });
      expect(merged.status, JSON.stringify(merged.body)).toBe(200);

      const keptContacts = await contactsOf(main.owner, kept.id);
      expect(keptContacts.map((row) => [row.contact.fullName, row.relationship])).toEqual([
        ['Merge Friend', 'other'],
        ['Merge Brother', 'sibling'],
      ]);
      expect(contactNamed(keptContacts, 'Merge Friend')).toMatchObject({
        isEmergencyContact: true,
        isBillingContact: true,
        isPrimaryEmergency: true,
        isPrimaryBilling: true,
      });
      expect(contactNamed(keptContacts, 'Merge Brother')).toMatchObject({
        isEmergencyContact: true,
        isPrimaryEmergency: false,
      });
      expect(await contactsOf(main.owner, dropped.id)).toEqual([]);

      // The dropped record's contact is folded into the kept record's one.
      const [c1Contact] = await contactsOf(main.owner, c1.id);
      expect(await contactsOf(main.owner, c1.id)).toHaveLength(1);
      expect(c1Contact).toMatchObject({
        contact: { id: keptContactId, fullName: 'Merge Adult' },
        isGuardian: true,
        isBillingContact: true,
        isPrimaryGuardian: true,
        isPrimaryBilling: true,
      });
      const [c2Contact] = await contactsOf(main.owner, c2.id);
      expect(c2Contact?.contact.id).toBe(keptContactId);
      const folded = await database.ownerPool.query<{ deleted: boolean }>(
        'select deleted_at is not null as deleted from contacts where id = $1',
        [droppedContactId],
      );
      expect(folded.rows[0]?.deleted).toBe(true);

      const entries = await auditOf(main.owner, `resourceType=patient&resourceId=${kept.id}`);
      expect(entries.slice(0, 2).map((entry) => entry.action)).toEqual([
        'contact.merge',
        'patient.merge',
      ]);
      expect(entries[0]?.after).toMatchObject({
        droppedId: dropped.id,
        movedLinks: 1,
        foldedContactId: droppedContactId,
        foldedIntoContactId: keptContactId,
        relinkedContactId: null,
      });
      const updated = (await events(main.owner, 'ContactUpdated')).map((entry) => entry.after);
      expect(updated).toContainEqual({ contactId: droppedContactId });
      expect(updated).not.toContainEqual({ contactId: keptContactId });
    });

    it("re-points the dropped record's contact when the kept one has none", async () => {
      const kept = await createPatient(main.owner, {
        fullName: 'Relink Adult',
        phone: '71 810 001',
      });
      const dropped = await createPatient(main.owner, {
        fullName: 'Relink Dup',
        phone: '71 810 002',
      });
      const child = await createPatient(main.owner, {
        fullName: 'Relink Child',
        dateOfBirth: CHILD_DOB,
        contacts: [linkInput({ patientId: dropped.id }, 'parent')],
      });
      const [before] = await contactsOf(main.owner, child.id);
      const merged = await main.owner
        .post('/api/v1/patients/merge')
        .send({ keepId: kept.id, dropId: dropped.id, reason: 'Same person' });
      expect(merged.status).toBe(200);
      const [after] = await contactsOf(main.owner, child.id);
      expect(after?.contact).toMatchObject({
        id: before?.contact.id,
        fullName: 'Relink Adult',
        linkedPatient: { id: kept.id },
      });
      const [entry] = await auditOf(main.owner, `resourceType=patient&resourceId=${kept.id}`);
      expect(entry).toMatchObject({
        action: 'contact.merge',
        after: {
          relinkedContactId: before?.contact.id,
          foldedContactId: null,
          foldedIntoContactId: null,
        },
      });
      const [event] = await events(main.owner, 'ContactUpdated');
      expect(event?.after).toEqual({ contactId: before?.contact.id });
    });

    it('audits no contact.merge when neither record has contacts', async () => {
      const kept = await createPatient(main.owner, {
        fullName: 'Plain Adult',
        phone: '71 820 001',
      });
      const dropped = await createPatient(main.owner, {
        fullName: 'Plain Dup',
        phone: '71 820 002',
      });
      const merged = await main.owner
        .post('/api/v1/patients/merge')
        .send({ keepId: kept.id, dropId: dropped.id, reason: 'Same person' });
      expect(merged.status).toBe(200);
      const [entry] = await auditOf(main.owner, `resourceType=patient&resourceId=${kept.id}`);
      expect(entry?.action).toBe('patient.merge');
    });
  });

  describe('permissions', () => {
    it('lets front desk manage contacts', async () => {
      const staff = await createStaff(main, { displayName: 'Desk Contacts' });
      const desk = await signInAndSetPassword(testApp.app, staff.email, TEMPORARY);
      const child = await createPatient(desk, {
        fullName: 'Desk Child',
        dateOfBirth: CHILD_DOB,
        contacts: [linkInput(newContact('Desk Mother', '71 900 001'), 'parent')],
      });
      const [mother] = await contactsOf(desk, child.id);
      const contactId = mother?.contact.id;
      expect(
        (await link(desk, child.id, linkInput(newContact('Desk Father', '71 900 002'), 'parent')))
          .status,
      ).toBe(201);
      expect(
        (
          await desk
            .patch(`/api/v1/patients/${child.id}/contacts/${contactId}`)
            .send({ isEmergencyContact: true })
        ).status,
      ).toBe(200);
      expect(
        (await desk.patch(`/api/v1/contacts/${contactId}`).send({ fullName: 'Desk Mom' })).status,
      ).toBe(200);
      expect((await lookup(desk, 'Desk Mom')).length).toBe(1);
      expect((await desk.delete(`/api/v1/patients/${child.id}/contacts/${contactId}`)).status).toBe(
        200,
      );
    });

    it('needs patient:write for writes and patient:read for reads, in the service too', async () => {
      const child = await createPatient(main.owner, {
        fullName: 'Perm Child',
        dateOfBirth: CHILD_DOB,
        contacts: [linkInput(newContact('Perm Mother', '71 910 001'), 'parent')],
      });
      const [mother] = await contactsOf(main.owner, child.id);
      const contactId = mother?.contact.id ?? '';

      const reader = await signInWith(main, ['patient:read']);
      expect((await reader.get(`/api/v1/patients/${child.id}/contacts`)).status).toBe(200);
      expect((await reader.get('/api/v1/contacts/lookup?q=Perm')).status).toBe(200);
      const writes = [
        link(reader, child.id, linkInput(newContact('No', '71 910 002'), 'parent')),
        reader
          .patch(`/api/v1/patients/${child.id}/contacts/${contactId}`)
          .send({ isEmergencyContact: true }),
        reader.delete(`/api/v1/patients/${child.id}/contacts/${contactId}`),
        reader.patch(`/api/v1/contacts/${contactId}`).send({ fullName: 'No' }),
      ];
      for (const response of await Promise.all(writes)) expect(response.status).toBe(403);

      const stranger = await signInWith(main, ['user:read']);
      const reads = [
        stranger.get(`/api/v1/patients/${child.id}/contacts`),
        stranger.get('/api/v1/contacts/lookup?q=Perm'),
        stranger.get(`/api/v1/contacts/${contactId}/billed-patients`),
      ];
      for (const response of await Promise.all(reads)) expect(response.status).toBe(403);

      const service = testApp.app.get(ContactsService);
      const context = testApp.app.get(RequestContext);
      const withOnly = <T>(permissions: ('patient:read' | 'user:read')[], fn: () => Promise<T>) =>
        context.run(
          { requestId: newId(), actorKind: 'user', tenantId: main.tenant.id, userId: newId() },
          () => {
            context.setPermissions(permissions);
            return fn();
          },
        );
      await expect(
        withOnly(['patient:read'], () => service.unlink(child.id, contactId)),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        withOnly(['user:read'], () => service.contactsOf(child.id)),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        withOnly(['user:read'], () => service.patientsBilledBy(contactId)),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(
        withOnly(['user:read'], () => service.findContactsByPhone('71910001')),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      expect(names(await contactsOf(main.owner, child.id))).toEqual(['Perm Mother']);
    });
  });

  it('answers 404 for an unknown patient on every contact route', async () => {
    const id = newId();
    const contactId = newId();
    const responses = await Promise.all([
      main.owner.get(`/api/v1/patients/${id}/contacts`),
      link(main.owner, id, linkInput(newContact('Nobody', '71 920 001'), 'parent')),
      main.owner.patch(`/api/v1/patients/${id}/contacts/${contactId}`).send({ isGuardian: true }),
      main.owner.delete(`/api/v1/patients/${id}/contacts/${contactId}`),
    ]);
    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({ code: 'patient.not_found' });
    }
    const billed = await main.owner.get(`/api/v1/contacts/${contactId}/billed-patients`);
    expect(billed.status).toBe(404);
    expect(billed.body).toMatchObject({ code: 'contact.not_found' });
    const [view] = (await lookup(main.owner, 'Nobody')) as { contact?: ContactView }[];
    expect(view).toBeUndefined();
  });
});
