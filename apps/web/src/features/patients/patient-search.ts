import {
  type ContactView,
  type PatientListQuery,
  patientListQuerySchema,
  toAsciiDigits,
} from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { contactLookupQuery } from './contacts-api';
import type { PatientPrefill } from './list-query';
import { patientListQuery } from './patients-api';

const RECENT_SHOWN = 5;
const RESULTS_SHOWN = 8;
/** Contacts who are no patient, under the patients (families C). */
const CONTACTS_SHOWN = 3;
/** The smallest page size `GET /patients` accepts; the search shows a slice of it. */
const FETCH_SIZE = 10;

/** Design Q15: the most recently updated active patients (the default view excludes archived). */
const RECENT: PatientListQuery = patientListQuerySchema.parse({ sort: 'recent', size: FETCH_SIZE });
/** Arabic-Indic digits are sent as ASCII, so a phone typed on an Arabic keyboard still matches. */
const searchFor = (q: string): PatientListQuery =>
  patientListQuerySchema.parse({ q: toAsciiDigits(q), size: FETCH_SIZE });

/** A query that reads as a phone number pre-fills the create panel's phone, anything else its
 * name (design "digits → phone, otherwise name"). */
const PHONE_LIKE = /^[\d\s()+-]+$/;
export function prefillFor(query: string): PatientPrefill {
  const ascii = toAsciiDigits(query);
  return PHONE_LIKE.test(ascii) && /\d/.test(ascii) ? { phone: ascii } : { fullName: query };
}

/**
 * The search's Patients and Contacts groups (workspace spec §Global Patient Search): no query
 * lists the 5 most recently updated patients; a query searches `GET /patients` and shows the
 * first 8, then up to 3 contacts who are no patient (`GET /contacts/lookup`, families C).
 * `patients` off (no `patient:read`) asks nothing. A failed contact lookup only hides its group.
 */
export function usePatientSearch(
  query: string,
  { patients, contacts: withContacts }: { patients: boolean; contacts: boolean },
) {
  const searching = query !== '';
  const results = useQuery({
    ...patientListQuery(searching ? searchFor(query) : RECENT),
    enabled: patients,
  });
  const rows = patients
    ? (results.data?.items.slice(0, searching ? RESULTS_SHOWN : RECENT_SHOWN) ?? [])
    : [];
  const contactsAsked = patients && searching && withContacts;
  const lookup = useQuery({ ...contactLookupQuery(query), enabled: contactsAsked });
  const contacts: ContactView[] = contactsAsked
    ? (lookup.data ?? [])
        .flatMap((item) =>
          item.kind === 'contact' && item.contact.linkedPatient === null ? [item.contact] : [],
        )
        .slice(0, CONTACTS_SHOWN)
    : [];
  const contactsSettled = !contactsAsked || lookup.isSuccess || lookup.isError;
  return {
    results,
    rows,
    contacts,
    contactsSettled,
    /** Still waiting for the first answer of this search. */
    pending: patients && results.isPending,
    failed: patients && results.isError && results.data === undefined,
    settled: !patients || results.isSuccess,
  };
}
