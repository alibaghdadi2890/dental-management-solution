import {
  type ContactLookupItem,
  type ContactView,
  type PatientContact,
  samePhone,
  storedPhone,
} from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import type { LinkerRequest } from '../contact-linker';
import type { ContactSelection } from '../contact-picker';
import { linkExclusions, NO_ROLES } from '../contact-rows';
import { contactLookupQuery } from '../contacts-api';
import { minorOn, pendingExclusions } from '../patient-form';
import type { PatientForm } from '../use-patient-form';

const DEBOUNCE_MS = 300;

/** What the typed phone leads the panel to offer (families A, P4). */
export interface PhoneOffer {
  key: string;
  /** Whom "Add as contact" stages. */
  selection: ContactSelection;
  /** The minor whose record holds the phone, when the offer is their family contact. */
  via: { name: string; role: 'guardian' | 'billing' } | null;
  /** Create, an adult patient, and a contact who is no patient: "This is {name}" links to it. */
  identityContactId: string | null;
}

/** The edit panel's patient: its saved phone, and its links (never offered again; null while
 * they load, and nothing is offered until they have). */
export interface LinkOfferEdit {
  patientId: string;
  savedPhone: string | null;
  links: readonly PatientContact[] | null;
}

interface Candidate {
  offer: PhoneOffer;
  /** The patient this person is, if any. */
  patientId: string | null;
}

function contactCandidate(
  contact: ContactView,
  via: PhoneOffer['via'],
  identity: boolean,
): Candidate {
  return {
    patientId: contact.linkedPatient?.id ?? null,
    offer: {
      key: `contact:${contact.id}`,
      via,
      identityContactId: identity && contact.linkedPatient === null ? contact.id : null,
      selection: {
        target: { contactId: contact.id },
        display: {
          fullName: contact.fullName,
          phone: contact.phone,
          patientNumber: contact.linkedPatient?.displayNumber ?? null,
          archived: contact.linkedPatient?.archived ?? false,
        },
        relationship: null,
      },
    },
  };
}

/**
 * Whom a lookup hit offers: a contact, or an adult patient (or one without a date of birth),
 * themselves; a minor patient, who is nobody's guardian, their family contact if they have one.
 * Contacts come first, then patients, each in lookup order.
 */
function candidatesOf(
  items: readonly ContactLookupItem[],
  today: string,
  identity: boolean,
): Candidate[] {
  const contacts: Candidate[] = [];
  const patients: Candidate[] = [];
  for (const item of items) {
    if (item.kind === 'contact') {
      contacts.push(contactCandidate(item.contact, null, identity));
      continue;
    }
    const { patient } = item;
    if (minorOn(patient.dateOfBirth, today)) {
      const family = patient.familyContact;
      if (family) {
        const via = { name: patient.fullName, role: family.role };
        patients.push(contactCandidate(family.contact, via, false));
      }
      continue;
    }
    patients.push({
      patientId: patient.id,
      offer: {
        key: `patient:${patient.id}`,
        via: null,
        identityContactId: null,
        selection: {
          target: { patientId: patient.id },
          display: {
            fullName: patient.fullName,
            phone: patient.phone,
            patientNumber: patient.displayNumber,
            archived: false,
          },
          relationship: null,
        },
      },
    });
  }
  return [...contacts, ...patients];
}

/**
 * The create and edit panels' "this phone is someone we know" (families A; design addendum C4 as
 * amended). Once a phone is typed — in edit, one that differs from the saved phone — it is looked up
 * by its digits (`GET /contacts/lookup`, debounced) and the hits with the same number (`samePhone`)
 * are offered one at a time, whatever the patient's age:
 *
 * - **Add as contact** stages the person in the contacts section (`request`): the Guardian block for
 *   a minor, otherwise "Contacts & family" with Billing contact ticked;
 * - **This is {name}** (create only, an adult, and a contact who is no patient) sets
 *   `linkContactId`, shown as a removable "Will link to {name}" chip. The link holds while the
 *   phone stays that number and the patient an adult.
 *
 * Never offered: the patient itself, someone already linked or pending, and anyone answered Not
 * now to while the panel is open.
 *
 * `prefilled` is the contact a Register as patient opened the panel for (families C): the chip
 * starts with it and stays whatever the phone or age — only its × removes it.
 */
export function useLinkOffer(
  form: PatientForm,
  edit: LinkOfferEdit | null,
  prefilled: { id: string; fullName: string } | null = null,
) {
  const { values, country } = form;
  const minor = form.showGuardianBlock;
  const typed = storedPhone(values.phone, country)?.value ?? null;
  const unchanged =
    edit !== null && edit.savedPhone !== null && samePhone(values.phone, edit.savedPhone, country);
  const digits = typed === null || unchanged ? '' : typed.replace(/\D/g, '');
  const settled = useDebouncedValue(digits, DEBOUNCE_MS);
  const lookup = useQuery({ ...contactLookupQuery(settled), enabled: settled !== '' });

  const [linked, setLinked] = useState<{
    id: string;
    fullName: string;
    phone: string;
    pinned: boolean;
  } | null>(prefilled && { ...prefilled, phone: '', pinned: true });
  const [dismissed, setDismissed] = useState<readonly string[]>([]);
  const [request, setRequest] = useState<LinkerRequest | null>(null);

  // The link goes with the phone it was made for, and as soon as the patient is a minor.
  if (linked !== null && !linked.pinned && (minor || typed !== linked.phone)) {
    setLinked(null);
    form.setLinkContactId(null);
  }

  const { contactIds, patientIds } = edit
    ? linkExclusions(edit.patientId, edit.links ?? [])
    : pendingExclusions(values);
  const excluded = ({ offer, patientId }: Candidate) =>
    dismissed.includes(offer.key) ||
    contactIds.some((id) => offer.key === `contact:${id}`) ||
    (patientId !== null && patientIds.includes(patientId));

  const offer =
    digits !== '' && settled === digits && lookup.data && linked === null && edit?.links !== null
      ? (candidatesOf(
          lookup.data.filter((item) => {
            const phone = item.kind === 'contact' ? item.contact.phone : item.patient.phone;
            return phone !== null && samePhone(phone, values.phone, country);
          }),
          form.today,
          edit === null && !minor,
        ).find((candidate) => !excluded(candidate))?.offer ?? null)
      : null;

  const dismiss = (key: string) => {
    setDismissed((keys) => [...keys, key]);
  };

  return {
    offer,
    /** The contact this patient will be linked to (the chip), or null. */
    linked,
    /** Add as contact: staged in the contacts section, a new object each time. */
    addAsContact: (accepted: PhoneOffer) => {
      dismiss(accepted.key);
      setRequest({
        selection: { ...accepted.selection },
        roles: minor ? NO_ROLES : { ...NO_ROLES, billing: true },
      });
    },
    /** This is {name}: the patient becomes that contact (`linkContactId`). */
    linkAsSelf: (accepted: PhoneOffer) => {
      if (typed === null || accepted.identityContactId === null) return;
      form.setLinkContactId(accepted.identityContactId);
      setLinked({
        id: accepted.identityContactId,
        fullName: accepted.selection.display.fullName,
        phone: typed,
        pinned: false,
      });
    },
    /** Not now: not offered again while the panel is open. */
    dismiss: (dismissedOffer: PhoneOffer) => {
      dismiss(dismissedOffer.key);
    },
    /** The chip's remove: no link after all. */
    unlink: () => {
      setLinked(null);
      form.setLinkContactId(null);
    },
    /** The contact to stage in the contacts section. */
    request,
  };
}
