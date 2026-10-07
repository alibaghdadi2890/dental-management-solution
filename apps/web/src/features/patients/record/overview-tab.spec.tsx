import type { Permission } from '@dcm/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALL_PERMISSIONS,
  EMPTY_CHART,
  mockApi,
  patient,
  patientContact,
  problem,
  renderRecord,
} from '../patients.test-utils';

const RANA = patient(1, 'Rana Haddad', {
  email: 'rana@example.com',
  insurance: 'Allianz — Gold',
});
const URL_ = `/patients/${RANA.id}`;
const CLINICAL: Permission[] = [...ALL_PERMISSIONS, 'visit:read'];

/** The terms and values of a card's definition list, in order. */
const rowsOf = (region: HTMLElement) =>
  within(region)
    .getAllByRole('term')
    .map((term) => [term.textContent, term.nextElementSibling?.textContent]);

/** A card of the loaded record (the loading skeleton's cards carry the same titles). */
const card = async (name: string) => {
  await screen.findByRole('heading', { level: 1 });
  return screen.getByRole('region', { name });
};

/** The figure on the Total outstanding row. */
async function total() {
  const balance = await card('Balance');
  const label = await within(balance).findByText('Total outstanding');
  const figure = label.nextElementSibling;
  if (!(figure instanceof HTMLElement)) throw new Error('No total figure');
  return figure;
}

