import { type ContactLookupItem, normalizePhone } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import type { ContactSelection } from '../contact-picker';
import { contactLookupQuery } from '../contacts-api';
import { minorOn, pendingExclusions } from '../patient-form';
import type { PatientForm } from '../use-patient-form';

const DEBOUNCE_MS = 300;

/** What the typed phone leads the create panel to ask. */
export type PhoneOffer =
  /** An adult: "Is this patient {name}? Link to their contact record." (`linkContactId`). */
  | { kind: 'identity'; key: string; contactId: string; fullName: string }
  /** A minor: "This phone belongs to {name}. Add {name} as guardian?" (a guardian link). */
  | { kind: 'guardian'; key: string; selection: ContactSelection };

interface Candidate {
  key: string;
  /** A contact already (rather than a patient who would become one). */
  contact: boolean;
  /** A patient who is a minor on the tenant's today: never anyone's guardian. */
  minor: boolean;
  /** Unlinked: a contact who is nobody's patient record, so could be *this* patient. */
  unlinked: boolean;
  /** The patient this person is, if any (a pending patient target is the same person). */
  patientId: string | null;
  selection: ContactSelection;
}

function candidateOf(item: ContactLookupItem, today: string): Candidate {
  if (item.kind === 'contact') {
    const { contact } = item;
    return {
      key: `contact:${contact.id}`,
      contact: true,
      minor: false,
      unlinked: contact.linkedPatient === null,
      patientId: contact.linkedPatient?.id ?? null,
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
    };
  }
  const { patient } = item;
  return {
    key: `patient:${patient.id}`,
    contact: false,
    minor: minorOn(patient.dateOfBirth, today),
    unlinked: false,
    patientId: patient.id,
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
  };
}

function phoneOf(item: ContactLookupItem): string | null {
  return item.kind === 'contact' ? item.contact.phone : item.patient.phone;
}

/**
 * The create panel's "this phone is someone we know" offer (design addendum C4, Implementation
 * notes "Link offer"). The typed phone, once valid for the tenant's country, is looked up by its
 * E.164 digits (`GET /contacts/lookup`, debounced) and matched exactly:
 *
 * - an **adult** is asked whether they *are* an unlinked contact ("the mother becomes a patient"):
 *   Yes sets `linkContactId`, shown as a removable "Will link to {name}" chip. The link holds while
 *   the phone stays that number (however it is typed) and the patient an adult;
 * - a **minor** never becomes a contact — their phone is most often a parent's — so the match is
 *   offered as guardian instead: accepting stages it in the Guardian block (`guardianRequest`). A
 *   contact is offered before a patient, and a patient who is a minor (a sibling sharing the
 *   phone) never is.
 *
 * Someone already added to this patient is never offered, nor one the person answered No / Not now
 * to. Off (`enabled` false) in the edit panel: only a create can become a contact.
 */
export function useLinkOffer(form: PatientForm, enabled: boolean) {
  const { values, country } = form;
  const minor = form.showGuardianBlock;
  const e164 = enabled ? (normalizePhone(values.phone, country)?.e164 ?? null) : null;
  const digits = e164 === null ? '' : e164.replace(/\D/g, '');
  const settled = useDebouncedValue(digits, DEBOUNCE_MS);
  const lookup = useQuery({ ...contactLookupQuery(settled), enabled: settled !== '' });

  const [linked, setLinked] = useState<{ id: string; fullName: string; phone: string } | null>(
    null,
  );
  const [dismissed, setDismissed] = useState<readonly string[]>([]);
  const [guardianRequest, setGuardianRequest] = useState<ContactSelection | null>(null);

  // The link goes with the phone it was made for, and as soon as the patient is a minor.
  if (linked !== null && (minor || e164 !== linked.phone)) {
    setLinked(null);
    form.setLinkContactId(null);
  }

  const { contactIds, patientIds } = pendingExclusions(values);
  const added = ({ key, patientId }: Candidate) =>
    contactIds.some((id) => key === `contact:${id}`) ||
    (patientId !== null && patientIds.includes(patientId));
  const candidates =
    e164 !== null && settled === digits && lookup.data
      ? lookup.data
          .filter((item) => phoneOf(item) === e164)
          .map((item) => candidateOf(item, form.today))
          .filter((candidate) => !dismissed.includes(candidate.key) && !added(candidate))
      : [];

  let offer: PhoneOffer | null = null;
  if (minor) {
    const adults = candidates.filter((candidate) => !candidate.minor);
    const first = adults.find((candidate) => candidate.contact) ?? adults[0];
    if (first) offer = { kind: 'guardian', key: first.key, selection: first.selection };
  } else if (linked === null) {
    const first = candidates.find(({ unlinked }) => unlinked);
    if (first && 'contactId' in first.selection.target) {
      offer = {
        kind: 'identity',
        key: first.key,
        contactId: first.selection.target.contactId,
        fullName: first.selection.display.fullName,
      };
    }
  }

  const dismiss = (key: string) => {
    setDismissed((keys) => [...keys, key]);
  };

  return {
    offer,
    /** The contact this patient will be linked to (the chip), or null. */
    linked,
    /** Yes, same person / Add as guardian. */
    accept: (accepted: PhoneOffer) => {
      if (accepted.kind === 'guardian') {
        dismiss(accepted.key);
        setGuardianRequest({ ...accepted.selection });
        return;
      }
      if (e164 === null) return;
      form.setLinkContactId(accepted.contactId);
      setLinked({ id: accepted.contactId, fullName: accepted.fullName, phone: e164 });
    },
    /** No / Not now: not asked again about that person while the panel is open. */
    dismiss: (dismissedOffer: PhoneOffer) => {
      dismiss(dismissedOffer.key);
    },
    /** The chip's remove: no link after all. */
    unlink: () => {
      setLinked(null);
      form.setLinkContactId(null);
    },
    /** The contact to stage in the Guardian block, a new object each time it is asked for. */
    guardianRequest,
  };
}
