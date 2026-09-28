import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, patient, problem, renderRecord } from '../patients.test-utils';

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
      Emergency: 'Not recorded',
    });
    fireEvent.click(within(info).getByRole('button', { name: 'Complete' }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ tab: 'information' });
    });
    expect(
      await screen.findByRole('tab', { name: 'Patient information', selected: true }),
    ).toBeTruthy();
  });
});
