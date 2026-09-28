import {
  type ContactLinkTarget,
  type ContactRelationship,
  nameSchema,
  normalizePhone,
  toAsciiDigits,
} from '@dcm/contracts';
import type { ContactDisplay } from './patient-form';

/** What the picker hands its parent: who to link, how they read, and — only for a contact made
 * in "Add new contact" — the relationship chosen there (for an existing contact or patient the
 * parent block asks for it). */
export interface ContactSelection {
  target: ContactLinkTarget;
  display: ContactDisplay;
  relationship: ContactRelationship | null;
}

export interface NewContactDraft {
  fullName: string;
  phone: string;
  relationship: ContactRelationship;
  /** A confirm was attempted: the errors show from then on. */
  checked: boolean;
}

/** A search that reads as a phone pre-fills the new contact's phone, anything else its name. */
const PHONE_LIKE = /^[\d\s()+-]+$/;

/** "Add new contact" opened from what was searched (`typed`, trimmed). */
export function newContactDraft(typed: string, relationship: ContactRelationship): NewContactDraft {
  const ascii = toAsciiDigits(typed);
  const phoneLike = PHONE_LIKE.test(ascii) && /\d/.test(ascii);
  return {
    fullName: phoneLike ? '' : typed,
    phone: phoneLike ? ascii : '',
    relationship,
    checked: false,
  };
}

type PhoneCountry = Parameters<typeof normalizePhone>[1];

export type NewContactError = 'required' | 'tooLong' | 'invalidPhone';

/** The name and phone errors of a draft, keyed by `contacts.picker.errors.*`. */
export function draftErrors(draft: NewContactDraft, country: string) {
  const errors: { fullName?: NewContactError; phone?: NewContactError } = {};
  if (draft.fullName.trim() === '') errors.fullName = 'required';
  else if (!nameSchema.safeParse(draft.fullName).success) errors.fullName = 'tooLong';
  if (draft.phone.trim() === '') errors.phone = 'required';
  else if (!normalizePhone(draft.phone, country as PhoneCountry)) errors.phone = 'invalidPhone';
  return errors;
}

/** A valid draft (`draftErrors` empty) as what the picker hands its parent: a new contact, its
 * phone normalised to E.164 with the tenant's `country`. */
export function selectionOf(draft: NewContactDraft, country: string): ContactSelection {
  const phone = normalizePhone(draft.phone, country as PhoneCountry)?.e164 ?? draft.phone.trim();
  const fullName = draft.fullName.trim();
  return {
    target: { newContact: { fullName, phone, email: null } },
    display: { fullName, phone, patientNumber: null, archived: false },
    relationship: draft.relationship,
  };
}
