import type { FamilySuggestion } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import { initialDraft, payerOptions, peopleOf, toLinkInput, withPayer } from './family-review';

const TODAY = '2026-11-18';
const id = (n: number) => `0192${String(n).padStart(4, '0')}-0000-7000-8000-000000000000`;

const patient = (
  n: number,
  fullName: string,
  dateOfBirth: string | null,
  extra: { contactIds?: string[]; selfContactId?: string | null } = {},
) => ({
  id: id(n),
  fullName,
  displayNumber: `P-${String(n).padStart(6, '0')}`,
  dateOfBirth,
  contactIds: extra.contactIds ?? [],
  selfContactId: extra.selfContactId ?? null,
});

const family = (
  patients: FamilySuggestion['patients'],
  contacts: FamilySuggestion['contacts'] = [],
): FamilySuggestion => ({
  phoneKey: '9613123456',
  phone: '+9613123456',
  sameFamilyName: true,
  patients,
  contacts,
});

describe('family review', () => {
  it('offers contacts, then adults oldest first (no date of birth last), then someone new', () => {
    const options = payerOptions(
      family(
        [
          patient(1, 'Lina Haddad', '2016-01-01'),
          patient(2, 'Rami Haddad', null),
          patient(3, 'Fadi Haddad', '1980-01-01'),
        ],
        [{ id: id(9), fullName: 'Mona Haddad' }],
      ),
      TODAY,
    );
    expect(options.map((option) => option.key)).toEqual([
      `contact:${id(9)}`,
      `patient:${id(3)}`,
      `patient:${id(2)}`,
      'new',
    ]);
  });

  it('starts with the first contact: a minor as guardian and billing, an adult as billing', () => {
    const draft = initialDraft(
      family(
        [patient(1, 'Lina Haddad', '2016-01-01'), patient(2, 'Rami Haddad', '1990-01-01')],
        [{ id: id(9), fullName: 'Mona Haddad' }],
      ),
      TODAY,
    );
    expect(draft.payerKey).toBe(`contact:${id(9)}`);
    expect(
      draft.members.map((member) => [
        member.relationship,
        member.isGuardian,
        member.isBillingContact,
      ]),
    ).toEqual([
      ['parent', true, true],
      ['other', false, true],
    ]);
  });

  it('leaves out the payer patient and anyone already linked to the payer', () => {
    const fam = family([
      patient(3, 'Fadi Haddad', '1980-01-01', { selfContactId: id(30) }),
      patient(1, 'Lina Haddad', '2016-01-01', { contactIds: [id(30)] }),
      patient(2, 'Omar Haddad', '2018-01-01'),
    ]);
    const draft = initialDraft(fam, TODAY);
    expect(draft.payerKey).toBe(`patient:${id(3)}`);
    expect(draft.members.map((member) => [member.fullName, member.alreadyLinked])).toEqual([
      ['Lina Haddad', true],
      ['Omar Haddad', false],
    ]);
    expect(toLinkInput(fam, draft)).toEqual({
      payer: { patientId: id(3) },
      members: [
        { patientId: id(2), relationship: 'parent', isGuardian: true, isBillingContact: true },
      ],
    });
  });

  it('needs a name for someone new, and sends the shared phone', () => {
    const fam = family([
      patient(1, 'Lina Haddad', '2016-01-01'),
      patient(2, 'Omar Haddad', '2018-01-01'),
    ]);
    const draft = initialDraft(fam, TODAY);
    expect(draft.payerKey).toBe('new');
    expect(toLinkInput(fam, draft)).toBeNull();
    expect(toLinkInput(fam, { ...draft, newName: ' Mona Haddad ' })?.payer).toEqual({
      newContact: { fullName: 'Mona Haddad', phone: '+9613123456', email: null },
    });
  });

  it('sends nothing without a member, or with a member without a role', () => {
    const fam = family(
      [patient(1, 'Lina Haddad', '2016-01-01')],
      [{ id: id(9), fullName: 'Mona Haddad' }],
    );
    const draft = initialDraft(fam, TODAY);
    const [lina] = draft.members;
    if (!lina) throw new Error('no member');
    expect(toLinkInput(fam, { ...draft, members: [{ ...lina, include: false }] })).toBeNull();
    expect(
      toLinkInput(fam, {
        ...draft,
        members: [{ ...lina, isGuardian: false, isBillingContact: false }],
      }),
    ).toBeNull();
    expect(withPayer(fam, draft, 'new', TODAY).members).toHaveLength(1);
    expect(peopleOf(fam)).toEqual([id(1), id(9)]);
  });
});
