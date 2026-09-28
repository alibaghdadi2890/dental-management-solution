import { describe, expect, it } from 'vitest';
import {
  ContactAlreadyLinkedError,
  ContactIsPatientError,
  ContactNotFoundError,
  ContactPrimaryWithoutRoleError,
  ContactRoleRequiredError,
} from './contact-errors';
import {
  assertNotOwnContact,
  assignPrimaries,
  type DomainContact,
  isOwnContact,
  type LinkedPatientFacts,
  type LinkState,
  type PatientLink,
  planContactMerge,
  planLinkChange,
  resolveContact,
} from './contacts';

const PATIENT = 'patient-1';
const KEPT = 'kept';
const DROPPED = 'dropped';

const NO_FLAGS = {
  isGuardian: false,
  isBillingContact: false,
  isEmergencyContact: false,
  isPrimaryGuardian: false,
  isPrimaryBilling: false,
  isPrimaryEmergency: false,
};

/** A link created on day `day` of January 2026 (the promotion order). */
function link(
  contactId: string,
  flags: Partial<Omit<PatientLink, 'contactId' | 'createdAt'>> = {},
  day = 1,
): PatientLink {
  return {
    patientId: PATIENT,
    contactId,
    relationship: 'parent',
    ...NO_FLAGS,
    ...flags,
    createdAt: new Date(Date.UTC(2026, 0, day)),
  };
}

/** The state the repository writes for a link: everything but `createdAt`. */
function state(value: PatientLink): LinkState {
  const { createdAt: _createdAt, ...rest } = value;
  return rest;
}

const guardian = { isGuardian: true };
const primaryGuardian = { isGuardian: true, isPrimaryGuardian: true };

