import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/lib/i18n';
import { todayIn } from '@/lib/format';
import {
  DENTIST_ID,
  INACTIVE_DENTIST_ID,
  json,
  listItem,
  mockApi,
  patient,
  problem,
  renderPanels,
  sent,
} from '../patients.test-utils';

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
/** A DOB that makes the patient exactly `years` old today, typed in the tenant's DD/MM/YYYY
 * order; a Feb 29 today becomes Feb 28 in a year that has no Feb 29 (already had the birthday). */
const dobYearsAgo = (years: number) => {
  const [y = '', m = '', d = ''] = TODAY.split('-');
  const year = Number(y) - years;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const day = m === '02' && d === '29' && !leap ? '28' : d;
  return `${day}/${m}/${String(year)}`;
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

  it('focuses Full name on open, and the first invalid field on a failed submit', async () => {
    const fetchMock = mockApi();
    renderPanels({ url: '/?panel=new' });
    await panel('Register a patient');
    await waitFor(() => {
      expect(document.activeElement).toBe(field('Full name'));
    });
    type('Full name', 'Rana Haddad');
    type('Phone', '03 123 456');
    type('Email', 'rana@');
    type('Date of birth', '31/02/2019');
    fireEvent.click(screen.getByRole('button', { name: 'Create patient' }));
    expect(await screen.findByText('Enter a full date')).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(field('Date of birth'));
    });
    expect(sent(fetchMock, 'POST', '/patients')).toBeUndefined();
  });

  it('keeps a field’s error while it is edited to another invalid value', async () => {
    mockApi();
    renderPanels({ url: '/?panel=new' });
    await panel('Register a patient');
    type('Full name', 'Rana Haddad');
    type('Phone', '03 123 456');
    type('Email', 'rana@');
    fireEvent.click(screen.getByRole('button', { name: 'Create patient' }));
    expect(await screen.findByText('Check the email address')).toBeTruthy();
    type('Email', 'rana@x');
    expect(screen.getByText('Check the email address')).toBeTruthy();
    expect(field('Email').getAttribute('aria-invalid')).toBe('true');
  });

  it('flags an amount that is not a clean number, keeping what was typed', async () => {
    const fetchMock = mockApi();
    renderPanels({ url: '/?panel=new' });
    await panel('Register a patient');
    type('Full name', 'Rana Haddad');
    type('Phone', '03 123 456');
    for (const typed of ['12.505', '12abc']) {
      type('Opening balance', typed);
      fireEvent.click(screen.getByRole('button', { name: 'Create patient' }));
      expect(await screen.findByText('Enter an amount like 250 or 12.50')).toBeTruthy();
      expect(field('Opening balance').value).toBe(typed);
    }
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('shows an opening-balance path error on its field', async () => {
    mockApi({
      mutation: (_, path) =>
        path === '/billing/opening-balances'
          ? problem(422, 'validation_failed', [
              { path: 'openingBalance.asOf', code: 'custom', message: 'In the future' },
            ])
          : undefined,
    });
    renderPanels({ url: '/?panel=new' });
    await panel('Register a patient');
    type('Full name', 'Rana Haddad');
    type('Phone', '03 123 456');
    type('Opening balance', '250');
    fireEvent.click(screen.getByRole('button', { name: 'Create patient' }));
    expect(await screen.findByText('Check this value')).toBeTruthy();
    expect(field('As of').getAttribute('aria-invalid')).toBe('true');
  });

  it('sends one save at a time and cannot be closed while it runs', async () => {
    let finish: (response: Response) => void = () => undefined;
    const fetchMock = mockApi({
      mutation: (_, path) =>
        path === '/patients'
          ? new Promise<Response>((resolve) => {
              finish = resolve;
            })
          : undefined,
    });
    renderPanels({ url: '/?panel=new' });
    const aside = await panel('Register a patient');
    type('Full name', 'Rana Haddad');
    type('Phone', '03 123 456');
    const create = within(aside).getByRole('button', { name: 'Create patient' });
    fireEvent.click(create);
    fireEvent.click(create);
    await waitFor(() => {
      expect(within(aside).getByRole('button', { name: 'Cancel' })).toHaveProperty(
        'disabled',
        true,
      );
    });
    expect(within(aside).getByRole('button', { name: 'Close' })).toHaveProperty('disabled', true);
    fireEvent.keyDown(field('Full name'), { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(sent(fetchMock, 'POST', '/patients')).toBeDefined();
    expect(
      fetchMock.mock.calls.filter(([url, init]) => url === '/api/v1/patients' && init?.method),
    ).toHaveLength(1);

    finish(json(patient(50, 'Rana Haddad'), 201));
    expect(await screen.findByText('Patient created')).toBeTruthy();
  });

  it('asks before discarding on Escape', async () => {
    mockApi();
    renderPanels({ url: '/?panel=new' });
    await panel('Register a patient');
    type('Full name', 'Rana');
    fireEvent.keyDown(field('Full name'), { key: 'Escape' });
    expect(await screen.findByText('Discard unsaved changes?')).toBeTruthy();
  });

  it('starts afresh for a new pre-fill, asking first when the form is dirty', async () => {
    mockApi();
    const router = renderPanels({ url: '/?panel=new&fullName=Rana' });
    await panel('Register a patient');
    await router.navigate({ to: '/', search: { panel: 'new', fullName: 'Sami' } });
    await waitFor(() => {
      expect(field('Full name').value).toBe('Sami');
    });

    type('Phone', '03 123 456');
    void router.navigate({ to: '/', search: { panel: 'new', fullName: 'Lina' } });
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard and leave' }));
    await waitFor(() => {
      expect(field('Full name').value).toBe('Lina');
    });
    expect(field('Phone').value).toBe('');
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

  it('shows an unknown dentist on the dentist field', async () => {
    mockApi({
      patients: [RANA],
      mutation: (method) =>
        method === 'PATCH' ? problem(422, 'patient.unknown_dentist') : undefined,
    });
    renderPanels({ url: `/?panel=edit:${RANA.id}` });
    const aside = await panel('Rana Haddad');
    const dentist = screen.getByRole('combobox', { name: 'Primary dentist' });
    await within(dentist).findByRole('option', { name: 'Dr. Ana Reyes' });
    fireEvent.change(dentist, { target: { value: DENTIST_ID } });
    fireEvent.click(within(aside).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('This dentist is no longer available')).toBeTruthy();
    expect(dentist.getAttribute('aria-invalid')).toBe('true');
  });

  it('keeps the edits and warns when the patient is archived meanwhile', async () => {
    const patients = [RANA];
    mockApi({
      patients,
      mutation: (method) => {
        if (method !== 'PATCH') return undefined;
        patients[0] = { ...RANA, archivedAt: '2026-09-28T10:00:00.000Z' };
        return problem(409, 'patient.archived');
      },
    });
    renderPanels({ url: `/?panel=edit:${RANA.id}` });
    const aside = await panel('Rana Haddad');
    type('Address', '2 Second St');
    fireEvent.click(within(aside).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText("Couldn't save: the record is archived")).toBeTruthy();
    expect(
      await within(aside).findByText(/This patient was archived while you were editing/),
    ).toBeTruthy();
    expect(field('Address').value).toBe('2 Second St');
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
  });

  it('shows not found for an unknown patient', async () => {
    mockApi();
    renderPanels({ url: `/?panel=edit:${patient(99, '').id}` });
    expect(await panel('Patient not found')).toBeTruthy();
  });
});
