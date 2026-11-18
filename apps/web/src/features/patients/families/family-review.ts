import type { ContactRelationship, FamilyLinkInput, FamilySuggestion } from '@dcm/contracts';
import { minorOn } from '../patient-form';

/** Who a family's card can link the others to (families B, F7). */
export type PayerOption =
  | { key: string; kind: 'contact'; id: string; fullName: string }
  | { key: string; kind: 'patient'; id: string; fullName: string; displayNumber: string }
  | { key: 'new'; kind: 'new' };

export interface MemberDraft {
  patientId: string;
  fullName: string;
  displayNumber: string;
  minor: boolean;
  /** Already linked to the chosen payer: left out of the link. */
  alreadyLinked: boolean;
  include: boolean;
  relationship: ContactRelationship;
  isGuardian: boolean;
  isBillingContact: boolean;
}

export interface FamilyDraft {
  payerKey: string;
  /** Someone else's name (the phone is the family's). */
  newName: string;
  members: MemberDraft[];
}

/** Each contact, then each adult (or patient without a date of birth) oldest first, then someone new. */
export function payerOptions(family: FamilySuggestion, today: string): PayerOption[] {
  const adults = family.patients
    .filter((patient) => !minorOn(patient.dateOfBirth, today))
    .sort((a, b) => {
      if (a.dateOfBirth === b.dateOfBirth) return 0;
      if (a.dateOfBirth === null) return 1;
      if (b.dateOfBirth === null) return -1;
      return a.dateOfBirth < b.dateOfBirth ? -1 : 1;
    });
  return [
    ...family.contacts.map((contact) => ({
      key: `contact:${contact.id}`,
      kind: 'contact' as const,
      id: contact.id,
      fullName: contact.fullName,
    })),
    ...adults.map((patient) => ({
      key: `patient:${patient.id}`,
      kind: 'patient' as const,
      id: patient.id,
      fullName: patient.fullName,
      displayNumber: patient.displayNumber,
    })),
    { key: 'new', kind: 'new' },
  ];
}

/** The members for `payerKey`: every other patient, with the card's defaults. */
function membersFor(family: FamilySuggestion, payerKey: string, today: string): MemberDraft[] {
  const payerPatient = payerKey.startsWith('patient:') ? payerKey.slice('patient:'.length) : null;
  const payerContact = payerKey.startsWith('contact:')
    ? payerKey.slice('contact:'.length)
    : (family.patients.find((patient) => patient.id === payerPatient)?.selfContactId ?? null);
  return family.patients
    .filter((patient) => patient.id !== payerPatient)
    .map((patient) => {
      const minor = minorOn(patient.dateOfBirth, today);
      const alreadyLinked = payerContact !== null && patient.contactIds.includes(payerContact);
      return {
        patientId: patient.id,
        fullName: patient.fullName,
        displayNumber: patient.displayNumber,
        minor,
        alreadyLinked,
        include: !alreadyLinked,
        relationship: minor ? 'parent' : 'other',
        isGuardian: minor,
        isBillingContact: true,
      };
    });
}

/** The card's start: the first contact, else the oldest adult, else someone new. */
export function initialDraft(family: FamilySuggestion, today: string): FamilyDraft {
  const [first] = payerOptions(family, today);
  const payerKey = first?.key ?? 'new';
  return { payerKey, newName: '', members: membersFor(family, payerKey, today) };
}

/** Another payer: the members start again from the defaults. */
export function withPayer(
  family: FamilySuggestion,
  draft: FamilyDraft,
  payerKey: string,
  today: string,
): FamilyDraft {
  return { ...draft, payerKey, members: membersFor(family, payerKey, today) };
}

/** What Link family sends, or null while it has nothing to send (no member, a member without a
 * role, or someone new without a name). */
export function toLinkInput(family: FamilySuggestion, draft: FamilyDraft): FamilyLinkInput | null {
  const members = draft.members.filter((member) => member.include && !member.alreadyLinked);
  if (members.length === 0) return null;
  if (members.some((member) => !member.isGuardian && !member.isBillingContact)) return null;
  let payer: FamilyLinkInput['payer'];
  if (draft.payerKey === 'new') {
    const fullName = draft.newName.trim();
    if (fullName === '') return null;
    payer = { newContact: { fullName, phone: family.phone, email: null } };
  } else if (draft.payerKey.startsWith('contact:')) {
    payer = { contactId: draft.payerKey.slice('contact:'.length) };
  } else {
    payer = { patientId: draft.payerKey.slice('patient:'.length) };
  }
  return {
    payer,
    members: members.map((member) => ({
      patientId: member.patientId,
      relationship: member.relationship,
      isGuardian: member.isGuardian,
      isBillingContact: member.isBillingContact,
    })),
  };
}

/** Everyone the family holds: what "Not a family" is answered for. */
export function peopleOf(family: FamilySuggestion): string[] {
  return [...family.patients.map((patient) => patient.id), ...family.contacts.map((c) => c.id)];
}
