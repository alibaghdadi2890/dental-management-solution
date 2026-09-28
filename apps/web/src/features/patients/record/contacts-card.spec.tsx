import type { ContactLookupItem, Patient, PatientContact } from '@dcm/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { todayIn } from '@/lib/format';
import {
  id,
  json,
  mockApi,
  patient,
  patientContact,
  problem,
  renderRecord,
  sent,
} from '../patients.test-utils';

/** The Patient information tab's Contacts & family card and its Add contact panel (design
 * addendum "Record"). */

const RANA = patient(1, 'Rana Haddad', { email: 'rana@example.com' });
const infoOf = (p: Patient) => `/patients/${p.id}?tab=information`;

// Born on 1 January 10 years before the tenant's today: 9–10 years old, whatever day it runs.
const year = Number(todayIn('Asia/Beirut').slice(0, 4));
const KARIM = patient(2, 'Karim Haddad', {
  dateOfBirth: `${String(year - 10)}-01-01`,
  phone: null,
  email: 'k@example.com',
  address: '12 Hamra St',
});

const MARIA_ID = id(60);
const MARIA_LINK = patientContact(60, 'Maria Haddad', {
  isBillingContact: true,
  isPrimaryBilling: true,
});
const OMAR_LINK = patientContact(61, 'Omar Haddad', {
  relationship: 'sibling',
  isGuardian: false,
  isPrimaryGuardian: false,
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
const SAMI: ContactLookupItem = {
  kind: 'patient',
  patient: {
    id: id(44),
    displayNumber: 'P-000044',
    fullName: 'Sami Haddad',
    phone: '+9613222333',
    dateOfBirth: '1980-01-01',
  },
};
const SAMI_LINK = patientContact(62, 'Sami Haddad', {
  relationship: 'other',
  isGuardian: false,
  isPrimaryGuardian: false,
  isEmergencyContact: true,
});
const MARIA: ContactLookupItem = { kind: 'contact', contact: MARIA_LINK.contact };

const contactsCard = () => screen.findByRole('region', { name: 'Contacts & family' });
const rows = (card: HTMLElement) =>
  Array.from(
    within(card)
      .getByRole('list', { name: 'Contacts' })
      .querySelectorAll<HTMLElement>(':scope > li'),
  );
const menuButton = (name: string) =>
  screen.getByRole('button', { name: `Contact actions for ${name}` });
const openMenu = async (name: string) => {
  const trigger = await screen.findByRole('button', { name: `Contact actions for ${name}` });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return screen.findByRole('menu');
};
const addPanel = () => screen.findByRole('complementary', { name: 'Add contact' });
/** Searches the panel's picker for `text` and picks the option named like `option`. */
const pick = async (panel: HTMLElement, text: string, option: RegExp) => {
  fireEvent.change(within(panel).getByRole('combobox', { name: 'Contact' }), {
    target: { value: text },
  });
  fireEvent.click(await within(panel).findByRole('option', { name: option }));
};
const answering = (path: string, method: string, contacts: PatientContact[]) =>
  function answer(m: string, p: string) {
    return m === method && p === path ? json(contacts, method === 'POST' ? 201 : 200) : undefined;
  };

describe('Contacts & family card', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lists each contact: name · relationship · role pills (primary marked) · phone', async () => {
    mockApi({ patients: [RANA], contacts: { [RANA.id]: [MARIA_LINK, OMAR_LINK] } });
    renderRecord({ url: infoOf(RANA) });
    const card = await contactsCard();
    await waitFor(() => {
      expect(rows(card)).toHaveLength(2);
    });
    const [maria, omar] = rows(card);
    expect(maria?.textContent).toContain('Maria Haddad');
    expect(maria?.textContent).toContain('Parent');
    expect(
      within(maria as HTMLElement)
        .getAllByRole('listitem')
        .map((pill) => pill.textContent),
    ).toEqual(['Guardian · Primary', 'Billing · Primary']);
    expect(maria?.querySelector('[dir="ltr"]')?.textContent).toBe('03 987 654');
    expect(omar?.textContent).toContain('Sibling');
    expect(omar?.textContent).toContain('Patient P-000042');
    expect(menuButton('Maria Haddad')).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Add contact' })).toBeTruthy();
  });

  it('says when there are no contacts, and gives a minor without a guardian the amber note', async () => {
    mockApi({ patients: [RANA, KARIM], contacts: { [RANA.id]: [], [KARIM.id]: [] } });
    renderRecord({ url: infoOf(RANA) });
    const card = await contactsCard();
    expect(await within(card).findByText('No contacts recorded')).toBeTruthy();
    expect(within(card).queryByText('No guardian recorded')).toBeNull();
    cleanup();

    renderRecord({ url: infoOf(KARIM) });
    const minorCard = await contactsCard();
    expect(await within(minorCard).findByText('No guardian recorded')).toBeTruthy();
    expect(within(minorCard).queryByText('No contacts recorded')).toBeNull();
  });

  it('says so when the contacts fail to load, and retries', async () => {
    let fail = true;
    mockApi({
      patients: [RANA],
      get: (path) =>
        path === `/patients/${RANA.id}/contacts`
          ? fail
            ? problem(500, 'internal')
            : json([MARIA_LINK])
          : undefined,
    });
    renderRecord({ url: infoOf(RANA) });
    const card = await contactsCard();
    expect(await within(card).findByText('Couldn’t load the contacts.')).toBeTruthy();
    fail = false;
    fireEvent.click(within(card).getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(rows(card)).toHaveLength(1);
    });
  });

  it('edits roles through PATCH from the menu, then returns focus to the row’s menu', async () => {
    const changed = { ...MARIA_LINK, isEmergencyContact: true, isPrimaryEmergency: true };
    const fetchMock = mockApi({
      patients: [RANA],
      contacts: { [RANA.id]: [MARIA_LINK] },
      mutation: answering(`/patients/${RANA.id}/contacts/${MARIA_ID}`, 'PATCH', [changed]),
    });
    renderRecord({ url: infoOf(RANA) });
    const menu = await openMenu('Maria Haddad');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Edit roles' }));
    const editor = await screen.findByRole('group', { name: 'Roles of Maria Haddad' });
    fireEvent.click(within(editor).getByRole('checkbox', { name: 'Emergency contact' }));
    fireEvent.click(within(editor).getByRole('button', { name: 'Apply' }));

    expect(await screen.findByText('Contact updated')).toBeTruthy();
    expect(sent(fetchMock, 'PATCH', `/patients/${RANA.id}/contacts/${MARIA_ID}`)).toEqual({
      isEmergencyContact: true,
    });
    await waitFor(() => {
      expect(screen.queryByRole('group', { name: 'Roles of Maria Haddad' })).toBeNull();
    });
    const [maria] = rows(await contactsCard());
    expect(maria?.textContent).toContain('Emergency');
    await waitFor(() => {
      expect(document.activeElement).toBe(menuButton('Maria Haddad'));
    });
  });

  it('makes a contact the primary of a role at once from the role editor', async () => {
    const fetchMock = mockApi({
      patients: [RANA],
      contacts: { [RANA.id]: [MARIA_LINK, { ...OMAR_LINK, isBillingContact: true }] },
    });
    renderRecord({ url: infoOf(RANA) });
    const menu = await openMenu('Omar Haddad');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Edit roles' }));
    const editor = await screen.findByRole('group', { name: 'Roles of Omar Haddad' });
    fireEvent.click(
      within(editor).getByRole('button', { name: 'Make Omar Haddad the primary billing contact' }),
    );
    expect(await screen.findByText('Contact updated')).toBeTruthy();
    expect(sent(fetchMock, 'PATCH', `/patients/${RANA.id}/contacts/${id(61)}`)).toEqual({
      isPrimaryBilling: true,
    });
  });

  it('removes a contact after confirming, through DELETE, and focuses the next row', async () => {
    const fetchMock = mockApi({
      patients: [RANA],
      contacts: { [RANA.id]: [MARIA_LINK, OMAR_LINK] },
    });
    renderRecord({ url: infoOf(RANA) });
    const menu = await openMenu('Maria Haddad');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Remove' }));
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
    const card = await contactsCard();
    await waitFor(() => {
      expect(rows(card)).toHaveLength(1);
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(menuButton('Omar Haddad'));
    });
  });

  it('focuses Add contact once the last contact is removed', async () => {
    mockApi({ patients: [RANA], contacts: { [RANA.id]: [MARIA_LINK] } });
    renderRecord({ url: infoOf(RANA) });
    const menu = await openMenu('Maria Haddad');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Remove' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }),
    );
    const card = await contactsCard();
    expect(await within(card).findByText('No contacts recorded')).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(card).getByRole('button', { name: 'Add contact' }),
      );
    });
  });

  it('shows why a removal failed, in the dialog, keeping the contact', async () => {
    mockApi({
      patients: [RANA],
      contacts: { [RANA.id]: [MARIA_LINK] },
      mutation: (method) => (method === 'DELETE' ? problem(409, 'patient.archived') : undefined),
    });
    renderRecord({ url: infoOf(RANA) });
    const menu = await openMenu('Maria Haddad');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(await within(dialog).findByText(/^Couldn’t update contacts:/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(rows(await contactsCard())).toHaveLength(1);
  });

  it('opens a linked contact’s record from the menu, and offers it for no one else', async () => {
    mockApi({ patients: [RANA], contacts: { [RANA.id]: [MARIA_LINK, OMAR_LINK] } });
    const { router } = renderRecord({ url: infoOf(RANA) });
    const mariaMenu = await openMenu('Maria Haddad');
    expect(within(mariaMenu).queryByRole('menuitem', { name: 'Open record' })).toBeNull();
    fireEvent.keyDown(mariaMenu, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
    });
    const omarMenu = await openMenu('Omar Haddad');
    fireEvent.click(within(omarMenu).getByRole('menuitem', { name: 'Open record' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/patients/${id(42)}`);
    });
  });

  it('forgets an open role editor once its contact is removed', async () => {
    mockApi({ patients: [RANA], contacts: { [RANA.id]: [MARIA_LINK, OMAR_LINK] } });
    const { client } = renderRecord({ url: infoOf(RANA) });
    fireEvent.click(
      within(await openMenu('Maria Haddad')).getByRole('menuitem', { name: 'Edit roles' }),
    );
    expect(await screen.findByRole('group', { name: 'Roles of Maria Haddad' })).toBeTruthy();
    fireEvent.click(
      within(await openMenu('Maria Haddad')).getByRole('menuitem', { name: 'Remove' }),
    );
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remove' }),
    );
    const card = await contactsCard();
    await waitFor(() => {
      expect(rows(card)).toHaveLength(1);
    });
    // Maria is linked again (another tab, another person): her row comes back without an editor.
    await client.invalidateQueries();
    await waitFor(() => {
      expect(rows(card)).toHaveLength(2);
    });
    expect(screen.queryByRole('group', { name: 'Roles of Maria Haddad' })).toBeNull();
  });

  it('counts a role editor with changes as unsaved when switching tabs', async () => {
    mockApi({ patients: [RANA], contacts: { [RANA.id]: [MARIA_LINK] } });
    const { router } = renderRecord({ url: infoOf(RANA) });
    fireEvent.click(
      within(await openMenu('Maria Haddad')).getByRole('menuitem', { name: 'Edit roles' }),
    );
    const editor = await screen.findByRole('group', { name: 'Roles of Maria Haddad' });
    fireEvent.click(within(editor).getByRole('checkbox', { name: 'Emergency contact' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(router.state.location.search).toMatchObject({ tab: 'information' });
  });

  it('is read-only without patient:write: no menus, no Add contact, no panel', async () => {
    mockApi({ patients: [RANA], contacts: { [RANA.id]: [MARIA_LINK, OMAR_LINK] } });
    renderRecord({
      url: `${infoOf(RANA)}&panel=add-contact`,
      permissions: ['patient:read'],
    });
    const card = await contactsCard();
    await waitFor(() => {
      expect(rows(card)).toHaveLength(2);
    });
    expect(within(card).queryByRole('button', { name: /Contact actions/ })).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Add contact' })).toBeNull();
    expect(screen.queryByRole('complementary')).toBeNull();
    // A linked contact's record is still a link away.
    expect(within(card).getByRole('link', { name: 'Patient P-000042' })).toBeTruthy();
  });

  it('is read-only for an archived record', async () => {
    const archived = { ...RANA, archivedAt: '2026-09-01T10:00:00.000Z' };
    mockApi({ patients: [archived], contacts: { [RANA.id]: [MARIA_LINK] } });
    renderRecord({ url: `${infoOf(RANA)}&panel=add-contact` });
    const card = await contactsCard();
    await waitFor(() => {
      expect(rows(card)).toHaveLength(1);
    });
    expect(within(card).queryByRole('button', { name: /Contact actions/ })).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Add contact' })).toBeNull();
    expect(screen.queryByRole('complementary')).toBeNull();
  });
});

describe('Add contact panel', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('opens only on the Patient information tab', async () => {
    mockApi({ patients: [RANA], contacts: { [RANA.id]: [] } });
    renderRecord({ url: `/patients/${RANA.id}?tab=overview&panel=add-contact` });
    await screen.findByRole('heading', { level: 1, name: 'Rana Haddad' });
    await screen.findAllByText('Not recorded');
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('closes when switching tabs', async () => {
    mockApi({ patients: [RANA], contacts: { [RANA.id]: [] } });
    const { router } = renderRecord({ url: `${infoOf(RANA)}&panel=add-contact` });
    await addPanel();
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    await waitFor(() => {
      expect(screen.queryByRole('complementary')).toBeNull();
    });
    expect(router.state.location.search).toMatchObject({ tab: 'overview' });
    expect(router.state.location.search).not.toHaveProperty('panel', 'add-contact');
  });

  it('asks once before switching tabs over a staged pick and an edited form', async () => {
    mockApi({ patients: [RANA], contacts: { [RANA.id]: [] }, lookup: [MARIA] });
    const { router } = renderRecord({ url: `${infoOf(RANA)}&panel=add-contact` });
    const panel = await addPanel();
    await pick(panel, 'Maria', /Maria Haddad/);
    fireEvent.change(screen.getByRole('textbox', { name: 'Insurance' }), {
      target: { value: 'Allianz' },
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' });
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard and leave' }));
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ tab: 'overview' });
    });
    // No second question follows the first.
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('waits while a contact action of the card runs: one action at a time', async () => {
    mockApi({
      patients: [RANA],
      contacts: { [RANA.id]: [MARIA_LINK] },
      mutation: (method) =>
        method === 'PATCH' ? new Promise<Response>(() => undefined) : undefined,
    });
    renderRecord({ url: `${infoOf(RANA)}&panel=add-contact` });
    const panel = await addPanel();
    const search = within(panel).getByRole('combobox', { name: 'Contact' });
    await waitFor(() => {
      expect(search).toHaveProperty('disabled', false);
    });
    fireEvent.click(
      within(await openMenu('Maria Haddad')).getByRole('menuitem', { name: 'Edit roles' }),
    );
    const editor = await screen.findByRole('group', { name: 'Roles of Maria Haddad' });
    fireEvent.click(within(editor).getByRole('checkbox', { name: 'Emergency contact' }));
    fireEvent.click(within(editor).getByRole('button', { name: 'Apply' }));
    await waitFor(() => {
      expect(search).toHaveProperty('disabled', true);
    });
  });

  it('opens from Add contact in place, links the pick through POST, closes and returns focus', async () => {
    const fetchMock = mockApi({
      patients: [RANA],
      contacts: { [RANA.id]: [MARIA_LINK] },
      lookup: [SAMI],
      mutation: answering(`/patients/${RANA.id}/contacts`, 'POST', [MARIA_LINK, SAMI_LINK]),
    });
    const { router } = renderRecord({ url: infoOf(RANA) });
    const card = await contactsCard();
    const add = within(card).getByRole('button', { name: 'Add contact' });
    const entries = router.history.length;
    add.focus();
    fireEvent.click(add);

    const panel = await addPanel();
    expect(router.state.location.search).toMatchObject({
      tab: 'information',
      panel: 'add-contact',
    });
    expect(router.history.length).toBe(entries);
    expect(within(panel).getByText('Rana Haddad')).toBeTruthy();
    expect(document.activeElement).toBe(
      within(panel).getByRole('heading', { name: 'Add contact' }),
    );

    await pick(panel, 'Sami', /Sami Haddad/);
    const confirm = within(panel).getByRole('button', { name: 'Add contact' });
    expect(confirm).toHaveProperty('disabled', true);
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'Emergency contact' }));
    fireEvent.click(confirm);

    expect(await screen.findByText('Contact added')).toBeTruthy();
    expect(sent(fetchMock, 'POST', `/patients/${RANA.id}/contacts`)).toEqual({
      target: { patientId: SAMI.patient.id },
      relationship: 'other',
      isGuardian: false,
      isBillingContact: false,
      isEmergencyContact: true,
    });
    await waitFor(() => {
      expect(screen.queryByRole('complementary')).toBeNull();
    });
    expect(router.state.location.search).not.toHaveProperty('panel', 'add-contact');
    expect(router.history.length).toBe(entries);
    // No unsaved-changes question on the way out: the pick was added.
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => {
      expect(rows(card)).toHaveLength(2);
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(add);
    });
  });

  it('keeps the panel open with the pick staged when the server refuses it', async () => {
    mockApi({
      patients: [RANA],
      contacts: { [RANA.id]: [] },
      lookup: [SAMI],
      mutation: (method) => (method === 'POST' ? problem(409, 'patient.archived') : undefined),
    });
    renderRecord({ url: `${infoOf(RANA)}&panel=add-contact` });
    const panel = await addPanel();
    await pick(panel, 'Sami', /Sami Haddad/);
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'Guardian' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Add contact' }));
    expect(await screen.findByText(/^Couldn’t update contacts:/)).toBeTruthy();
    expect(within(panel).getByRole('group', { name: 'Adding Sami Haddad' })).toBeTruthy();
  });

  it('asks before closing over a staged pick, and Cancel closes an untouched one', async () => {
    mockApi({ patients: [RANA], contacts: { [RANA.id]: [] }, lookup: [MARIA] });
    const { router } = renderRecord({ url: `${infoOf(RANA)}&panel=add-contact` });
    const panel = await addPanel();
    expect(within(panel).queryByText('Unsaved')).toBeNull();
    await pick(panel, 'Maria', /Maria Haddad/);
    expect(within(panel).getByText('Unsaved')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard unsaved changes?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(await addPanel()).toBeTruthy();

    fireEvent.click(
      within(within(panel).getByRole('group', { name: 'Adding Maria Haddad' })).getByRole(
        'button',
        { name: 'Cancel' },
      ),
    );
    fireEvent.click(within(panel).getAllByRole('button', { name: 'Cancel' }).at(-1) as HTMLElement);
    await waitFor(() => {
      expect(screen.queryByRole('complementary')).toBeNull();
    });
    expect(router.state.location.pathname).toBe(`/patients/${RANA.id}`);
  });

  it('flips a minor’s completeness once a guardian is added, the roles defaulting to all three', async () => {
    const fetchMock = mockApi({
      patients: [KARIM],
      contacts: { [KARIM.id]: [] },
      lookup: [MARIA],
      mutation: answering(`/patients/${KARIM.id}/contacts`, 'POST', [
        patientContact(60, 'Maria Haddad', {
          isBillingContact: true,
          isPrimaryBilling: true,
          isEmergencyContact: true,
          isPrimaryEmergency: true,
        }),
      ]),
    });
    renderRecord({ url: infoOf(KARIM) });
    expect(await screen.findByText('Partly complete')).toBeTruthy();
    const card = await contactsCard();
    expect(await within(card).findByText('No guardian recorded')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Add contact' }));
    const panel = await addPanel();
    await pick(panel, 'Maria', /Maria Haddad/);
    const staged = within(panel).getByRole('group', { name: 'Adding Maria Haddad' });
    expect(
      within(staged).getByRole<HTMLSelectElement>('combobox', { name: 'Relationship' }).value,
    ).toBe('parent');
    for (const role of ['Guardian', 'Billing contact', 'Emergency contact']) {
      expect(within(staged).getByRole<HTMLInputElement>('checkbox', { name: role }).checked).toBe(
        true,
      );
    }
    fireEvent.click(within(staged).getByRole('button', { name: 'Add contact' }));

    expect(await screen.findByText('Complete')).toBeTruthy();
    expect(screen.queryByText('Partly complete')).toBeNull();
    expect(sent(fetchMock, 'POST', `/patients/${KARIM.id}/contacts`)).toEqual({
      target: { contactId: MARIA_ID },
      relationship: 'parent',
      isGuardian: true,
      isBillingContact: true,
      isEmergencyContact: true,
    });
    expect(within(card).queryByText('No guardian recorded')).toBeNull();
  });

  it('starts a minor’s further guardian as guardian only', async () => {
    mockApi({
      patients: [KARIM],
      contacts: { [KARIM.id]: [patientContact(61, 'Sami Haddad')] },
      lookup: [MARIA],
    });
    renderRecord({ url: `${infoOf(KARIM)}&panel=add-contact` });
    const panel = await addPanel();
    await waitFor(() => {
      expect(within(panel).getByRole('combobox', { name: 'Contact' })).toHaveProperty(
        'disabled',
        false,
      );
    });
    await pick(panel, 'Maria', /Maria Haddad/);
    const checked = (name: string) =>
      within(panel).getByRole<HTMLInputElement>('checkbox', { name }).checked;
    expect([checked('Guardian'), checked('Billing contact'), checked('Emergency contact')]).toEqual(
      [true, false, false],
    );
  });
});
