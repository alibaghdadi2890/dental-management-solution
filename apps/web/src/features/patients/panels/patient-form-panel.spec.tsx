import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/lib/i18n';
import { todayIn } from '@/lib/format';
import {
  DENTIST_ID,
  INACTIVE_DENTIST_ID,
  listItem,
  mockApi,
  patient,
  problem,
  renderPanels,
  sent,
} from './panel-harness';

const RANA = patient(1, 'Rana Haddad', {
  address: '1 Main St',
  primaryDentistUserId: INACTIVE_DENTIST_ID,
});
const TODAY = todayIn('Asia/Beirut');

const panel = (name: string) => screen.findByRole('complementary', { name });
/** Labels carry their hint ("Date of birth DD/MM/YYYY"), so a name matches its start. */
const field = (name: string) =>
  screen.getByRole<HTMLInputElement>('textbox', { name: new RegExp(`^${name}`) });
const type = (name: string, value: string) => {
  fireEvent.change(field(name), { target: { value } });
};
/** A DOB `years` years before today (minus a day), typed in the tenant's DD/MM/YYYY order. */
const dobYearsAgo = (years: number) => {
  const [y = '', m = '', d = ''] = TODAY.split('-');
  return `${d}/${m}/${String(Number(y) - years)}`;
};

describe('PatientFormPanel — create', () => {
  afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    await i18n.changeLanguage('en');
  });

  it('keeps Create disabled until name and phone are present', async () => {
    mockApi();
    renderPanels({ url: '/?panel=new' });
    await panel('Register a patient');
    const create = screen.getByRole('button', { name: 'Create patient' });
    expect(create).toHaveProperty('disabled', true);
    expect(screen.getByText('Name and phone required')).toBeTruthy();
    type('Full name', 'Rana Haddad');
    type('Phone', '03 123 456');
    expect(create).toHaveProperty('disabled', false);
  });

  it('creates with name and phone only through POST /patients, and toasts Open record', async () => {
    const fetchMock = mockApi();
    const router = renderPanels({ url: '/?panel=new' });
    await panel('Register a patient');
    type('Full name', 'Rana Haddad');
    type('Phone', '03 123 456');
    fireEvent.click(screen.getByRole('button', { name: 'Create patient' }));

    const toast = await screen.findByText('Patient created');
    expect(sent(fetchMock, 'POST', '/patients')).toEqual({
      fullName: 'Rana Haddad',
      phone: '03 123 456',
      dateOfBirth: null,
      sex: 'unknown',
      email: null,
      address: null,
      insurance: null,
      emergencyContact: null,
      medicalAlerts: [],
      primaryDentistUserId: null,
      notes: null,
      guardianName: null,
      guardianPhone: null,
    });
    expect(sent(fetchMock, 'POST', '/billing/opening-balances')).toBeUndefined();
    await waitFor(() => {
      expect(screen.queryByRole('complementary', { name: 'Register a patient' })).toBeNull();
    });

    const status = toast.closest<HTMLElement>('[role="status"]') ?? document.body;
    fireEvent.click(within(status).getByRole('button', { name: 'Open record' }));
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ panel: `quick:${patient(50, '').id}` });
    });
  });

  it('records an opening balance through POST /billing/opening-balances', async () => {
    const fetchMock = mockApi();
    renderPanels({ url: '/?panel=new' });
    await panel('Register a patient');
    type('Full name', 'Rana Haddad');
    type('Phone', '03 123 456');
    expect(field('As of').value).toBe(TODAY.split('-').reverse().join('/'));
    type('Opening balance', '250');
    fireEvent.click(screen.getByRole('button', { name: 'Create patient' }));

    await screen.findByText('Patient created');
    expect(sent(fetchMock, 'POST', '/patients')).toBeUndefined();
    expect(sent(fetchMock, 'POST', '/billing/opening-balances')).toMatchObject({
      patient: { fullName: 'Rana Haddad', phone: '03 123 456' },
      openingBalance: { amount: '250', asOf: TODAY, note: null },
    });
  });

  it('reads a French 12,50 as 12.50 and keeps what was typed', async () => {
    await i18n.changeLanguage('fr');
    const fetchMock = mockApi();
    renderPanels({ url: '/?panel=new' });
    await panel('Enregistrer un patient');
    type('Nom complet', 'Rana Haddad');
    type('Téléphone', '03 123 456');
    type('Solde d’ouverture', '12,50');
    expect(field('Solde d’ouverture').value).toBe('12,50');
    fireEvent.click(screen.getByRole('button', { name: 'Créer le patient' }));

    await screen.findByText('Patient créé');
    expect(sent(fetchMock, 'POST', '/billing/opening-balances')).toMatchObject({
      openingBalance: { amount: '12.50' },
    });
  });

  it('hides the Account group without payment:write', async () => {
    mockApi();
    renderPanels({ url: '/?panel=new', permissions: ['patient:read', 'patient:write'] });
    await panel('Register a patient');
    expect(screen.queryByText('Account')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Opening balance' })).toBeNull();
  });

  it('shows the guardian pair only for a minor, and never sends a hidden one', async () => {
    const fetchMock = mockApi();
    renderPanels({ url: '/?panel=new' });
    await panel('Register a patient');
    type('Full name', 'Lina Aoun');
    type('Phone', '03 123 456');
    expect(screen.queryByRole('textbox', { name: 'Guardian name' })).toBeNull();

    type('Date of birth', dobYearsAgo(7));
    expect(screen.getByText('7 yrs · mixed dentition')).toBeTruthy();
    type('Guardian name', 'Maya Aoun');
    type('Guardian phone', '03 654 321');

    type('Date of birth', dobYearsAgo(30));
    expect(screen.queryByRole('textbox', { name: 'Guardian name' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create patient' }));
    await screen.findByText('Patient created');
    expect(sent(fetchMock, 'POST', '/patients')).toMatchObject({
      guardianName: null,
      guardianPhone: null,
    });
  });

  it('warns about a possible duplicate without blocking Save', async () => {
    const twin = patient(7, 'Rana Haddad');
    const fetchMock = mockApi({ patients: [twin], twins: [listItem(twin)] });
    renderPanels({ url: '/?panel=new' });
    await panel('Register a patient');
    type('Full name', 'Rana Haddad');
    type('Phone', '03 123 456');
    type('Date of birth', '01/05/1990');

    const warning = await screen.findByText(/Possible duplicate:/);
    expect(warning.closest('[role="status"]')?.textContent).toContain('P-000007');
    expect(fetchMock.mock.calls.map(([url]) => url)).toContain(
      '/api/v1/patients/duplicates/check?fullName=Rana+Haddad&dateOfBirth=1990-05-01',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create patient' }));
    await screen.findByText('Patient created');
  });

  it('asks before discarding a dirty form, and Keep editing keeps it', async () => {
    mockApi();
    const router = renderPanels({ url: '/?panel=new' });
    const aside = await panel('Register a patient');
    type('Full name', 'Rana');
    expect(within(aside).getByText('Unsaved')).toBeTruthy();

    fireEvent.click(within(aside).getByRole('button', { name: 'Close' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Discard unsaved changes?')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });
    expect(field('Full name').value).toBe('Rana');

    fireEvent.click(within(aside).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Discard and leave',
      }),
    );
    await waitFor(() => {
      expect(router.state.location.search).not.toHaveProperty('panel');
    });
  });

  it('pre-fills the name from the URL without counting it as a change', async () => {
    mockApi();
    renderPanels({ url: '/?panel=new&fullName=Rana' });
    const aside = await panel('Register a patient');
    expect(field('Full name').value).toBe('Rana');
    expect(within(aside).queryByText('Unsaved')).toBeNull();
  });
});

describe('PatientFormPanel — edit', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('PATCHes only the changed fields and has no Account group', async () => {
    const fetchMock = mockApi({ patients: [RANA] });
    renderPanels({ url: `/?panel=edit:${RANA.id}` });
    const aside = await panel('Rana Haddad');
    expect(screen.queryByText('Account')).toBeNull();
    const save = within(aside).getByRole('button', { name: 'Save changes' });
    expect(save).toHaveProperty('disabled', true);

    type('Address', '2 Second St');
    expect(within(aside).getByText('Unsaved')).toBeTruthy();
    fireEvent.click(save);
    await screen.findByText('Patient updated');
    expect(sent(fetchMock, 'PATCH', `/patients/${RANA.id}`)).toEqual({ address: '2 Second St' });
  });

  it('does not count a phone re-typed in another format as a change', async () => {
    mockApi({ patients: [RANA] });
    renderPanels({ url: `/?panel=edit:${RANA.id}` });
    const aside = await panel('Rana Haddad');
    expect(field('Phone').value).toBe('03 123 456');
    type('Phone', '03123456');
    expect(within(aside).queryByText('Unsaved')).toBeNull();
    expect(within(aside).getByRole('button', { name: 'Save changes' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('shows a server phone error on the phone field', async () => {
    mockApi({
      patients: [RANA],
      mutation: (method) =>
        method === 'PATCH'
          ? problem(422, 'validation_failed', [
              { path: 'phone', code: 'custom', message: 'Invalid phone number' },
            ])
          : undefined,
    });
    renderPanels({ url: `/?panel=edit:${RANA.id}` });
    const aside = await panel('Rana Haddad');
    type('Phone', '03 999 999');
    fireEvent.click(within(aside).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Enter a valid phone number')).toBeTruthy();
    expect(field('Phone').getAttribute('aria-invalid')).toBe('true');
  });

  it('keeps an inactive dentist selectable, named from the staff list', async () => {
    mockApi({ patients: [RANA] });
    renderPanels({ url: `/?panel=edit:${RANA.id}` });
    await panel('Rana Haddad');
    const dentist = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Primary dentist' });
    await waitFor(() => {
      expect(dentist.selectedOptions[0]?.textContent).toBe('Dr. Marcus Lee');
    });
    expect(within(dentist).getByRole('option', { name: 'Dr. Ana Reyes' })).toBeTruthy();
    expect(DENTIST_ID).not.toBe(INACTIVE_DENTIST_ID);
  });

  it('shows not found for an unknown patient', async () => {
    mockApi();
    renderPanels({ url: `/?panel=edit:${patient(99, '').id}` });
    expect(await panel('Patient not found')).toBeTruthy();
  });
});
