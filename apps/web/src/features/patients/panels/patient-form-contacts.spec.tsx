import type { ContactLookupItem } from '@dcm/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { todayIn } from '@/lib/format';
import {
  id,
  mockApi,
  patient,
  patientContact,
  problem,
  renderPanels,
  sent,
} from '../patients.test-utils';

/** The create and edit panels' contacts (design addendum "Create panel", "Edit panel", C4, C5). */

const TODAY = todayIn('Asia/Beirut');
const MARIA_ID = id(60);
const MARIA: ContactLookupItem = {
  kind: 'contact',
  contact: {
    id: MARIA_ID,
    fullName: 'Maria Haddad',
    phone: '+9613987654',
    email: null,
    linkedPatient: null,
  },
};
/** A contact who is a patient, with the same phone as Maria: never offered for linking. */
const OMAR: ContactLookupItem = {
  kind: 'contact',
  contact: {
    id: id(61),
    fullName: 'Omar Haddad',
    phone: '+9613987654',
    email: null,
    linkedPatient: { id: id(42), displayNumber: 'P-000042', archived: false },
  },
};
const SAMI: ContactLookupItem = {
  kind: 'patient',
  patient: {
    id: id(44),
    displayNumber: 'P-000044',
    fullName: 'Sami Haddad',
    phone: '+9613111222',
    dateOfBirth: '1980-01-01',
  },
};

const panel = (name: string) => screen.findByRole('complementary', { name });
const field = (name: string) =>
  screen.getByRole<HTMLInputElement>('textbox', { name: new RegExp(`^${name}`) });
const type = (name: string, value: string) => {
  fireEvent.change(field(name), { target: { value } });
};
const dobYearsAgo = (years: number) => {
  const [y = '', m = '', d = ''] = TODAY.split('-');
  const year = Number(y) - years;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const day = m === '02' && d === '29' && !leap ? '28' : d;
  return `${day}/${m}/${String(year)}`;
};
const checkbox = (name: string) => screen.getByRole<HTMLInputElement>('checkbox', { name });
/** The contact rows (each holds its own list of role pills). */
const contactRows = () =>
  Array.from(
    screen.getByRole('list', { name: 'Contacts' }).querySelectorAll<HTMLElement>(':scope > li'),
  );
