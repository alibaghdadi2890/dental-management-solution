import type { PatientContact } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import { mergeContacts } from './merge-contacts';

const KEPT = { id: 'kept', displayNumber: 'P-000001' };
const DROPPED = { id: 'dropped', displayNumber: 'P-000002' };

function link(
  contactId: string,
  extra: Partial<PatientContact> = {},
  linkedPatient: PatientContact['contact']['linkedPatient'] = null,
): PatientContact {
  return {
    contact: { id: contactId, fullName: contactId, phone: null, email: null, linkedPatient },
    relationship: 'parent',
    isGuardian: false,
    isBillingContact: false,
    isEmergencyContact: false,
    isPrimaryGuardian: false,
    isPrimaryBilling: false,
    isPrimaryEmergency: false,
    ...extra,
  };
}

describe('mergeContacts', () => {
  it('keeps the kept record’s contacts first, then the dropped one’s new ones', () => {
    const result = mergeContacts(
      { patient: KEPT, contacts: [link('a', { isGuardian: true })] },
      { patient: DROPPED, contacts: [link('b', { isEmergencyContact: true })] },
    );
    expect(result.kept.map(({ contact, from }) => [contact.id, from])).toEqual([
      ['a', ['P-000001']],
      ['b', ['P-000002']],
    ]);
    expect(result.removed).toEqual([]);
  });

  it('lists a contact on both once: the kept relationship, the roles OR-ed', () => {
    const result = mergeContacts(
      { patient: KEPT, contacts: [link('a', { relationship: 'parent', isGuardian: true })] },
      {
        patient: DROPPED,
        contacts: [link('a', { relationship: 'caregiver', isBillingContact: true })],
      },
    );
    expect(result.kept).toEqual([
      {
        contact: expect.objectContaining({ id: 'a' }) as unknown,
        relationship: 'parent',
        roles: { guardian: true, billing: true, emergency: false },
        from: ['P-000001', 'P-000002'],
      },
    ]);
  });

  it('sets apart a contact that is one of the two records (the merge drops that link)', () => {
    const selfOfDropped = link('c', { isEmergencyContact: true }, { ...DROPPED, archived: false });
    const selfOfKept = link('d', { isGuardian: true }, { ...KEPT, archived: false });
    const result = mergeContacts(
      { patient: KEPT, contacts: [selfOfDropped] },
      { patient: DROPPED, contacts: [selfOfKept, link('e', { isGuardian: true })] },
    );
    expect(result.kept.map(({ contact }) => contact.id)).toEqual(['e']);
    expect(result.removed.map(({ contact, number }) => [contact.id, number])).toEqual([
      ['c', 'P-000002'],
      ['d', 'P-000001'],
    ]);
  });
});