describe('planLinkChange', () => {
  describe('link', () => {
    it('makes the first holder of each role its primary', () => {
      const plan = planLinkChange(PATIENT, [], {
        kind: 'link',
        contactId: 'mother',
        relationship: 'parent',
        roles: { isGuardian: true, isBillingContact: true, isEmergencyContact: false },
      });
      expect(plan).toEqual({
        deletes: [],
        updates: [],
        inserts: [
          {
            ...NO_FLAGS,
            patientId: PATIENT,
            contactId: 'mother',
            relationship: 'parent',
            isGuardian: true,
            isBillingContact: true,
            isPrimaryGuardian: true,
            isPrimaryBilling: true,
          },
        ],
      });
    });

    it('keeps the current primary when another holder is added', () => {
      const mother = link('mother', primaryGuardian);
      const plan = planLinkChange(PATIENT, [mother], {
        kind: 'link',
        contactId: 'father',
        relationship: 'parent',
        roles: { isGuardian: true, isBillingContact: false, isEmergencyContact: true },
      });
      expect(plan.updates).toEqual([]);
      expect(plan.inserts).toEqual([
        {
          ...NO_FLAGS,
          patientId: PATIENT,
          contactId: 'father',
          relationship: 'parent',
          isGuardian: true,
          isEmergencyContact: true,
          // The first emergency contact: primary for that role only.
          isPrimaryEmergency: true,
        },
      ]);
    });

    it('refuses a link without a role, and a contact already linked', () => {
      const roles = { isGuardian: false, isBillingContact: false, isEmergencyContact: false };
      expect(() =>
        planLinkChange(PATIENT, [], { kind: 'link', contactId: 'x', relationship: 'other', roles }),
      ).toThrow(ContactRoleRequiredError);
      expect(() =>
        planLinkChange(PATIENT, [link('mother', primaryGuardian)], {
          kind: 'link',
          contactId: 'mother',
          relationship: 'parent',
          roles: { ...roles, isBillingContact: true },
        }),
      ).toThrow(ContactAlreadyLinkedError);
    });
  });

  describe('update', () => {
    it('an explicit primary clears the previous holder', () => {
      const mother = link('mother', primaryGuardian, 1);
      const father = link('father', guardian, 2);
      const plan = planLinkChange(PATIENT, [mother, father], {
        kind: 'update',
        contactId: 'father',
        makePrimary: ['guardian'],
      });
      expect(plan).toEqual({
        deletes: [],
        updates: [
          { ...state(mother), isPrimaryGuardian: false },
          { ...state(father), isPrimaryGuardian: true },
        ],
        inserts: [],
      });
    });

    it('can give a role and make it primary in one change', () => {
      const mother = link('mother', {
        ...primaryGuardian,
        isBillingContact: true,
        isPrimaryBilling: true,
      });
      const father = link('father', guardian, 2);
      const plan = planLinkChange(PATIENT, [mother, father], {
        kind: 'update',
        contactId: 'father',
        roles: { isBillingContact: true },
        makePrimary: ['billing'],
      });
      expect(plan.updates).toEqual([
        { ...state(mother), isPrimaryBilling: false },
        { ...state(father), isBillingContact: true, isPrimaryBilling: true },
      ]);
    });

    it('rejects a primary flag without its role, even when the same change removes the role', () => {
      const mother = link('mother', primaryGuardian);
      const father = link('father', { isEmergencyContact: true, isPrimaryEmergency: true }, 2);
      expect(() =>
        planLinkChange(PATIENT, [mother, father], {
          kind: 'update',
          contactId: 'father',
          makePrimary: ['guardian'],
        }),
      ).toThrow(ContactPrimaryWithoutRoleError);
      expect(() =>
        planLinkChange(PATIENT, [mother, father], {
          kind: 'update',
          contactId: 'mother',
          roles: { isGuardian: false, isBillingContact: true },
          makePrimary: ['guardian'],
        }),
      ).toThrow(ContactPrimaryWithoutRoleError);
    });

    it('removing a role from its primary promotes the oldest remaining holder', () => {
      const mother = link(
        'mother',
        { ...primaryGuardian, isBillingContact: true, isPrimaryBilling: true },
        1,
      );
      const aunt = link('aunt', guardian, 5);
      const father = link('father', guardian, 3);
      const plan = planLinkChange(PATIENT, [mother, aunt, father], {
        kind: 'update',
        contactId: 'mother',
        roles: { isGuardian: false },
      });
      expect(plan.updates).toEqual([
        { ...state(mother), isGuardian: false, isPrimaryGuardian: false },
        { ...state(father), isPrimaryGuardian: true },
      ]);
    });

    it('refuses to remove the last role (unlink instead)', () => {
      const mother = link('mother', primaryGuardian);
      expect(() =>
        planLinkChange(PATIENT, [mother], {
          kind: 'update',
          contactId: 'mother',
          roles: { isGuardian: false },
        }),
      ).toThrow(ContactRoleRequiredError);
    });

    it('changes only the relationship when that is all the change says', () => {
      const mother = link('mother', primaryGuardian);
      expect(
        planLinkChange(PATIENT, [mother], {
          kind: 'update',
          contactId: 'mother',
          relationship: 'caregiver',
        }),
      ).toEqual({
        deletes: [],
        updates: [{ ...state(mother), relationship: 'caregiver' }],
        inserts: [],
      });
    });

    it('plans nothing for a change that changes nothing', () => {
      const mother = link('mother', primaryGuardian);
      expect(
        planLinkChange(PATIENT, [mother], {
          kind: 'update',
          contactId: 'mother',
          relationship: 'parent',
          roles: { isGuardian: true },
          makePrimary: ['guardian'],
        }),
      ).toEqual({ deletes: [], updates: [], inserts: [] });
    });

    it('refuses a contact that is not linked', () => {
      expect(() =>
        planLinkChange(PATIENT, [], { kind: 'update', contactId: 'x', relationship: 'other' }),
      ).toThrow(ContactNotFoundError);
    });
  });

  describe('unlink', () => {
    it('unlinking a primary promotes the oldest remaining holder, ties broken by contact id', () => {
      const mother = link('mother', primaryGuardian, 1);
      const zed = link('zed', guardian, 2);
      const father = link('father', guardian, 2);
      const plan = planLinkChange(PATIENT, [mother, zed, father], {
        kind: 'unlink',
        contactId: 'mother',
      });
      expect(plan).toEqual({
        deletes: [{ patientId: PATIENT, contactId: 'mother' }],
        updates: [{ ...state(father), isPrimaryGuardian: true }],
        inserts: [],
      });
    });

    it('unlinking a non-primary holder changes no other link', () => {
      const mother = link('mother', primaryGuardian, 1);
      const father = link('father', guardian, 2);
      expect(
        planLinkChange(PATIENT, [mother, father], { kind: 'unlink', contactId: 'father' }),
      ).toEqual({
        deletes: [{ patientId: PATIENT, contactId: 'father' }],
        updates: [],
        inserts: [],
      });
    });

    it('refuses a contact that is not linked', () => {
      expect(() => planLinkChange(PATIENT, [], { kind: 'unlink', contactId: 'x' })).toThrow(
        ContactNotFoundError,
      );
    });
  });
});