/** Searches the picker named `label` for `text` and picks the option named like `option`. */
const pick = async (label: string, text: string, option: RegExp) => {
  fireEvent.change(screen.getByRole('combobox', { name: label }), { target: { value: text } });
  fireEvent.click(await screen.findByRole('option', { name: option }));
};
const createButton = () => screen.getByRole('button', { name: 'Create patient' });

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PatientFormPanel — Guardian block (minors)', () => {
  it('appears above the optional fields while the patient is a minor, not at 18', async () => {
    mockApi();
    renderPanels({ url: '/?panel=new' });
    await panel('Register a patient');
    expect(screen.queryByRole('heading', { name: 'Guardian' })).toBeNull();

    type('Date of birth', dobYearsAgo(17));
    const heading = screen.getByRole('heading', { name: 'Guardian' });
    const search = screen.getByRole<HTMLInputElement>('combobox', { name: 'Guardian' });
    expect(search.placeholder).toBe('Search a parent by name or phone…');
    // Above "More details" (the optional fields).
    const more = screen.getByText('More details');
    expect(heading.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(checkbox('Also billing contact').checked).toBe(true);
    expect(checkbox('Also emergency contact').checked).toBe(true);
    expect(screen.getByText('No guardian recorded')).toBeTruthy();

    type('Date of birth', dobYearsAgo(18));
    expect(screen.queryByRole('heading', { name: 'Guardian' })).toBeNull();
    expect(screen.queryByText('No guardian recorded')).toBeNull();
    expect(screen.getByRole('button', { name: 'Contacts & family (optional)' }).ariaExpanded).toBe(
      'false',
    );
  });

  it('saves a minor without a guardian: the amber note never blocks', async () => {
    const fetchMock = mockApi();
    renderPanels({ url: '/?panel=new' });
    await panel('Register a patient');
    type('Full name', 'Lina Aoun');
    type('Date of birth', dobYearsAgo(7));
    expect(screen.getByText('No guardian recorded')).toBeTruthy();
    expect(createButton()).toHaveProperty('disabled', false);
    fireEvent.click(createButton());
    await screen.findByText('Patient created');
    expect(sent(fetchMock, 'POST', '/patients')).toMatchObject({ contacts: [] });
  });

  it('links an existing contact as guardian with the relationship and both toggles', async () => {
    const fetchMock = mockApi({ lookup: [MARIA] });
    renderPanels({ url: '/?panel=new' });
    await panel('Register a patient');
    type('Full name', 'Lina Aoun');
    type('Date of birth', dobYearsAgo(7));
    await pick('Guardian', 'Maria', /Maria Haddad/);

    const staged = screen.getByRole('group', { name: 'Maria Haddad' });
    fireEvent.change(within(staged).getByRole('combobox', { name: 'Relationship' }), {
      target: { value: 'caregiver' },
    });
    fireEvent.click(within(staged).getByRole('button', { name: 'Add guardian' }));

    const [row] = contactRows();
    expect(row?.textContent).toContain('Maria Haddad');
    expect(row?.textContent).toContain('Caregiver');
    expect(row?.textContent).toContain('03 987 654');
    expect(
      within(row as HTMLElement)
        .getAllByRole('listitem')
        .map((pill) => pill.textContent),
    ).toEqual(['Guardian', 'Billing', 'Emergency']);
    expect(screen.queryByText('No guardian recorded')).toBeNull();
    // A second guardian starts with the toggles off.
    expect(checkbox('Also billing contact').checked).toBe(false);
    expect(checkbox('Also emergency contact').checked).toBe(false);

    fireEvent.click(createButton());
    await screen.findByText('Patient created');
    expect(sent(fetchMock, 'POST', '/patients')).toMatchObject({
      contacts: [
        {
          target: { contactId: MARIA_ID },
          relationship: 'caregiver',
          isGuardian: true,
          isBillingContact: true,
          isEmergencyContact: true,
        },
      ],
    });
  });

  it('adds a new guardian from "Add new contact", honouring a toggle turned off', async () => {
    const fetchMock = mockApi();
    renderPanels({ url: '/?panel=new' });
    await panel('Register a patient');
    type('Full name', 'Lina Aoun');
    type('Date of birth', dobYearsAgo(7));
    fireEvent.click(checkbox('Also emergency contact'));
    fireEvent.click(screen.getByRole('button', { name: 'Add new contact' }));
    const form = screen.getByRole('group', { name: 'New contact' });
    fireEvent.change(within(form).getByRole('textbox', { name: 'Name' }), {
      target: { value: 'Maria Haddad' },
    });
    fireEvent.change(within(form).getByRole('textbox', { name: 'Phone' }), {
      target: { value: '03 987 654' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Add contact' }));
    expect(contactRows()).toHaveLength(1);

    fireEvent.click(createButton());
    await screen.findByText('Patient created');
    expect(sent(fetchMock, 'POST', '/patients')).toMatchObject({
      contacts: [
        {
          target: { newContact: { fullName: 'Maria Haddad', phone: '+9613987654', email: null } },
          relationship: 'parent',
          isGuardian: true,
          isBillingContact: true,
          isEmergencyContact: false,
        },
      ],
    });
  });

  it('removes a pending guardian, and the toggles go back on', async () => {
    mockApi({ lookup: [MARIA] });
    renderPanels({ url: '/?panel=new' });
    await panel('Register a patient');
    type('Date of birth', dobYearsAgo(7));
    await pick('Guardian', 'Maria', /Maria Haddad/);
    fireEvent.click(screen.getByRole('button', { name: 'Add guardian' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Maria Haddad' }));
    expect(screen.queryByRole('list', { name: 'Contacts' })).toBeNull();
    expect(screen.getByText('No guardian recorded')).toBeTruthy();
    expect(checkbox('Also billing contact').checked).toBe(true);
  });

  it('shows a server error on the pending row it is about', async () => {
    mockApi({
      lookup: [MARIA],
      mutation: (method, path) =>
        method === 'POST' && path === '/patients'
          ? problem(422, 'validation_failed', [
              { path: 'contacts.0.target.contactId', code: 'not_found', message: 'Not found' },
            ])
          : undefined,
    });
    renderPanels({ url: '/?panel=new' });
    await panel('Register a patient');
    type('Full name', 'Lina Aoun');
    type('Date of birth', dobYearsAgo(7));
    await pick('Guardian', 'Maria', /Maria Haddad/);
    fireEvent.click(screen.getByRole('button', { name: 'Add guardian' }));
    fireEvent.click(createButton());
    const [row] = contactRows();
    expect(
      await within(row as HTMLElement).findByText('This contact no longer exists'),
    ).toBeTruthy();
  });
});

describe('PatientFormPanel — Contacts & family (adults)', () => {
  it('is collapsed by default; a contact needs a role before it is added', async () => {
    const fetchMock = mockApi({ lookup: [MARIA] });
    renderPanels({ url: '/?panel=new' });
    await panel('Register a patient');
    type('Full name', 'Rana Haddad');
    type('Phone', '03 123 456');
    const disclosure = screen.getByRole('button', { name: 'Contacts & family (optional)' });
    expect(disclosure.ariaExpanded).toBe('false');
    expect(screen.queryByRole('combobox', { name: 'Contact' })).toBeNull();

    fireEvent.click(disclosure);
    expect(disclosure.ariaExpanded).toBe('true');
    const region = document.getElementById(disclosure.getAttribute('aria-controls') ?? '');
    expect(region?.hidden).toBe(false);
    const search = screen.getByRole<HTMLInputElement>('combobox', { name: 'Contact' });
    expect(search.placeholder).toBe('Search a contact…');
    await pick('Contact', 'Maria', /Maria Haddad/);

    const staged = screen.getByRole('group', { name: 'Maria Haddad' });
    const add = within(staged).getByRole('button', { name: 'Add contact' });
    const roles = within(staged).getByRole('group', { name: 'Roles' });
    expect(
      within(roles)
        .getAllByRole<HTMLInputElement>('checkbox')
        .map((box) => [box.labels?.[0]?.textContent, box.checked]),
    ).toEqual([
      ['Guardian', false],
      ['Billing contact', false],
      ['Emergency contact', false],
    ]);
    expect(add).toHaveProperty('disabled', true);
    fireEvent.click(within(roles).getByRole('checkbox', { name: 'Billing contact' }));
    fireEvent.change(within(staged).getByRole('combobox', { name: 'Relationship' }), {
      target: { value: 'spouse' },
    });
    fireEvent.click(add);
    expect(contactRows()).toHaveLength(1);

    fireEvent.click(createButton());
    await screen.findByText('Patient created');
    expect(sent(fetchMock, 'POST', '/patients')).toMatchObject({
      contacts: [
        {
          target: { contactId: MARIA_ID },
          relationship: 'spouse',
          isGuardian: false,
          isBillingContact: true,
          isEmergencyContact: false,
        },
      ],
    });
  });

  it('links a patient picked from the lookup by patient id', async () => {
    const fetchMock = mockApi({ lookup: [SAMI] });
    renderPanels({ url: '/?panel=new' });
    await panel('Register a patient');
    type('Full name', 'Rana Haddad');
    type('Phone', '03 123 456');
    fireEvent.click(screen.getByRole('button', { name: 'Contacts & family (optional)' }));
    await pick('Contact', 'Sami', /Sami Haddad/);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Emergency contact' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));
    expect(contactRows()[0]?.textContent).toContain('Patient P-000044');

    fireEvent.click(createButton());
    await screen.findByText('Patient created');
    expect(sent(fetchMock, 'POST', '/patients')).toMatchObject({
      contacts: [
        {
          target: { patientId: SAMI.patient.id },
          relationship: 'other',
          isGuardian: false,
          isBillingContact: false,
          isEmergencyContact: true,
        },
      ],
    });
  });

  it('edits a pending contact’s roles before saving', async () => {
    const fetchMock = mockApi({ lookup: [MARIA] });
    renderPanels({ url: '/?panel=new' });
    await panel('Register a patient');
    type('Full name', 'Rana Haddad');
    type('Phone', '03 123 456');
    fireEvent.click(screen.getByRole('button', { name: 'Contacts & family (optional)' }));
    await pick('Contact', 'Maria', /Maria Haddad/);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Billing contact' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));

    fireEvent.click(screen.getByRole('button', { name: 'Edit Maria Haddad' }));
    const editor = screen.getByRole('group', { name: 'Roles of Maria Haddad' });
    fireEvent.click(within(editor).getByRole('checkbox', { name: 'Emergency contact' }));
    fireEvent.click(within(editor).getByRole('button', { name: 'Apply' }));
    expect(screen.queryByRole('group', { name: 'Roles of Maria Haddad' })).toBeNull();

    fireEvent.click(createButton());
    await screen.findByText('Patient created');
    expect(sent(fetchMock, 'POST', '/patients')).toMatchObject({
      contacts: [{ isBillingContact: true, isEmergencyContact: true }],
    });
  });
});

describe('PatientFormPanel — link offer (linkContactId)', () => {
  const offer = 'This phone belongs to contact Maria Haddad. Link this patient to Maria Haddad?';

  it('offers the unlinked contact whose phone was typed; Link sends linkContactId', async () => {
    const fetchMock = mockApi({ lookup: [OMAR, MARIA] });
    renderPanels({ url: '/?panel=new' });
    await panel('Register a patient');
    type('Full name', 'Maria Haddad');
    type('Phone', '03 987 654');
    expect(await screen.findByText(offer)).toBeTruthy();
    expect(
      fetchMock.mock.calls.map(([url]) => url).filter((url) => url.includes('/contacts/lookup')),
    ).toEqual(['/api/v1/contacts/lookup?q=9613987654']);
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    expect(screen.queryByText(offer)).toBeNull();
    expect(screen.getByText('Will link to Maria Haddad')).toBeTruthy();

    fireEvent.click(createButton());
    await screen.findByText('Patient created');
    expect(sent(fetchMock, 'POST', '/patients')).toMatchObject({ linkContactId: MARIA_ID });
  });

  it('forgets the link when the phone changes, and Not now dismisses the offer', async () => {
    const fetchMock = mockApi({ lookup: [MARIA] });
    renderPanels({ url: '/?panel=new' });
    await panel('Register a patient');
    type('Full name', 'Maria Haddad');
    type('Phone', '03 987 654');
    fireEvent.click(await screen.findByRole('button', { name: 'Link' }));
    // The same number typed another way is the same phone.
    type('Phone', '+961 3 987 654');
    expect(screen.getByText('Will link to Maria Haddad')).toBeTruthy();
    type('Phone', '03 987 655');
    expect(screen.queryByText('Will link to Maria Haddad')).toBeNull();

    type('Phone', '03 987 654');
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(screen.queryByText(offer)).toBeNull();
    fireEvent.click(createButton());
    await screen.findByText('Patient created');
    expect(sent(fetchMock, 'POST', '/patients')).not.toHaveProperty('linkContactId');
  });

  it('shows "already a patient" on the link chip for a 409 contact.already_linked', async () => {
    mockApi({
      lookup: [MARIA],
      mutation: (method, path) =>
        method === 'POST' && path === '/patients'
          ? problem(409, 'contact.already_linked')
          : undefined,
    });
    renderPanels({ url: '/?panel=new' });
    await panel('Register a patient');
    type('Full name', 'Maria Haddad');
    type('Phone', '03 987 654');
    fireEvent.click(await screen.findByRole('button', { name: 'Link' }));
    fireEvent.click(createButton());
    expect(
      await screen.findByText(
        'This contact is already a patient — search for their record instead',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Will link to Maria Haddad')).toBeTruthy();
  });
});

describe('PatientFormPanel — edit: contacts apply immediately', () => {
  const RANA = patient(1, 'Rana Haddad');
  const MARIA_LINK = patientContact(60, 'Maria Haddad', {
    relationship: 'spouse',
    isGuardian: false,
    isPrimaryGuardian: false,
    isBillingContact: true,
    isPrimaryBilling: true,
  });
  const OMAR_LINK = patientContact(61, 'Omar Haddad', {
    relationship: 'sibling',
    isGuardian: false,
    isPrimaryGuardian: false,
    isBillingContact: true,
    isEmergencyContact: true,
    isPrimaryEmergency: true,
    contact: {
      id: id(61),
      fullName: 'Omar Haddad',
      phone: '+9613111222',
      email: null,
      linkedPatient: { id: id(42), displayNumber: 'P-000042', archived: false },
    },
  });
  const SAMI_LINK = patientContact(62, 'Sami Haddad', {
    relationship: 'other',
    isGuardian: false,
    isPrimaryGuardian: false,
    isEmergencyContact: true,
  });

  it('lists the current contacts with their roles and primaries, expanded', async () => {
    mockApi({ patients: [RANA], contacts: { [RANA.id]: [MARIA_LINK, OMAR_LINK] } });
    renderPanels({ url: `/?panel=edit:${RANA.id}` });
    await panel('Rana Haddad');
    await waitFor(() => {
      expect(contactRows()).toHaveLength(2);
    });
    expect(screen.getByRole('button', { name: 'Contacts & family (optional)' }).ariaExpanded).toBe(
      'true',
    );
    const [maria, omar] = contactRows();
    expect(maria?.textContent).toContain('Spouse');
    expect(
      within(maria as HTMLElement)
        .getAllByRole('listitem')
        .map((pill) => pill.textContent),
    ).toEqual(['Billing · Primary']);
    expect(
      within(omar as HTMLElement)
        .getAllByRole('listitem')
        .map((pill) => pill.textContent),
    ).toEqual(['Billing', 'Emergency · Primary']);
    expect(omar?.textContent).toContain('Patient P-000042');
  });

  it('adds a contact through POST and shows the answered list', async () => {
    const fetchMock = mockApi({
      patients: [RANA],
      contacts: { [RANA.id]: [MARIA_LINK] },
      lookup: [SAMI],
      mutation: (method, path) =>
        method === 'POST' && path === `/patients/${RANA.id}/contacts`
          ? new Response(JSON.stringify([MARIA_LINK, SAMI_LINK]), {
              status: 201,
              headers: { 'content-type': 'application/json' },
            })
          : undefined,
    });
    renderPanels({ url: `/?panel=edit:${RANA.id}` });
    const aside = await panel('Rana Haddad');
    await waitFor(() => {
      expect(contactRows()).toHaveLength(1);
    });
    await pick('Contact', 'Sami', /Sami Haddad/);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Emergency contact' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));

    expect(await screen.findByText('Contact added')).toBeTruthy();
    expect(sent(fetchMock, 'POST', `/patients/${RANA.id}/contacts`)).toEqual({
      target: { patientId: SAMI.patient.id },
      relationship: 'other',
      isGuardian: false,
      isBillingContact: false,
      isEmergencyContact: true,
    });
    await waitFor(() => {
      expect(contactRows()).toHaveLength(2);
    });
    // Contact actions never make the form dirty.
    expect(within(aside).getByRole('button', { name: 'Save changes' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('makes a contact the primary of a role through PATCH', async () => {
    const fetchMock = mockApi({
      patients: [RANA],
      contacts: { [RANA.id]: [MARIA_LINK, OMAR_LINK] },
    });
    renderPanels({ url: `/?panel=edit:${RANA.id}` });
    await panel('Rana Haddad');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Omar Haddad' }));
    const editor = screen.getByRole('group', { name: 'Roles of Omar Haddad' });
    expect(
      within(editor).queryByRole('button', {
        name: 'Make Omar Haddad the primary emergency contact',
      }),
    ).toBeNull();
    fireEvent.click(
      within(editor).getByRole('button', {
        name: 'Make Omar Haddad the primary billing contact',
      }),
    );
    expect(await screen.findByText('Contact updated')).toBeTruthy();
    expect(sent(fetchMock, 'PATCH', `/patients/${RANA.id}/contacts/${id(61)}`)).toEqual({
      isPrimaryBilling: true,
    });
  });

  it('changes roles and relationship through PATCH, sending only what changed', async () => {
    const fetchMock = mockApi({ patients: [RANA], contacts: { [RANA.id]: [MARIA_LINK] } });
    renderPanels({ url: `/?panel=edit:${RANA.id}` });
    await panel('Rana Haddad');
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Maria Haddad' }));
    const editor = screen.getByRole('group', { name: 'Roles of Maria Haddad' });
    const apply = within(editor).getByRole('button', { name: 'Apply' });
    expect(apply).toHaveProperty('disabled', true);
    fireEvent.click(within(editor).getByRole('checkbox', { name: 'Guardian' }));
    fireEvent.change(within(editor).getByRole('combobox', { name: 'Relationship' }), {
      target: { value: 'caregiver' },
    });
    fireEvent.click(apply);
    expect(await screen.findByText('Contact updated')).toBeTruthy();
    expect(sent(fetchMock, 'PATCH', `/patients/${RANA.id}/contacts/${MARIA_ID}`)).toEqual({
      relationship: 'caregiver',
      isGuardian: true,
    });
  });

  it('removes a contact after confirming, through DELETE', async () => {
    const fetchMock = mockApi({
      patients: [RANA],
      contacts: { [RANA.id]: [MARIA_LINK, OMAR_LINK] },
    });
    renderPanels({ url: `/?panel=edit:${RANA.id}` });
    await panel('Rana Haddad');
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Maria Haddad' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Remove Maria Haddad?')).toBeTruthy();
    expect(sent(fetchMock, 'DELETE', `/patients/${RANA.id}/contacts/${MARIA_ID}`)).toBeUndefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));

    expect(await screen.findByText('Contact removed')).toBeTruthy();
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          url === `/api/v1/patients/${RANA.id}/contacts/${MARIA_ID}` && init?.method === 'DELETE',
      ),
    ).toBe(true);
    await waitFor(() => {
      expect(contactRows()).toHaveLength(1);
    });
  });

  it('toasts a failed action in the person’s language', async () => {
    mockApi({
      patients: [RANA],
      contacts: { [RANA.id]: [MARIA_LINK] },
      lookup: [SAMI],
      mutation: (method, path) =>
        method === 'POST' && path === `/patients/${RANA.id}/contacts`
          ? problem(409, 'contact.already_linked')
          : undefined,
    });
    renderPanels({ url: `/?panel=edit:${RANA.id}` });
    await panel('Rana Haddad');
    await waitFor(() => {
      expect(contactRows()).toHaveLength(1);
    });
    await pick('Contact', 'Sami', /Sami Haddad/);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Billing contact' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add contact' }));
    expect(
      await screen.findByText(
        "Couldn't update contacts: this contact is already linked to the patient",
      ),
    ).toBeTruthy();
    // The choice is kept, to try again.
    expect(screen.getByRole('group', { name: 'Sami Haddad' })).toBeTruthy();
  });

  it('shows a minor’s guardian block with the current contacts and the amber note', async () => {
    const LINA = patient(3, 'Lina Aoun', { dateOfBirth: '2019-01-01', phone: null });
    mockApi({ patients: [LINA], contacts: { [LINA.id]: [SAMI_LINK] } });
    renderPanels({ url: `/?panel=edit:${LINA.id}` });
    await panel('Lina Aoun');
    expect(screen.getByRole('heading', { name: 'Guardian' })).toBeTruthy();
    await waitFor(() => {
      expect(contactRows()).toHaveLength(1);
    });
    expect(screen.getByText('No guardian recorded')).toBeTruthy();
  });

  it('disables the contact actions once the patient is archived', async () => {
    const patients = [RANA];
    mockApi({
      patients,
      contacts: { [RANA.id]: [MARIA_LINK] },
      mutation: (method, path) => {
        if (method !== 'PATCH' || path !== `/patients/${RANA.id}`) return undefined;
        patients[0] = { ...RANA, archivedAt: '2026-09-28T10:00:00.000Z' };
        return problem(409, 'patient.archived');
      },
    });
    renderPanels({ url: `/?panel=edit:${RANA.id}` });
    const aside = await panel('Rana Haddad');
    const remove = await screen.findByRole('button', { name: 'Remove Maria Haddad' });
    expect(remove).toHaveProperty('disabled', false);
    type('Address', '2 Second St');
    fireEvent.click(within(aside).getByRole('button', { name: 'Save changes' }));
    await within(aside).findByText(/This patient was archived while you were editing/);
    expect(remove).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Edit Maria Haddad' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByRole('combobox', { name: 'Contact' })).toHaveProperty('disabled', true);
  });
});
