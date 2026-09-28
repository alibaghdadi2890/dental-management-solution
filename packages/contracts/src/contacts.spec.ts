import { describe, expect, it } from 'vitest';
import {
  CONTACT_RELATIONSHIPS,
  contactLinkInputSchema,
  contactLinkPatchSchema,
  contactLinkTargetSchema,
  contactLookupItemSchema,
  contactLookupQuerySchema,
  contactPatchSchema,
  contactRelationshipSchema,
  contactRolesSchema,
  contactViewSchema,
  patientContactSchema,
} from './contacts.js';

const ID_A = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e';
const ID_B = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6f';

const NEW_CONTACT = { fullName: 'Mona Haddad', phone: '03 123 456' };

describe('contactRelationshipSchema', () => {
  it('accepts exactly the six relationships', () => {
    expect(CONTACT_RELATIONSHIPS).toEqual([
      'parent',
      'spouse',
      'child',
      'sibling',
      'caregiver',
      'other',
    ]);
    for (const relationship of CONTACT_RELATIONSHIPS) {
      expect(contactRelationshipSchema.parse(relationship)).toBe(relationship);
    }
    expect(contactRelationshipSchema.safeParse('cousin').success).toBe(false);
    expect(contactRelationshipSchema.safeParse('Parent').success).toBe(false);
  });
});

describe('contactRolesSchema', () => {
  it('requires at least one role', () => {
    expect(
      contactRolesSchema.safeParse({
        isGuardian: false,
        isBillingContact: false,
        isEmergencyContact: false,
      }).success,
    ).toBe(false);
    expect(contactRolesSchema.parse({ isEmergencyContact: true })).toEqual({
      isGuardian: false,
      isBillingContact: false,
      isEmergencyContact: true,
    });
  });
});

describe('contactLinkTargetSchema', () => {
  it('accepts exactly one of contactId, patientId or newContact', () => {
    expect(contactLinkTargetSchema.parse({ contactId: ID_A })).toEqual({ contactId: ID_A });
    expect(contactLinkTargetSchema.parse({ patientId: ID_A })).toEqual({ patientId: ID_A });
    expect(contactLinkTargetSchema.parse({ newContact: NEW_CONTACT })).toEqual({
      newContact: { ...NEW_CONTACT, email: null },
    });
  });

  it('rejects none, or more than one, of them', () => {
    expect(contactLinkTargetSchema.safeParse({}).success).toBe(false);
    expect(contactLinkTargetSchema.safeParse({ contactId: ID_A, patientId: ID_B }).success).toBe(
      false,
    );
    expect(
      contactLinkTargetSchema.safeParse({ contactId: ID_A, newContact: NEW_CONTACT }).success,
    ).toBe(false);
    expect(
      contactLinkTargetSchema.safeParse({ patientId: ID_A, newContact: NEW_CONTACT }).success,
    ).toBe(false);
  });

  it('requires a name and a phone for a new contact; the e-mail is optional but validated', () => {
    const target = (newContact: Record<string, unknown>) =>
      contactLinkTargetSchema.safeParse({ newContact }).success;
    expect(target({ phone: '03 123 456' })).toBe(false);
    expect(target({ fullName: 'Mona Haddad' })).toBe(false);
    expect(target({ fullName: '  ', phone: '03 123 456' })).toBe(false);
    expect(target({ fullName: 'Mona Haddad', phone: '   ' })).toBe(false);
    expect(target({ ...NEW_CONTACT, email: 'not-an-email' })).toBe(false);
    expect(
      contactLinkTargetSchema.parse({
        newContact: { ...NEW_CONTACT, email: ' Mona@Example.com ' },
      }),
    ).toEqual({ newContact: { ...NEW_CONTACT, email: 'mona@example.com' } });
  });

  it('rejects ids that are not uuids', () => {
    expect(contactLinkTargetSchema.safeParse({ contactId: 'x' }).success).toBe(false);
  });
});

describe('contactLinkInputSchema', () => {
  it('takes a target, a relationship and the roles (defaulting to false)', () => {
    expect(
      contactLinkInputSchema.parse({
        target: { contactId: ID_A },
        relationship: 'parent',
        isGuardian: true,
      }),
    ).toEqual({
      target: { contactId: ID_A },
      relationship: 'parent',
      isGuardian: true,
      isBillingContact: false,
      isEmergencyContact: false,
    });
  });

  it('requires at least one role and a known relationship', () => {
    expect(
      contactLinkInputSchema.safeParse({ target: { contactId: ID_A }, relationship: 'parent' })
        .success,
    ).toBe(false);
    expect(
      contactLinkInputSchema.safeParse({
        target: { contactId: ID_A },
        relationship: 'neighbour',
        isGuardian: true,
      }).success,
    ).toBe(false);
  });
});

