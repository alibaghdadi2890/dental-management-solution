import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type LinkChange,
  type PatientLink,
  planContactMerge,
  planLinkChange,
  resolveContact,
} from '../../src/modules/patients/domain/contacts';
import {
  type ContactRecord,
  ContactsRepository,
} from '../../src/modules/patients/persistence/contacts.repository';
import { PatientContactsRepository } from '../../src/modules/patients/persistence/patient-contacts.repository';
import {
  type NewPatient,
  type NormalizedPhoneInput,
  PatientsRepository,
} from '../../src/modules/patients/persistence/patients.repository';
import { type ContextSeed, RequestContext } from '../../src/platform/cls/request-context';
import { TenantDb } from '../../src/platform/db/tenant-db';
import { newId } from '../../src/platform/kernel/id';
import { connectTestDatabase, type TestDatabase } from '../support/postgres';
import { createTestApp, type TestApp } from '../support/test-app';

const PHONE = (e164: string, national: string): NormalizedPhoneInput => ({ e164, national });

let displayNumberCounter = 0;
function nextDisplayNumber(): string {
  displayNumberCounter += 1;
  return `P-${String(displayNumberCounter).padStart(6, '0')}`;
}

function newPatient(overrides: Partial<NewPatient> = {}): NewPatient {
  return {
    displayNumber: nextDisplayNumber(),
    fullName: 'Test Patient',
    phone: null,
    dateOfBirth: null,
    sex: 'unknown',
    email: null,
    address: null,
    insurance: null,
    notes: null,
    medicalAlerts: [],
    primaryDentistId: null,
    externalId: null,
    ...overrides,
  };
}

const view = (record: ContactRecord | undefined) => {
  if (!record) throw new Error('expected a contact');
  return resolveContact(record.contact, record.linkedPatient);
};

