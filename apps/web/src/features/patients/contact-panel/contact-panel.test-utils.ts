import type { Patient } from '@dcm/contracts';
import { id, json, listItem, mockApi, patient } from '../patients.test-utils';

/**
 * Families C fixtures: Mona Haddad, a contact who is no patient, guardian and billing contact of
 * Lina, who owes $420. The contact panel's tests live in two files: Radix keeps its open layers in
 * module state, and a test that opened the panel leaves the next test's dialogs unable to close,
 * so each file opens the panel in one test only.
 */
export const MONA_ID = id(70);
export const MONA = {
  id: MONA_ID,
  fullName: 'Mona Haddad',
  phone: '+9613123456',
  email: 'mona@example.com',
  linkedPatient: null,
};
export const LINA = patient(71, 'Lina Haddad');

const DETAIL = {
  contact: MONA,
  patients: [
    {
      patient: {
        id: LINA.id,
        fullName: LINA.fullName,
        displayNumber: LINA.displayNumber,
        archived: false,
      },
      relationship: 'parent',
      isGuardian: true,
      isBillingContact: true,
      isEmergencyContact: false,
    },
  ],
};

const FAMILY = {
  payer: { contactId: MONA_ID, name: 'Mona Haddad', patientId: null },
  currency: 'USD',
  members: [
    {
      id: LINA.id,
      fullName: LINA.fullName,
      displayNumber: LINA.displayNumber,
      balance: '420.00',
      oldestUnpaid: '2026-05-01',
      openVisits: 1,
      isPayer: false,
    },
  ],
  total: '420.00',
  payFor: LINA.id,
};

export const RECENT = '/patients?sort=recent&size=10';
export const search = (q: string) => `/patients?q=${encodeURIComponent(q)}&size=10`;
const page = (patients: Patient[]) =>
  json({ items: patients.map(listItem), total: patients.length, page: 1, size: 10 });

/** The palette finds `patients` for "mona", and Mona as a contact; her panel's reads answer. */
export function mockMona(patients: Patient[] = []) {
  return mockApi({
    lookup: [{ kind: 'contact', contact: MONA }],
    get: (path) => {
      if (path === RECENT) return page([]);
      if (path === search('mona')) return page(patients);
      if (path === `/contacts/${MONA_ID}`) return json(DETAIL);
      if (path === `/billing/contacts/${MONA_ID}/family`) return json(FAMILY);
      return undefined;
    },
  });
}