describe('contactLinkPatchSchema', () => {
  it('accepts a partial relationship, roles and primaries', () => {
    expect(contactLinkPatchSchema.parse({ relationship: 'caregiver' })).toEqual({
      relationship: 'caregiver',
    });
    expect(contactLinkPatchSchema.parse({ isBillingContact: true, isGuardian: false })).toEqual({
      isBillingContact: true,
      isGuardian: false,
    });
    expect(contactLinkPatchSchema.parse({ isPrimaryGuardian: true })).toEqual({
      isPrimaryGuardian: true,
    });
  });

  it('rejects an empty patch', () => {
    expect(contactLinkPatchSchema.safeParse({}).success).toBe(false);
  });

  it('only ever makes a contact primary (another contact takes over by becoming primary)', () => {
    expect(contactLinkPatchSchema.safeParse({ isPrimaryBilling: false }).success).toBe(false);
  });

  it('rejects a patch that plainly contradicts itself', () => {
    expect(
      contactLinkPatchSchema.safeParse({ isGuardian: false, isPrimaryGuardian: true }).success,
    ).toBe(false);
    expect(
      contactLinkPatchSchema.safeParse({
        isGuardian: false,
        isBillingContact: false,
        isEmergencyContact: false,
      }).success,
    ).toBe(false);
  });
});

describe('contactPatchSchema', () => {
  it('accepts a name, a phone and an e-mail, each optional; the e-mail can be cleared', () => {
    expect(contactPatchSchema.parse({ fullName: ' Mona Haddad ' })).toEqual({
      fullName: 'Mona Haddad',
    });
    expect(contactPatchSchema.parse({ phone: '03 123 456', email: '' })).toEqual({
      phone: '03 123 456',
      email: null,
    });
  });

  it('rejects an empty patch, a blank name and a blank phone', () => {
    expect(contactPatchSchema.safeParse({}).success).toBe(false);
    expect(contactPatchSchema.safeParse({ fullName: ' ' }).success).toBe(false);
    expect(contactPatchSchema.safeParse({ phone: ' ' }).success).toBe(false);
  });
});

describe('contactViewSchema and patientContactSchema', () => {
  const view = {
    id: ID_A,
    fullName: 'Mona Haddad',
    phone: '+9613123456',
    email: null,
    linkedPatient: { id: ID_B, displayNumber: 'P-000042', archived: false },
  };

  it('describes a resolved contact, linked to a patient or not', () => {
    expect(contactViewSchema.parse(view)).toEqual(view);
    const unlinked = { ...view, phone: null, linkedPatient: null };
    expect(contactViewSchema.parse(unlinked)).toEqual(unlinked);
    expect(
      contactViewSchema.safeParse({
        ...view,
        linkedPatient: { ...view.linkedPatient, displayNumber: '42' },
      }).success,
    ).toBe(false);
  });

  it('describes a patient contact: the contact, relationship, roles and primaries', () => {
    const link = {
      contact: view,
      relationship: 'parent',
      isGuardian: true,
      isBillingContact: true,
      isEmergencyContact: false,
      isPrimaryGuardian: true,
      isPrimaryBilling: false,
      isPrimaryEmergency: false,
    };
    expect(patientContactSchema.parse(link)).toEqual(link);
    expect(patientContactSchema.safeParse({ ...link, isPrimaryGuardian: undefined }).success).toBe(
      false,
    );
  });
});

describe('contactLookupQuerySchema and contactLookupItemSchema', () => {
  it('trims q and requires 1–100 characters', () => {
    expect(contactLookupQuerySchema.parse({ q: ' 0312 ' })).toEqual({ q: '0312' });
    expect(contactLookupQuerySchema.safeParse({ q: '  ' }).success).toBe(false);
    expect(contactLookupQuerySchema.safeParse({}).success).toBe(false);
    expect(contactLookupQuerySchema.safeParse({ q: 'a'.repeat(101) }).success).toBe(false);
    expect(contactLookupQuerySchema.safeParse({ q: 'a'.repeat(100) }).success).toBe(true);
  });

  it('is either a contact or a patient, told apart by kind', () => {
    const contact = {
      kind: 'contact',
      contact: {
        id: ID_A,
        fullName: 'Mona Haddad',
        phone: '+9613123456',
        email: null,
        linkedPatient: null,
      },
    };
    const patient = {
      kind: 'patient',
      patient: {
        id: ID_B,
        displayNumber: 'P-000007',
        fullName: 'Karim Haddad',
        phone: null,
        dateOfBirth: '1985-04-02',
      },
    };
    expect(contactLookupItemSchema.parse(contact)).toEqual(contact);
    expect(contactLookupItemSchema.parse(patient)).toEqual(patient);
    expect(contactLookupItemSchema.safeParse({ ...patient, kind: 'contact' }).success).toBe(false);
  });
});