describe('OverviewTab', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows an owed balance with nothing billed yet as previous and total, in the danger tone', async () => {
    mockApi({ patients: [RANA], balances: { [RANA.id]: [{ amount: '250.00', currency: 'USD' }] } });
    renderRecord({ url: URL_ });
    const figure = await total();
    expect(figure.textContent).toBe('$250');
    expect(figure.className).toContain('text-danger');
    const balance = await card('Balance');
    expect(within(balance).getByText(/Nothing billed yet/)).toBeTruthy();
    expect(within(balance).queryByText('Current visit outstanding')).toBeNull();
    expect(within(balance).getByText('Previous outstanding').nextElementSibling?.textContent).toBe(
      '$250',
    );
    expect(within(balance).queryByRole('button')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Record payment' })).toBeNull();
  });

  it('shows a clear balance in the success tone', async () => {
    mockApi({ patients: [RANA] });
    renderRecord({ url: URL_ });
    const figure = await total();
    expect(figure.textContent).toBe('$0');
    expect(figure.className).toContain('text-success');
  });

  it('lists a balance in another currency after the tenant currency', async () => {
    mockApi({
      patients: [RANA],
      balances: {
        [RANA.id]: [
          { amount: '40.00', currency: 'EUR' },
          { amount: '250.00', currency: 'USD' },
        ],
      },
    });
    renderRecord({ url: URL_ });
    const figure = await total();
    expect(figure.textContent).toBe('$250');
    expect(within(await card('Balance')).getByText('Also €40')).toBeTruthy();
  });

  it('leads with the owed currency when nothing is owed in the tenant currency', async () => {
    mockApi({ patients: [RANA], balances: { [RANA.id]: [{ amount: '40.00', currency: 'EUR' }] } });
    renderRecord({ url: URL_ });
    const figure = await total();
    expect(figure.textContent).toBe('€40');
    expect(figure.className).toContain('text-danger');
    expect(within(await card('Balance')).queryByText(/^Also/)).toBeNull();
  });

  it('shows a Balance skeleton card while the record loads, only with payment:read', async () => {
    const base = mockApi({ patients: [RANA] });
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
      url === `/api/v1/patients/${RANA.id}`
        ? new Promise<Response>(() => undefined)
        : base(url, init),
    );
    renderRecord({ url: URL_ });
    const balance = await screen.findByRole('region', { name: 'Balance' });
    expect(within(balance).getByLabelText('Loading patient…').getAttribute('aria-busy')).toBe(
      'true',
    );
    cleanup();
    renderRecord({ url: URL_, permissions: ['patient:read'] });
    const info = await screen.findByRole('region', { name: 'Patient information' });
    expect(screen.queryByRole('region', { name: 'Balance' })).toBeNull();
    // Like the Overview without visit:read or payment:read: one column, no empty second one.
    expect(info.parentElement?.parentElement?.children).toHaveLength(1);
  });

  it('says so when the balance fails to load', async () => {
    mockApi({
      patients: [RANA],
      get: (path) => (path.endsWith('/balance') ? problem(500, 'internal') : undefined),
    });
    renderRecord({ url: URL_ });
    expect(await within(await card('Balance')).findByRole('alert')).toHaveProperty(
      'textContent',
      'Couldn’t load the balance',
    );
  });

  it('has no Complete link without patient:write', async () => {
    mockApi({ patients: [RANA] });
    renderRecord({ url: URL_, permissions: ['patient:read', 'payment:read'] });
    const info = await card('Patient information');
    expect(within(info).queryByRole('button', { name: 'Complete' })).toBeNull();
  });

  it('has no Balance card without payment:read, and never asks for it', async () => {
    const fetchMock = mockApi({ patients: [RANA] });
    renderRecord({ url: URL_, permissions: ['patient:read', 'patient:write'] });
    await card('Patient information');
    expect(screen.queryByRole('region', { name: 'Balance' })).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/balance'))).toBe(false);
  });

  it('fills the Treatment summary from the clinical counts and the visit charges (W8)', async () => {
    mockApi({
      patients: [RANA],
      summaries: {
        [RANA.id]: {
          visits: 3,
          activeDiagnoses: 2,
          plannedProcedures: 1,
          teethTreated: 4,
          servicesPerformed: 1250,
          missingTeeth: 4,
          implants: 1,
        },
      },
      charged: {
        [RANA.id]: [
          { amount: '20.00', currency: 'EUR' },
          { amount: '1480.50', currency: 'USD' },
        ],
      },
    });
    renderRecord({ url: URL_, permissions: CLINICAL });
    const summary = await card('Treatment summary');
    await waitFor(() => {
      expect(rowsOf(summary)).toEqual([
        ['Visits recorded', '3'],
        ['Active diagnoses', '2'],
        ['Planned procedures', '1'],
        ['Teeth with treatment', '4'],
        ['Services performed', '1,250'],
        ['Lifetime billed', '$1,480.50'],
      ]);
    });
    // Feature 7: shown only when either is above zero.
    expect(within(summary).getByText('Missing teeth: 4 · Implants: 1')).toBeTruthy();
  });

  it('bills $0 over a lifetime without visit charges, and leaves the row out without payment:read', async () => {
    mockApi({ patients: [RANA] });
    renderRecord({ url: URL_, permissions: CLINICAL });
    const summary = await card('Treatment summary');
    await waitFor(() => {
      expect(rowsOf(summary).at(-1)).toEqual(['Lifetime billed', '$0']);
    });
    expect(
      rowsOf(summary)
        .slice(0, 5)
        .map(([, value]) => value),
    ).toEqual(['0', '0', '0', '0', '0']);

    cleanup();
    const fetchMock = mockApi({ patients: [RANA] });
    renderRecord({ url: URL_, permissions: ['patient:read', 'visit:read'] });
    const again = await card('Treatment summary');
    await waitFor(() => {
      expect(rowsOf(again)).toHaveLength(5);
    });
    expect(within(again).queryByText('Lifetime billed')).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/balance'))).toBe(false);
  });

  it('shows the last visit: its facts, its services as chips and its note', async () => {
    mockApi({
      patients: [RANA],
      lastVisits: {
        [RANA.id]: {
          id: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d60',
          date: '2026-05-04',
          dentistName: 'Dr. Ana Reyes',
          durationMinutes: 45,
          total: { amount: '140.00', currency: 'USD' },
          services: [
            { name: 'Composite filling', toothCode: '16', jaw: null },
            { name: 'Scaling', toothCode: null, jaw: null },
          ],
          notes: 'Occlusal caries on 16, restored.',
        },
      },
    });
    renderRecord({ url: URL_, permissions: CLINICAL });
    const last = await card('Last visit');
    await within(last).findByText('Dr. Ana Reyes');
    expect(rowsOf(last)).toEqual([
      ['Date', '4 May 2026'],
      ['Dentist', 'Dr. Ana Reyes'],
      ['Duration', '45 min'],
      ['Total', '$140'],
    ]);
    const chips = within(last).getByRole('list', { name: 'Services' });
    expect(
      within(chips)
        .getAllByRole('listitem')
        .map((chip) => chip.textContent),
    ).toEqual(['Composite filling · #16', 'Scaling · Whole mouth']);
    expect(within(last).getByText('Occlusal caries on 16, restored.').tagName).toBe('BLOCKQUOTE');
    expect(within(last).getByRole('button', { name: /All visits/ })).toBeTruthy();
  });

  it('reads dashes and "No visits recorded yet." before the first completed visit', async () => {
    mockApi({ patients: [RANA] });
    renderRecord({ url: URL_, permissions: CLINICAL });
    const last = await card('Last visit');
    expect(await within(last).findByText('No visits recorded yet.')).toBeTruthy();
    expect(rowsOf(last)).toEqual([
      ['Date', '—'],
      ['Dentist', '—'],
      ['Duration', '—'],
      ['Total', '—'],
    ]);
    expect(within(last).queryByRole('list')).toBeNull();
  });

  it('shows the compact chart, not selectable, whose teeth open their history', async () => {
    mockApi({ patients: [RANA], charts: { [RANA.id]: EMPTY_CHART } });
    renderRecord({ url: URL_, permissions: CLINICAL });
    const dental = await card('Dental status');
    expect(within(dental).getByText('Click a tooth for its full history')).toBeTruthy();
    await within(dental).findByRole('group', { name: 'Upper arch' });
    const tooth = within(dental).getByRole('button', { name: /^#16 · Upper right first molar/ });
    expect(tooth.getAttribute('aria-pressed')).toBeNull();
    expect(within(dental).queryByText('R')).toBeNull();
    fireEvent.click(tooth);
    expect(await screen.findByRole('dialog', { name: 'Tooth #16' })).toBeTruthy();
  });

  it('puts the visit cards on the left and the details on the right, with visit:read', async () => {
    mockApi({ patients: [RANA] });
    renderRecord({ url: URL_, permissions: CLINICAL });
    await card('Last visit');
    const titles = screen
      .getAllByRole('region')
      .map((region) => region.getAttribute('aria-labelledby'))
      .map((id) => (id ? document.getElementById(id)?.textContent : null));
    expect(titles).toEqual([
      'Last visit',
      'Dental status',
      'Balance',
      'Treatment summary',
      'Patient information',
    ]);
  });

  it('has no visit cards without visit:read, and never asks clinical for them', async () => {
    const fetchMock = mockApi({ patients: [RANA] });
    renderRecord({ url: URL_ });
    await card('Patient information');
    for (const name of ['Last visit', 'Dental status', 'Treatment summary']) {
      expect(screen.queryByRole('region', { name })).toBeNull();
    }
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/clinical/'))).toBe(false);
  });

  it('says so when a clinical read fails', async () => {
    mockApi({
      patients: [RANA],
      get: (path) => (path.startsWith('/clinical/') ? problem(500, 'internal') : undefined),
    });
    renderRecord({ url: URL_, permissions: CLINICAL });
    expect((await within(await card('Last visit')).findByRole('alert')).textContent).toBe(
      'Couldn’t load the last visit',
    );
    expect((await within(await card('Dental status')).findByRole('alert')).textContent).toBe(
      'Couldn’t load the chart',
    );
    expect((await within(await card('Treatment summary')).findByRole('alert')).textContent).toBe(
      'Couldn’t load the treatment summary',
    );
  });

  it('shows the patient information, "Not recorded" where missing, and Complete opens the tab', async () => {
    mockApi({ patients: [RANA] });
    const { router } = renderRecord({ url: URL_ });
    const info = await card('Patient information');
    await waitFor(() => {
      expect(within(info).getByText('Contacts').nextElementSibling?.textContent).toBe(
        'Not recorded',
      );
    });
    const rows = Object.fromEntries(
      within(info)
        .getAllByRole('term')
        .map((term) => [term.textContent, term.nextElementSibling?.textContent]),
    );
    expect(rows).toEqual({
      Phone: '03 123 456',
      'Date of birth': '1 May 1990',
      Email: 'rana@example.com',
      Address: 'Not recorded',
      Insurance: 'Allianz — Gold',
      Contacts: 'Not recorded',
    });
    fireEvent.click(within(info).getByRole('button', { name: 'Complete' }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ tab: 'information' });
    });
    expect(
      await screen.findByRole('tab', { name: 'Patient information', selected: true }),
    ).toBeTruthy();
  });

  describe('Contacts row (design addendum "Record")', () => {
    /** The Contacts row's value, once the contacts have loaded. */
    const contactsRow = async () => {
      const info = await card('Patient information');
      const value = within(info).getByText('Contacts').nextElementSibling;
      if (!(value instanceof HTMLElement)) throw new Error('No Contacts value');
      await waitFor(() => {
        expect(within(value).queryByRole('status')).toBeNull();
      });
      return value;
    };
    const billing = { isBillingContact: true, isPrimaryBilling: true };

    it('names the primary guardian and the primary billing contact', async () => {
      mockApi({
        patients: [RANA],
        contacts: {
          [RANA.id]: [
            patientContact(61, 'Sami Haddad', { isPrimaryGuardian: false }),
            patientContact(60, 'Maria Haddad'),
            patientContact(62, 'Karim Haddad', {
              isGuardian: false,
              isPrimaryGuardian: false,
              ...billing,
            }),
          ],
        },
      });
      renderRecord({ url: URL_ });
      expect((await contactsRow()).textContent).toBe(
        'Guardian: Maria Haddad · Billing: Karim Haddad',
      );
    });

    it('announces the contacts loading', async () => {
      mockApi({
        patients: [RANA],
        get: (path) =>
          path.endsWith('/contacts') ? new Promise<Response>(() => undefined) : undefined,
      });
      renderRecord({ url: URL_ });
      const info = await card('Patient information');
      const value = within(info).getByText('Contacts').nextElementSibling as HTMLElement;
      expect(within(value).getByRole('status', { name: 'Loading contacts' })).toBeTruthy();
    });

    it('names the first holder of a role when none is marked primary, as the header does', async () => {
      mockApi({
        patients: [RANA],
        contacts: {
          [RANA.id]: [
            patientContact(61, 'Sami Haddad', { isPrimaryGuardian: false }),
            patientContact(62, 'Nadia Haddad', { isPrimaryGuardian: false }),
          ],
        },
      });
      renderRecord({ url: URL_ });
      expect((await contactsRow()).textContent).toBe('Guardian: Sami Haddad');
    });

    it('names one person once, with their roles, when they are both', async () => {
      mockApi({
        patients: [RANA],
        contacts: { [RANA.id]: [patientContact(60, 'Maria Haddad', billing)] },
      });
      renderRecord({ url: URL_ });
      expect((await contactsRow()).textContent).toBe('Maria Haddad (guardian, billing)');
    });

    it('names the primary emergency contact too, the row replacing Emergency', async () => {
      mockApi({
        patients: [RANA],
        contacts: {
          [RANA.id]: [
            patientContact(60, 'Maria Haddad', billing),
            patientContact(62, 'Nadia Haddad', {
              isGuardian: false,
              isPrimaryGuardian: false,
              isEmergencyContact: true,
              isPrimaryEmergency: true,
            }),
          ],
        },
      });
      renderRecord({ url: URL_ });
      expect((await contactsRow()).textContent).toBe(
        'Maria Haddad (guardian, billing) · Emergency: Nadia Haddad',
      );
    });

    it('reads "Not recorded" without contacts, in the muted tone', async () => {
      mockApi({ patients: [RANA], contacts: { [RANA.id]: [] } });
      renderRecord({ url: URL_ });
      const value = await contactsRow();
      expect(value.textContent).toBe('Not recorded');
      expect(value.querySelector('span')?.className).toContain('text-ink-muted');
    });

    it('says so when the contacts fail to load', async () => {
      mockApi({
        patients: [RANA],
        get: (path) => (path.endsWith('/contacts') ? problem(500, 'internal') : undefined),
      });
      renderRecord({ url: URL_ });
      expect((await contactsRow()).textContent).toBe('Couldn’t load the contacts.');
    });
  });
});
