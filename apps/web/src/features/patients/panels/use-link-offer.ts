import { normalizePhone } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { contactLookupQuery } from '../contacts-api';

type PhoneCountry = Parameters<typeof normalizePhone>[1];

const DEBOUNCE_MS = 300;

/**
 * The create panel's "this phone is a contact" check (design addendum C4, `linkContactId`): the
 * typed phone, once it is a valid number for the tenant's `country`, is looked up by its E.164
 * digits (`GET /contacts/lookup`, debounced) and matched exactly against the *unlinked* contacts
 * found — a contact already linked to a patient is that patient, never offered. Off (`enabled`
 * false) in the edit panel: only a create can become a contact.
 */
export function useLinkOffer(phone: string, country: string, enabled: boolean) {
  const e164 = enabled ? (normalizePhone(phone, country as PhoneCountry)?.e164 ?? null) : null;
  const digits = e164 === null ? '' : e164.replace(/\D/g, '');
  const settled = useDebouncedValue(digits, DEBOUNCE_MS);
  const lookup = useQuery({ ...contactLookupQuery(settled), enabled: settled !== '' });
  const match =
    e164 !== null && settled === digits
      ? (lookup.data
          ?.flatMap((item) => (item.kind === 'contact' ? [item.contact] : []))
          .find((contact) => contact.linkedPatient === null && contact.phone === e164) ?? null)
      : null;
  return { e164, match };
}