describe('assignPrimaries', () => {
  it('takes the first candidate that holds the role, else the oldest holder; clears the rest', () => {
    const a = { ...link('a', { ...primaryGuardian, isBillingContact: true }, 3) };
    const b = {
      ...link('b', { isGuardian: true, isPrimaryBilling: false, isBillingContact: true }, 2),
    };
    const c = { ...link('c', { isEmergencyContact: true, isPrimaryGuardian: false }, 1) };
    const result = assignPrimaries([a, b, c], {
      // `c` is no guardian, so the next candidate wins.
      guardian: ['c', 'b'],
    });
    expect(
      result.map((value) => [
        value.contactId,
        value.isPrimaryGuardian,
        value.isPrimaryBilling,
        value.isPrimaryEmergency,
      ]),
    ).toEqual([
      ['a', false, false, false],
      ['b', true, true, false],
      ['c', false, false, true],
    ]);
  });

  it('ranks links without a creation time (not yet inserted) after every existing one', () => {
    const existing = { ...link('z', guardian, 9) };
    const fresh = { ...state(link('a', guardian)), createdAt: null };
    const [first, second] = assignPrimaries([fresh, existing], {});
    expect(first?.isPrimaryGuardian).toBe(false);
    expect(second?.isPrimaryGuardian).toBe(true);
  });
});

