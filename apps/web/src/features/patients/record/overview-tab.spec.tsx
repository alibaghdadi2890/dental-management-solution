import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, patient, patientContact, problem, renderRecord } from '../patients.test-utils';

const RANA = patient(1, 'Rana Haddad', {
  email: 'rana@example.com',
  insurance: 'Allianz — Gold',
});
const URL_ = `/patients/${RANA.id}`;

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

  it('shows an owed balance as the previous and total outstanding, in the danger tone', async () => {
    mockApi({ patients: [RANA], balances: { [RANA.id]: [{ amount: '250.00', currency: 'USD' }] } });
    renderRecord({ url: URL_ });
    const figure = await total();
    expect(figure.textContent).toBe('$250');
    expect(figure.className).toContain('text-danger');
    const balance = await card('Balance');
    expect(
      within(balance).getByText('Current visit outstanding').nextElementSibling?.textContent,
    ).toBe('—');
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
    await screen.findByRole('region', { name: 'Treatment summary' });
    expect(screen.queryByRole('region', { name: 'Balance' })).toBeNull();
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
    await card('Treatment summary');
    expect(screen.queryByRole('region', { name: 'Balance' })).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/balance'))).toBe(false);
  });

  it('shows zeros in the Treatment summary', async () => {
    mockApi({ patients: [RANA] });
    renderRecord({ url: URL_ });
    const summary = await card('Treatment summary');
    const values = within(summary)
      .getAllByRole('definition')
      .map((value) => value.textContent);
    expect(
      within(summary)
        .getAllByRole('term')
        .map((term) => term.textContent),
    ).toEqual([
      'Visits recorded',
      'Active diagnoses',
      'Planned procedures',
      'Teeth with treatment',
      'Services performed',
      'Lifetime billed',
    ]);
    expect(values).toEqual(['0', '0', '0', '0', '0', '$0']);
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