describe('patients: contacts repositories', () => {
  let database: TestDatabase;
  let testApp: TestApp;
  let context: RequestContext;
  let tenantDb: TenantDb;
  let patientsRepo: PatientsRepository;
  let contactsRepo: ContactsRepository;
  let links: PatientContactsRepository;

  const seed = (tenantId: string): ContextSeed => ({
    requestId: `req-${newId()}`,
    actorKind: 'user',
    tenantId,
    userId: newId(),
  });
  const inTenant = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
    context.run(seed(tenantId), fn);
  const createPatient = (tenantId: string, overrides: Partial<NewPatient> = {}) =>
    inTenant(tenantId, () => patientsRepo.insert(newPatient(overrides)));
  const createContact = (
    tenantId: string,
    fullName: string,
    phone: NormalizedPhoneInput | null = null,
    email: string | null = null,
  ) => inTenant(tenantId, () => contactsRepo.insert({ fullName, phone, email }));
  /** Plans and applies one change to `patientId`'s links, as the service will (H2). */
  const change = (tenantId: string, patientId: string, linkChange: LinkChange) =>
    inTenant(tenantId, () =>
      tenantDb.run(async () => {
        const plan = planLinkChange(patientId, await links.linksOf(patientId), linkChange);
        await links.applyLinkPlan(plan);
      }),
    );
  const linkAs = (
    tenantId: string,
    patientId: string,
    contactId: string,
    roles: Partial<Record<'isGuardian' | 'isBillingContact' | 'isEmergencyContact', boolean>>,
    relationship: 'parent' | 'spouse' | 'child' | 'sibling' | 'caregiver' | 'other' = 'parent',
  ) =>
    change(tenantId, patientId, {
      kind: 'link',
      contactId,
      relationship,
      roles: { isGuardian: false, isBillingContact: false, isEmergencyContact: false, ...roles },
    });
  const flagsOf = (patientLinks: PatientLink[]) =>
    Object.fromEntries(
      patientLinks.map((link) => [
        link.contactId,
        [
          link.isGuardian,
          link.isPrimaryGuardian,
          link.isBillingContact,
          link.isPrimaryBilling,
          link.isEmergencyContact,
          link.isPrimaryEmergency,
        ],
      ]),
    );

  beforeAll(async () => {
    database = connectTestDatabase();
    testApp = await createTestApp(database);
    context = testApp.app.get(RequestContext);
    tenantDb = testApp.app.get(TenantDb);
    patientsRepo = testApp.app.get(PatientsRepository);
    contactsRepo = testApp.app.get(ContactsRepository);
    links = testApp.app.get(PatientContactsRepository);
  });

  afterAll(async () => {
    await testApp.close();
    await database.close();
  });

  describe('ContactsRepository', () => {
    it('inserts a contact with its derived search columns and resolves it', async () => {
      const tenant = newId();
      const contact = await createContact(
        tenant,
        'Mona Ḥaddad',
        PHONE('+9613123456', '03123456'),
        'mona@example.com',
      );
      expect(contact).toMatchObject({
        fullName: 'Mona Ḥaddad',
        nameKey: 'mona haddad',
        phone: '+9613123456',
        phoneSearch: '9613123456 03123456',
        linkedPatientId: null,
      });
      expect(view(await inTenant(tenant, () => contactsRepo.findById(contact.id)))).toEqual({
        id: contact.id,
        fullName: 'Mona Ḥaddad',
        phone: '+9613123456',
        email: 'mona@example.com',
        linkedPatient: null,
      });
    });

    it('linkToPatient clears the own fields; the contact then reads from the patient', async () => {
      const tenant = newId();
      const contact = await createContact(
        tenant,
        'Mona Haddad',
        PHONE('+9613123456', '03123456'),
        'mona@example.com',
      );
      const mother = await createPatient(tenant, {
        fullName: 'Mona Haddad-Saleh',
        phone: PHONE('+9613999999', '03999999'),
        email: 'mona.saleh@example.com',
      });
      const linked = await inTenant(tenant, () =>
        contactsRepo.linkToPatient(contact.id, mother.id),
      );
      expect(linked).toMatchObject({ linkedPatientId: mother.id, fullName: null, phone: null });
      const stored = await database.ownerPool.query(
        `select full_name, name_key, phone, phone_search, email, linked_patient_id
         from contacts where id = $1`,
        [contact.id],
      );
      expect(stored.rows).toEqual([
        {
          full_name: null,
          name_key: null,
          phone: null,
          phone_search: null,
          email: null,
          linked_patient_id: mother.id,
        },
      ]);
      expect(view(await inTenant(tenant, () => contactsRepo.findById(contact.id)))).toEqual({
        id: contact.id,
        fullName: 'Mona Haddad-Saleh',
        phone: '+9613999999',
        email: 'mona.saleh@example.com',
        linkedPatient: { id: mother.id, displayNumber: mother.displayNumber, archived: false },
      });
      // Linked already: no second link, and no field edit either.
      expect(
        await inTenant(tenant, () => contactsRepo.linkToPatient(contact.id, mother.id)),
      ).toBeUndefined();
      expect(
        await inTenant(tenant, () => contactsRepo.update(contact.id, { fullName: 'Other' })),
      ).toBeUndefined();
      expect(
        await inTenant(tenant, () => contactsRepo.findByLinkedPatient(mother.id)),
      ).toMatchObject({ id: contact.id });
      // An archived patient still resolves (addendum C9).
      await inTenant(tenant, () => patientsRepo.setArchived([mother.id], new Date()));
      expect(
        view(await inTenant(tenant, () => contactsRepo.findById(contact.id))).linkedPatient,
      ).toEqual({ id: mother.id, displayNumber: mother.displayNumber, archived: true });
    });

    it('allows one live contact per linked patient', async () => {
      const tenant = newId();
      const patient = await createPatient(tenant, { fullName: 'Karim Haddad' });
      const first = await inTenant(tenant, () => contactsRepo.insertLinked(patient.id));
      expect(first).toMatchObject({ linkedPatientId: patient.id, fullName: null, nameKey: null });
      await expect(inTenant(tenant, () => contactsRepo.insertLinked(patient.id))).rejects.toThrow();
      const other = await createContact(tenant, 'Also Karim');
      await expect(
        inTenant(tenant, () => contactsRepo.linkToPatient(other.id, patient.id)),
      ).rejects.toThrow();
      await inTenant(tenant, () => contactsRepo.softDelete([first.id], new Date()));
      expect(
        await inTenant(tenant, () => contactsRepo.findByLinkedPatient(patient.id)),
      ).toBeUndefined();
      expect(await inTenant(tenant, () => contactsRepo.findById(first.id))).toBeUndefined();
      await expect(
        inTenant(tenant, () => contactsRepo.linkToPatient(other.id, patient.id)),
      ).resolves.toMatchObject({ linkedPatientId: patient.id });
    });

    it('updates a live unlinked contact and re-derives name_key and phone_search', async () => {
      const tenant = newId();
      const contact = await createContact(tenant, 'Old Name', PHONE('+9613111111', '03111111'));
      const updated = await inTenant(tenant, () =>
        contactsRepo.update(contact.id, {
          fullName: 'Nour Élias',
          phone: PHONE('+9613222222', '03222222'),
          email: 'nour@example.com',
        }),
      );
      expect(updated).toMatchObject({
        fullName: 'Nour Élias',
        nameKey: 'nour elias',
        phone: '+9613222222',
        phoneSearch: '9613222222 03222222',
        email: 'nour@example.com',
      });
      expect(
        (await inTenant(tenant, () => contactsRepo.lookup('03111', 10))).map((r) => r.contact.id),
      ).toEqual([]);
    });

    describe('lookup and findByPhoneDigits', () => {
      const tenant = newId();
      let jose: string;
      let linkedMother: string;
      let deleted: string;

      beforeAll(async () => {
        jose = (await createContact(tenant, 'José Álvarez', PHONE('+9613123456', '03123456'))).id;
        const mother = await createPatient(tenant, {
          fullName: 'Rania Josephine Haddad',
          phone: PHONE('+9617654321', '07654321'),
        });
        linkedMother = (await inTenant(tenant, () => contactsRepo.insertLinked(mother.id))).id;
        deleted = (await createContact(tenant, 'Josef Deleted', PHONE('+9613123457', '03123457')))
          .id;
        await inTenant(tenant, () => contactsRepo.softDelete([deleted], new Date()));
        await createContact(tenant, 'Unrelated Person', PHONE('+9611000000', '01000000'));
      });

      const lookup = (q: string, limit = 10) =>
        inTenant(tenant, () => contactsRepo.lookup(q, limit)).then((rows) =>
          rows.map((row) => row.contact.id),
        );

      it('matches resolved names diacritics-insensitively, ordered by name', async () => {
        expect(await lookup('JOSE')).toEqual([jose, linkedMother]);
        expect(await lookup('álvarez')).toEqual([jose]);
        expect(await lookup('rania')).toEqual([linkedMother]);
      });

      it('matches at least 2 digits of own or resolved phones, local or E.164', async () => {
        expect(await lookup('03 123')).toEqual([jose]);
        expect(await lookup('96131')).toEqual([jose]);
        expect(await lookup('0765')).toEqual([linkedMother]);
        expect(await lookup('7')).toEqual([]);
      });

      it('excludes soft-deleted contacts and honours the limit', async () => {
        expect(await lookup('josef')).toEqual([]);
        expect(await lookup('jos', 1)).toEqual([jose]);
      });

      it('finds contacts by the exact E.164 digits of their resolved phone', async () => {
        const byDigits = (digits: string) =>
          inTenant(tenant, () => contactsRepo.findByPhoneDigits(digits)).then((rows) =>
            rows.map((row) => row.contact.id),
          );
        expect(await byDigits('9613123456')).toEqual([jose]);
        expect(await byDigits('9617654321')).toEqual([linkedMother]);
        expect(await byDigits('961312345')).toEqual([]);
        expect(await byDigits('9613123457')).toEqual([]);
      });
    });
  });

  describe('PatientContactsRepository', () => {
    it('applies link plans: first holder primary, reassignment, promotion on unlink', async () => {
      const tenant = newId();
      const child = await createPatient(tenant, { fullName: 'Sami Haddad' });
      const mother = await createContact(tenant, 'Mona Haddad', PHONE('+9613123456', '03123456'));
      const father = await createContact(tenant, 'Karim Haddad');
      const aunt = await createContact(tenant, 'Aunt Leila');

      await linkAs(tenant, child.id, mother.id, { isGuardian: true, isBillingContact: true });
      await linkAs(tenant, child.id, father.id, { isGuardian: true, isEmergencyContact: true });
      await linkAs(tenant, child.id, aunt.id, { isGuardian: true }, 'other');
      const linksNow = () => inTenant(tenant, () => links.linksOf(child.id));
      expect(flagsOf(await linksNow())).toEqual({
        [mother.id]: [true, true, true, true, false, false],
        [father.id]: [true, false, false, false, true, true],
        [aunt.id]: [true, false, false, false, false, false],
      });

      // Swap the guardian primary: the unique index never sees two primaries.
      await change(tenant, child.id, {
        kind: 'update',
        contactId: father.id,
        makePrimary: ['guardian'],
      });
      expect(flagsOf(await linksNow())[father.id]?.[1]).toBe(true);
      expect(flagsOf(await linksNow())[mother.id]?.[1]).toBe(false);

      // Unlinking the primary promotes the oldest remaining holder (the mother).
      await change(tenant, child.id, { kind: 'unlink', contactId: father.id });
      expect(flagsOf(await linksNow())).toEqual({
        [mother.id]: [true, true, true, true, false, false],
        [aunt.id]: [true, false, false, false, false, false],
      });

      const list = await inTenant(tenant, () => links.listForPatient(child.id));
      expect(list.map((record) => record.contact.id)).toEqual([mother.id, aunt.id]);
      expect(list.map((record) => view(record).phone)).toEqual(['+9613123456', null]);
      expect(
        (await inTenant(tenant, () => links.listForContact(mother.id))).map((l) => l.patientId),
      ).toEqual([child.id]);
    });

    it('lists a patient contact that is itself a patient, resolved from that patient', async () => {
      const tenant = newId();
      const child = await createPatient(tenant, { fullName: 'Lina Haddad' });
      const father = await createPatient(tenant, {
        fullName: 'Karim Haddad',
        phone: PHONE('+9613555555', '03555555'),
      });
      const fatherContact = await inTenant(tenant, () => contactsRepo.insertLinked(father.id));
      await linkAs(tenant, child.id, fatherContact.id, { isBillingContact: true });
      const [record] = await inTenant(tenant, () => links.listForPatient(child.id));
      expect(record && resolveContact(record.contact, record.linkedPatient)).toEqual({
        id: fatherContact.id,
        fullName: 'Karim Haddad',
        phone: '+9613555555',
        email: null,
        linkedPatient: { id: father.id, displayNumber: father.displayNumber, archived: false },
      });
      expect(record?.link).toMatchObject({ isBillingContact: true, isPrimaryBilling: true });
    });

    it('patientsBilledBy returns the patients linking the contact as billing contact', async () => {
      const tenant = newId();
      const husband = await createContact(tenant, 'Karim Haddad');
      const wife = await createPatient(tenant, { fullName: 'Mona Haddad' });
      const son = await createPatient(tenant, { fullName: 'Sami Haddad' });
      const neighbour = await createPatient(tenant, { fullName: 'Neighbour' });
      await linkAs(tenant, wife.id, husband.id, { isBillingContact: true }, 'spouse');
      await linkAs(tenant, son.id, husband.id, { isGuardian: true, isBillingContact: true });
      await linkAs(tenant, neighbour.id, husband.id, { isEmergencyContact: true }, 'other');
      expect(await inTenant(tenant, () => links.patientsBilledBy(husband.id))).toEqual([
        wife.id,
        son.id,
      ]);
    });

    it('updateLink and unlink report whether the link existed', async () => {
      const tenant = newId();
      const patient = await createPatient(tenant);
      const contact = await createContact(tenant, 'Someone');
      const state = {
        patientId: patient.id,
        contactId: contact.id,
        relationship: 'other' as const,
        isGuardian: false,
        isBillingContact: false,
        isEmergencyContact: true,
        isPrimaryGuardian: false,
        isPrimaryBilling: false,
        isPrimaryEmergency: true,
      };
      expect(await inTenant(tenant, () => links.updateLink(state))).toBe(false);
      await inTenant(tenant, () => links.link(state));
      expect(
        await inTenant(tenant, () => links.updateLink({ ...state, relationship: 'sibling' })),
      ).toBe(true);
      expect((await inTenant(tenant, () => links.linksOf(patient.id)))[0]?.relationship).toBe(
        'sibling',
      );
      expect(await inTenant(tenant, () => links.unlink(state))).toBe(true);
      expect(await inTenant(tenant, () => links.unlink(state))).toBe(false);
    });

    it('applies a merge plan: moves, OR-ed duplicates, self-links removed, linked contact folded', async () => {
      const tenant = newId();
      // The mother has two records (kept, dropped); each has its own linked contact, used by her
      // children. Both records list the father; the dropped one also lists the grandmother.
      const kept = await createPatient(tenant, { fullName: 'Mona Haddad' });
      const dropped = await createPatient(tenant, { fullName: 'Mona Hadad' });
      const childA = await createPatient(tenant, { fullName: 'Child A' });
      const childB = await createPatient(tenant, { fullName: 'Child B' });
      const keptSelf = await inTenant(tenant, () => contactsRepo.insertLinked(kept.id));
      const droppedSelf = await inTenant(tenant, () => contactsRepo.insertLinked(dropped.id));
      const father = await createContact(tenant, 'Karim Haddad');
      const grandma = await createContact(tenant, 'Grandma');

      await linkAs(tenant, kept.id, father.id, { isEmergencyContact: true }, 'spouse');
      await linkAs(tenant, dropped.id, father.id, { isBillingContact: true }, 'spouse');
      await linkAs(tenant, dropped.id, grandma.id, { isEmergencyContact: true });
      await linkAs(tenant, childA.id, keptSelf.id, { isGuardian: true });
      await linkAs(tenant, childA.id, droppedSelf.id, { isBillingContact: true });
      await linkAs(tenant, childB.id, droppedSelf.id, { isGuardian: true, isBillingContact: true });

      await inTenant(tenant, () =>
        tenantDb.run(async () => {
          const withLinks = async (contactId: string) => ({
            contactId,
            links: await links.listForContact(contactId),
          });
          const plan = planContactMerge({
            keptId: kept.id,
            droppedId: dropped.id,
            keptLinks: await links.linksOf(kept.id),
            droppedLinks: await links.linksOf(dropped.id),
            keptLinkedContact: await withLinks(keptSelf.id),
            droppedLinkedContact: await withLinks(droppedSelf.id),
          });
          await links.applyMergePlan(dropped.id, plan);
          await contactsRepo.relink(plan.relinks, kept.id);
          await contactsRepo.softDelete(
            plan.folds.map((fold) => fold.fromContactId),
            new Date(),
          );
        }),
      );

      const linksOf = (patientId: string) => inTenant(tenant, () => links.linksOf(patientId));
      expect(await linksOf(dropped.id)).toEqual([]);
      expect(flagsOf(await linksOf(kept.id))).toEqual({
        // On both: roles OR-ed; the kept record's emergency primary stays, billing is new.
        [father.id]: [false, false, true, true, true, true],
        // Moved: the kept record already has an emergency primary (the father).
        [grandma.id]: [false, false, false, false, true, false],
      });
      expect((await linksOf(kept.id)).find((l) => l.contactId === father.id)?.relationship).toBe(
        'spouse',
      );
      // Folded: child A keeps one link to the mother (OR-ed), child B is re-pointed.
      expect(flagsOf(await linksOf(childA.id))).toEqual({
        [keptSelf.id]: [true, true, true, true, false, false],
      });
      expect(flagsOf(await linksOf(childB.id))).toEqual({
        [keptSelf.id]: [true, true, true, true, false, false],
      });
      expect(await inTenant(tenant, () => contactsRepo.findById(droppedSelf.id))).toBeUndefined();
      expect(await inTenant(tenant, () => contactsRepo.findByLinkedPatient(kept.id))).toMatchObject(
        {
          id: keptSelf.id,
        },
      );
    });

    it('re-points the dropped patient’s contact to the kept one when that has none', async () => {
      const tenant = newId();
      const kept = await createPatient(tenant, { fullName: 'Kept' });
      const dropped = await createPatient(tenant, { fullName: 'Dropped' });
      const child = await createPatient(tenant, { fullName: 'Child' });
      const droppedSelf = await inTenant(tenant, () => contactsRepo.insertLinked(dropped.id));
      await linkAs(tenant, child.id, droppedSelf.id, { isGuardian: true });
      // The kept record listed the dropped one as a contact: a self-link after the merge.
      await linkAs(tenant, kept.id, droppedSelf.id, { isEmergencyContact: true }, 'sibling');

      await inTenant(tenant, () =>
        tenantDb.run(async () => {
          const plan = planContactMerge({
            keptId: kept.id,
            droppedId: dropped.id,
            keptLinks: await links.linksOf(kept.id),
            droppedLinks: await links.linksOf(dropped.id),
            keptLinkedContact: null,
            droppedLinkedContact: {
              contactId: droppedSelf.id,
              links: await links.listForContact(droppedSelf.id),
            },
          });
          expect(plan.relinks).toEqual([droppedSelf.id]);
          await links.applyMergePlan(dropped.id, plan);
          await contactsRepo.relink(plan.relinks, kept.id);
        }),
      );

      expect(await inTenant(tenant, () => links.linksOf(kept.id))).toEqual([]);
      const record = await inTenant(tenant, () => contactsRepo.findById(droppedSelf.id));
      expect(view(record).linkedPatient?.id).toBe(kept.id);
      expect(
        (await inTenant(tenant, () => links.linksOf(child.id))).map((l) => l.contactId),
      ).toEqual([droppedSelf.id]);
    });
  });

  describe('contacts and patient_contacts: constraints', () => {
    const tenant = newId();
    let patientA: string;
    let patientB: string;

    /** Inserts through the owner pool (no RLS) with an explicit tenant; returns the contact id. */
    const insertContact = async (
      values: { fullName?: string; nameKey?: string; linkedPatientId?: string; deletedAt?: Date },
      tenantId = tenant,
    ): Promise<string> => {
      const id = newId();
      await database.ownerPool.query(
        `insert into contacts (id, tenant_id, full_name, name_key, linked_patient_id, deleted_at)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          tenantId,
          values.fullName ?? null,
          values.nameKey ?? (values.fullName ? values.fullName.toLowerCase() : null),
          values.linkedPatientId ?? null,
          values.deletedAt ?? null,
        ],
      );
      return id;
    };
    type Flag =
      | 'is_guardian'
      | 'is_billing_contact'
      | 'is_emergency_contact'
      | 'is_primary_guardian'
      | 'is_primary_billing'
      | 'is_primary_emergency';
    const insertLink = (
      patientId: string,
      contactId: string,
      flags: Partial<Record<Flag, boolean>>,
      tenantId = tenant,
    ) => {
      const columns = Object.keys(flags).map((column) => `, ${column}`);
      const params = Object.keys(flags).map((_, index) => `, $${String(index + 4)}`);
      return database.ownerPool.query(
        `insert into patient_contacts (tenant_id, patient_id, contact_id, relationship${columns.join('')})
         values ($1, $2, $3, 'parent'${params.join('')})`,
        [tenantId, patientId, contactId, ...Object.values(flags)],
      );
    };

    beforeAll(async () => {
      patientA = (await createPatient(tenant, { fullName: 'Child A' })).id;
      patientB = (await createPatient(tenant, { fullName: 'Child B' })).id;
    });

    it('rejects a contact with neither a linked patient nor a name', async () => {
      await expect(insertContact({})).rejects.toThrow(/contacts_linked_or_named/);
      await expect(insertContact({ fullName: 'Mona Haddad' })).resolves.toBeTypeOf('string');
      await expect(insertContact({ linkedPatientId: patientB })).resolves.toBeTypeOf('string');
    });

    it('keeps name_key present exactly when full_name is', async () => {
      const id = newId();
      await expect(
        database.ownerPool.query(
          `insert into contacts (id, tenant_id, full_name) values ($1, $2, 'No Key')`,
          [id, tenant],
        ),
      ).rejects.toThrow(/contacts_name_key_with_name/);
    });

    it('allows one live contact per linked patient; a soft-deleted one does not count', async () => {
      const linked = (await createPatient(tenant, { fullName: 'Linked Parent' })).id;
      await insertContact({ linkedPatientId: linked, deletedAt: new Date() });
      await insertContact({ linkedPatientId: linked });
      await expect(insertContact({ linkedPatientId: linked })).rejects.toThrow(
        /contacts_linked_patient_unique/,
      );
    });

    it('rejects a link without a role, and a primary flag without its role', async () => {
      const contact = await insertContact({ fullName: 'No Role' });
      await expect(insertLink(patientA, contact, {})).rejects.toThrow(/patient_contacts_has_role/);
      await expect(
        insertLink(patientA, contact, { is_billing_contact: true, is_primary_guardian: true }),
      ).rejects.toThrow(/patient_contacts_primary_guardian_role/);
      await expect(
        insertLink(patientA, contact, { is_guardian: true, is_primary_billing: true }),
      ).rejects.toThrow(/patient_contacts_primary_billing_role/);
      await expect(
        insertLink(patientA, contact, { is_guardian: true, is_primary_emergency: true }),
      ).rejects.toThrow(/patient_contacts_primary_emergency_role/);
    });

    it('allows one primary per role per patient', async () => {
      const mother = await insertContact({ fullName: 'Mother' });
      const father = await insertContact({ fullName: 'Father' });
      await insertLink(patientA, mother, { is_guardian: true, is_primary_guardian: true });
      await expect(
        insertLink(patientA, father, { is_guardian: true, is_primary_guardian: true }),
      ).rejects.toThrow(/patient_contacts_primary_guardian_unique/);
      // A second, non-primary guardian is fine; so is the same contact as primary elsewhere.
      await insertLink(patientA, father, { is_guardian: true, is_billing_contact: true });
      await insertLink(patientB, father, { is_guardian: true, is_primary_guardian: true });
      await insertLink(patientB, mother, { is_billing_contact: true, is_primary_billing: true });
      await expect(
        insertLink(patientB, father, { is_billing_contact: true, is_primary_billing: true }),
      ).rejects.toThrow(/patient_contacts_pk/);
    });

    it("never links a patient to another tenant's contact or patient (composite keys)", async () => {
      const otherTenant = newId();
      const otherPatient = (await createPatient(otherTenant, { fullName: 'Elsewhere' })).id;
      const otherContact = await insertContact({ fullName: 'Elsewhere' }, otherTenant);
      await expect(insertLink(patientA, otherContact, { is_guardian: true })).rejects.toThrow(
        /patient_contacts_contact_fk/,
      );
      const own = await insertContact({ fullName: 'Own' });
      await expect(insertLink(otherPatient, own, { is_guardian: true })).rejects.toThrow(
        /patient_contacts_patient_fk/,
      );
      await expect(insertContact({ linkedPatientId: otherPatient })).rejects.toThrow(
        /contacts_linked_patient_fk/,
      );
    });
  });

  describe('tenant isolation (RLS)', () => {
    it("tenant B neither sees nor changes tenant A's contacts and links", async () => {
      const tenantA = newId();
      const tenantB = newId();
      const child = await createPatient(tenantA, { fullName: 'A Child' });
      const mother = await createContact(tenantA, 'A Mother', PHONE('+9613123456', '03123456'));
      await linkAs(tenantA, child.id, mother.id, { isGuardian: true, isBillingContact: true });
      const linkedA = await inTenant(tenantA, () => contactsRepo.insertLinked(child.id));

      const inB = <T>(fn: () => Promise<T>) => inTenant(tenantB, fn);
      expect(await inB(() => contactsRepo.findById(mother.id))).toBeUndefined();
      expect(await inB(() => contactsRepo.findByIds([mother.id, linkedA.id]))).toEqual([]);
      expect(await inB(() => contactsRepo.lookup('mother', 10))).toEqual([]);
      expect(await inB(() => contactsRepo.lookup('03123', 10))).toEqual([]);
      expect(await inB(() => contactsRepo.findByPhoneDigits('9613123456'))).toEqual([]);
      expect(await inB(() => contactsRepo.findByLinkedPatient(child.id))).toBeUndefined();
      expect(await inB(() => links.listForPatient(child.id))).toEqual([]);
      expect(await inB(() => links.linksOf(child.id))).toEqual([]);
      expect(await inB(() => links.listForContact(mother.id))).toEqual([]);
      expect(await inB(() => links.patientsBilledBy(mother.id))).toEqual([]);

      expect(
        await inB(() => contactsRepo.update(mother.id, { fullName: 'Hijacked' })),
      ).toBeUndefined();
      expect(await inB(() => links.unlink({ patientId: child.id, contactId: mother.id }))).toBe(
        false,
      );
      await inB(() => contactsRepo.softDelete([mother.id], new Date()));
      expect(view(await inTenant(tenantA, () => contactsRepo.findById(mother.id))).fullName).toBe(
        'A Mother',
      );
      expect(await inTenant(tenantA, () => links.linksOf(child.id))).toHaveLength(1);
    });

    it('hides both tables from another tenant at the SQL level too', async () => {
      const tenant = newId();
      const patient = await createPatient(tenant);
      const contact = await createContact(tenant, 'Visible In A');
      await linkAs(tenant, patient.id, contact.id, { isEmergencyContact: true });
      const count = (tenantId: string, table: 'contacts' | 'patient_contacts') =>
        inTenant(tenantId, () =>
          tenantDb.run(async (tx) => {
            const result = await tx.execute<{ n: string }>(
              sql.raw(`select count(*) as n from ${table}`),
            );
            return Number(result.rows[0]?.n ?? 0);
          }),
        );
      expect(await count(tenant, 'contacts')).toBe(1);
      expect(await count(tenant, 'patient_contacts')).toBe(1);
      expect(await count(newId(), 'contacts')).toBe(0);
      expect(await count(newId(), 'patient_contacts')).toBe(0);
    });
  });
});