describe('planContactMerge', () => {
  const kept = (contactId: string, flags: Parameters<typeof link>[1] = {}, day = 1) => ({
    ...link(contactId, flags, day),
    patientId: KEPT,
  });
  const dropped = (contactId: string, flags: Parameters<typeof link>[1] = {}, day = 1) => ({
    ...link(contactId, flags, day),
    patientId: DROPPED,
  });
  const on = (
    patientId: string,
    contactId: string,
    flags: Parameters<typeof link>[1] = {},
    day = 1,
  ) => ({
    ...link(contactId, flags, day),
    patientId,
  });
  const empty = {
    keptId: KEPT,
    droppedId: DROPPED,
    keptLinks: [],
    droppedLinks: [],
    droppedLinkedContact: null,
    keptLinkedContact: null,
  };

  it('plans nothing when neither record has contacts', () => {
    expect(planContactMerge(empty)).toEqual({
      deletes: [],
      updates: [],
      moves: [],
      relinks: [],
      folds: [],
    });
  });

  it('moves the dropped record’s contacts; the kept record’s primaries win', () => {
    const mother = kept('mother', primaryGuardian, 1);
    const father = dropped(
      'father',
      { ...primaryGuardian, isBillingContact: true, isPrimaryBilling: true },
      2,
    );
    const plan = planContactMerge({ ...empty, keptLinks: [mother], droppedLinks: [father] });
    expect(plan).toEqual({
      deletes: [],
      updates: [],
      // A dropped primary stays primary only where the kept record has none (billing).
      moves: [{ ...state(father), patientId: KEPT, isPrimaryGuardian: false }],
      relinks: [],
      folds: [],
    });
  });

  it('merges a contact on both records: roles OR-ed, kept relationship and primaries win', () => {
    const keptMother = kept('mother', { ...primaryGuardian, relationship: 'caregiver' }, 1);
    const aunt = kept('aunt', { isBillingContact: true, isPrimaryBilling: true }, 2);
    const droppedMother = dropped(
      'mother',
      { isBillingContact: true, isPrimaryBilling: true, isEmergencyContact: true },
      1,
    );
    const plan = planContactMerge({
      ...empty,
      keptLinks: [keptMother, aunt],
      droppedLinks: [droppedMother],
    });
    expect(plan).toEqual({
      deletes: [{ patientId: DROPPED, contactId: 'mother' }],
      updates: [
        {
          ...state(keptMother),
          isBillingContact: true,
          isEmergencyContact: true,
          // Only emergency had no holder on the kept record: its only holder becomes primary.
          isPrimaryEmergency: true,
        },
      ],
      moves: [],
      relinks: [],
      folds: [],
    });
  });

  it('removes links that would make the kept patient its own contact, then promotes', () => {
    // `keptSelf` is the contact linked to the kept patient; `droppedSelf` the one linked to the
    // dropped patient (re-pointed to the kept one). Neither may stay on the kept patient's list.
    const keptOwnOnDropped = dropped('keptSelf', primaryGuardian, 1);
    const droppedSelfOnKept = kept('droppedSelf', primaryGuardian, 1);
    const uncle = dropped('uncle', guardian, 4);
    const grandma = kept('grandma', guardian, 3);
    const plan = planContactMerge({
      ...empty,
      keptLinks: [droppedSelfOnKept, grandma],
      droppedLinks: [keptOwnOnDropped, uncle],
      keptLinkedContact: { contactId: 'keptSelf', links: [keptOwnOnDropped] },
      droppedLinkedContact: { contactId: 'droppedSelf', links: [droppedSelfOnKept] },
    });
    expect(plan.deletes).toEqual([
      { patientId: KEPT, contactId: 'droppedSelf' },
      { patientId: DROPPED, contactId: 'keptSelf' },
    ]);
    // The oldest remaining guardian (grandma, day 3) is promoted; the moved uncle is not.
    expect(plan.updates).toEqual([{ ...state(grandma), isPrimaryGuardian: true }]);
    expect(plan.moves).toEqual([{ ...state(uncle), patientId: KEPT }]);
    expect(plan.folds).toEqual([
      { fromContactId: 'droppedSelf', intoContactId: 'keptSelf', repoints: [] },
    ]);
    expect(plan.relinks).toEqual([]);
  });

  it('uses the dropped primary when the kept one was removed as a self-link', () => {
    const selfOnKept = kept('droppedSelf', primaryGuardian, 1);
    const grandma = kept('grandma', guardian, 2);
    const uncle = dropped('uncle', primaryGuardian, 5);
    const plan = planContactMerge({
      ...empty,
      keptLinks: [selfOnKept, grandma],
      droppedLinks: [uncle],
      droppedLinkedContact: { contactId: 'droppedSelf', links: [selfOnKept] },
    });
    expect(plan.updates).toEqual([]);
    expect(plan.moves).toEqual([{ ...state(uncle), patientId: KEPT }]);
  });

  it('re-points the contact linked to the dropped patient when the kept one has none', () => {
    const asMother = on('child', 'droppedSelf', primaryGuardian);
    const plan = planContactMerge({
      ...empty,
      droppedLinkedContact: { contactId: 'droppedSelf', links: [asMother] },
    });
    expect(plan).toEqual({
      deletes: [],
      updates: [],
      moves: [],
      relinks: ['droppedSelf'],
      folds: [],
    });
  });

  it('folds the dropped patient’s contact into the kept patient’s: links moved, deduplicated', () => {
    // The mother had two records; each had its own contact row, linked to her children.
    const keptOnChildA = on('childA', 'keptSelf', guardian, 1);
    const droppedOnChildA = on(
      'childA',
      'droppedSelf',
      { isBillingContact: true, isPrimaryBilling: true, isGuardian: true, isPrimaryGuardian: true },
      2,
    );
    const droppedOnChildB = on(
      'childB',
      'droppedSelf',
      { isEmergencyContact: true, isPrimaryEmergency: true },
      3,
    );
    const plan = planContactMerge({
      ...empty,
      keptLinkedContact: { contactId: 'keptSelf', links: [keptOnChildA] },
      droppedLinkedContact: {
        contactId: 'droppedSelf',
        links: [droppedOnChildA, droppedOnChildB],
      },
    });
    expect(plan).toEqual({
      deletes: [{ patientId: 'childA', contactId: 'droppedSelf' }],
      updates: [
        {
          ...state(keptOnChildA),
          isBillingContact: true,
          isPrimaryBilling: true,
          isPrimaryGuardian: true,
        },
      ],
      moves: [],
      relinks: [],
      folds: [
        {
          fromContactId: 'droppedSelf',
          intoContactId: 'keptSelf',
          repoints: [{ patientId: 'childB', contactId: 'droppedSelf' }],
        },
      ],
    });
  });
});

describe('resolveContact', () => {
  const at = new Date('2026-01-01T00:00:00Z');
  const contact = (overrides: Partial<DomainContact> = {}): DomainContact => ({
    id: 'contact-1',
    fullName: 'Mona Haddad',
    nameKey: 'mona haddad',
    phone: '+9613123456',
    phoneSearch: '9613123456 03123456',
    email: 'mona@example.com',
    linkedPatientId: null,
    deletedAt: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  });
  const patient: LinkedPatientFacts = {
    id: 'patient-9',
    displayNumber: 'P-000009',
    fullName: 'Mona Haddad-Saleh',
    phone: null,
    email: 'mona.saleh@example.com',
    deletedAt: null,
  };
  const linked = contact({
    fullName: null,
    nameKey: null,
    phone: null,
    phoneSearch: null,
    email: null,
    linkedPatientId: 'patient-9',
  });

  it('reads an unlinked contact’s own fields', () => {
    expect(resolveContact(contact())).toEqual({
      id: 'contact-1',
      fullName: 'Mona Haddad',
      phone: '+9613123456',
      email: 'mona@example.com',
      linkedPatient: null,
    });
  });

  it('reads a linked contact’s name, phone and e-mail from the patient', () => {
    expect(resolveContact(linked, patient)).toEqual({
      id: 'contact-1',
      fullName: 'Mona Haddad-Saleh',
      phone: null,
      email: 'mona.saleh@example.com',
      linkedPatient: { id: 'patient-9', displayNumber: 'P-000009', archived: false },
    });
  });

  it('still resolves a contact linked to an archived patient, flagged archived', () => {
    expect(resolveContact(linked, { ...patient, deletedAt: at }).linkedPatient).toEqual({
      id: 'patient-9',
      displayNumber: 'P-000009',
      archived: true,
    });
  });

  it('throws when the linked patient is missing or another one', () => {
    expect(() => resolveContact(linked)).toThrow(/linked patient/);
    expect(() => resolveContact(linked, { ...patient, id: 'other' })).toThrow(/linked patient/);
  });
});

describe('isOwnContact / assertNotOwnContact', () => {
  it('detects a contact linked to the patient itself', () => {
    expect(isOwnContact('p1', { linkedPatientId: 'p1' })).toBe(true);
    expect(isOwnContact('p1', { linkedPatientId: 'p2' })).toBe(false);
    expect(isOwnContact('p1', { linkedPatientId: null })).toBe(false);
    expect(() => {
      assertNotOwnContact('p1', { linkedPatientId: 'p1' });
    }).toThrow(ContactIsPatientError);
    expect(() => {
      assertNotOwnContact('p1', { linkedPatientId: 'p2' });
    }).not.toThrow();
  });
});
