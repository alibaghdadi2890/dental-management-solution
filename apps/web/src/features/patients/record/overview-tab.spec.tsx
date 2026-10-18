import type { LastVisit, Permission } from '@dcm/contracts';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALL_PERMISSIONS,
  EMPTY_CHART,
  json,
  mockApi,
  patient,
  problem,
  renderRecord,
} from '../patients.test-utils';
import {
  diagnosisRecord,
  OLDER_VISIT_ID,
  treatmentPlan,
} from '@/features/clinical/workspace/workspace.test-utils';

const RANA = patient(1, 'Rana Haddad', {
  email: 'rana@example.com',
  insurance: 'Allianz — Gold',
});
const URL_ = `/patients/${RANA.id}`;
const CLINICAL: Permission[] = [...ALL_PERMISSIONS, 'visit:read'];
const LAST_VISIT: NonNullable<LastVisit> = {
  id: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d60',
  displayNumber: 42,
  type: 'treatment',
  reason: null,
  date: '2026-05-04',
  dentistName: 'Dr. Ana Reyes',
  durationMinutes: 45,
  total: { amount: '140.00', currency: 'USD' },
  services: [
    { name: 'Composite filling', toothCode: '16', jaw: null },
    { name: 'Scaling', toothCode: null, jaw: null },
  ],
  notes: 'Occlusal caries on 16, restored.',
};

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
    const attention = await screen.findByRole('region', { name: 'Needs attention' });
    expect(screen.queryByRole('region', { name: 'Balance' })).toBeNull();
    // Like the Overview without visit:read or payment:read: one column, no empty second one.
    expect(attention.parentElement?.parentElement?.children).toHaveLength(1);
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

  it('has no Balance card without payment:read, and never asks for it', async () => {
    const fetchMock = mockApi({ patients: [RANA] });
    renderRecord({ url: URL_, permissions: ['patient:read', 'patient:write'] });
    await card('Needs attention');
    expect(screen.queryByRole('region', { name: 'Balance' })).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => url.includes('/balance'))).toBe(false);
  });

  it('shows the last visit: its facts, its services as chips and its note', async () => {
    mockApi({
      patients: [RANA],
      lastVisits: {
        [RANA.id]: LAST_VISIT,
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

  it('arranges the cards in two columns of three, with every read', async () => {
    mockApi({
      patients: [RANA],
      get: (path) => (path.startsWith('/files') ? json({ items: [] }) : undefined),
    });
    renderRecord({ url: URL_, permissions: [...CLINICAL, 'file:read'] });
    await card('Last visit');
    const titles = screen
      .getAllByRole('region')
      .map((region) => region.getAttribute('aria-labelledby'))
      .map((id) => (id ? document.getElementById(id)?.textContent : null));
    expect(titles).toEqual([
      'Needs attention',
      'Last visit',
      'Latest images',
      'Treatment plan',
      'Balance',
      'Dental status',
    ]);
    // The retired cards are gone (feature 10, V18).
    for (const name of ['Treatment summary', 'Patient information']) {
      expect(screen.queryByRole('region', { name })).toBeNull();
    }
    expect(await within(await card('Latest images')).findByText('No images yet.')).toBeTruthy();
  });

  it('has no visit cards without visit:read, and never asks clinical for them', async () => {
    const fetchMock = mockApi({ patients: [RANA] });
    renderRecord({ url: URL_ });
    await card('Needs attention');
    for (const name of ['Last visit', 'Dental status', 'Treatment plan']) {
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
    expect((await within(await card('Treatment plan')).findByRole('alert')).textContent).toBe(
      'Couldn’t load the treatment plan',
    );
  });

  describe('Needs attention (feature 10, V11)', () => {
    const rootCanal = treatmentPlan(32, 'Root canal treatment', '26', {
      patientId: RANA.id,
      status: 'in_progress',
      estimatedSessions: 3,
      sessions: [{ visitId: OLDER_VISIT_ID, date: '2026-03-12', note: null }],
    });
    const caries = diagnosisRecord(10, 'Deep caries', '16', { patientId: RANA.id });
    const crown = treatmentPlan(30, 'Crown', '16', {
      patientId: RANA.id,
      priority: 'urgent',
      acceptedAt: '2026-04-02T09:00:00.000Z',
      recordedAt: '2026-04-02T09:00:00.000Z',
      diagnosisRecordId: caries.id,
    });
    // Urgent, but the patient has not accepted it: not a next step yet.
    const proposed = treatmentPlan(34, 'Extraction', '48', {
      patientId: RANA.id,
      priority: 'urgent',
    });
    const RETURNING = {
      patients: [RANA],
      balances: { [RANA.id]: [{ amount: '128.00', currency: 'USD' }] },
      lastVisits: { [RANA.id]: LAST_VISIT },
      charts: {
        [RANA.id]: {
          ...EMPTY_CHART,
          diagnoses: [caries],
          plans: [
            crown,
            proposed,
            rootCanal,
            treatmentPlan(36, 'Whitening', null, { patientId: RANA.id, priority: 'elective' }),
          ],
        },
      },
    };
    const rows = async () => {
      const attention = await card('Needs attention');
      await within(attention).findByText('Outstanding balance');
      return within(attention).getAllByRole('listitem');
    };

    it('lists work in progress, an accepted urgent plan and the balance, in that order', async () => {
      mockApi(RETURNING);
      renderRecord({ url: URL_, permissions: [...CLINICAL, 'visit:write'] });
      const items = await rows();
      expect(items.map((item) => item.textContent)).toEqual([
        '#26Root canal treatmentSession 2 of 3 not finished · started 12 Mar 2026In progressContinue',
        '#16CrownDeep caries · planned 2 Apr 2026, not done yetUrgentTreat',
        '$Outstanding balance$128 unpaidHigh',
      ]);

      // The plan card groups what is open by priority, each phase with its total.
      const plan = await card('Treatment plan');
      const phases = [...plan.querySelectorAll<HTMLElement>('[data-phase]')].map((phase) => [
        phase.dataset.phase,
        within(phase).getByRole('heading').nextElementSibling?.textContent,
        within(phase)
          .getAllByRole('listitem')
          .map((item) => item.textContent),
      ]);
      expect(phases).toEqual([
        ['urgent', '$800', ['#16CrownAccepted', '#48ExtractionPlanned']],
        ['high', '$400', ['#26Root canal treatmentIn progress']],
        ['elective', '$400', ['Whole mouthWhiteningPlanned']],
      ]);
    });

    it('opens Start visit on a treatment visit for the item', async () => {
      mockApi(RETURNING);
      renderRecord({ url: URL_, permissions: [...CLINICAL, 'visit:write'] });
      const [continued] = await rows();
      fireEvent.click(within(continued!).getByRole('button', { name: 'Continue' }));
      expect(await screen.findByRole('dialog', { name: 'Start visit' })).toBeTruthy();
    });

    it('shows the rows without their actions to someone who can only read', async () => {
      mockApi(RETURNING);
      renderRecord({ url: URL_, permissions: ['patient:read', 'payment:read', 'visit:read'] });
      const items = await rows();
      expect(items).toHaveLength(3);
      expect(within(await card('Needs attention')).queryByRole('button')).toBeNull();
    });

    it('says a patient who was never seen has no examination yet', async () => {
      mockApi({ patients: [RANA] });
      renderRecord({ url: URL_, permissions: [...CLINICAL, 'visit:write'] });
      const attention = await card('Needs attention');
      expect(await within(attention).findByText('No examination yet')).toBeTruthy();
      expect(within(attention).getByRole('button', { name: 'Start examination' })).toBeTruthy();
      expect(within(attention).getAllByRole('listitem')).toHaveLength(1);
    });

    it('names the missing details and opens Patient information for them (ADR-0052)', async () => {
      const unknown = { ...RANA, dateOfBirth: null, sex: 'unknown' as const };
      mockApi({ patients: [unknown], lastVisits: { [RANA.id]: LAST_VISIT } });
      renderRecord({ url: URL_, permissions: CLINICAL });
      const attention = await card('Needs attention');
      expect(await within(attention).findByText('Missing information')).toBeTruthy();
      expect(within(attention).getByText('date of birth and sex')).toBeTruthy();
      fireEvent.click(within(attention).getByRole('button', { name: 'Complete details' }));
      expect(
        await screen.findByRole('tab', { name: 'Patient information', selected: true }),
      ).toBeTruthy();
    });

    it('shows the missing details without their action to someone who cannot edit', async () => {
      const unknown = { ...RANA, sex: 'unknown' as const };
      mockApi({ patients: [unknown], lastVisits: { [RANA.id]: LAST_VISIT } });
      renderRecord({ url: URL_, permissions: ['patient:read', 'visit:read'] });
      const attention = await card('Needs attention');
      expect(await within(attention).findByText('Missing information')).toBeTruthy();
      expect(within(attention).queryByRole('button')).toBeNull();
    });

    it('says so when nothing needs attention', async () => {
      mockApi({ patients: [RANA], lastVisits: { [RANA.id]: LAST_VISIT } });
      renderRecord({ url: URL_, permissions: CLINICAL });
      expect(
        await within(await card('Needs attention')).findByText('Nothing needs attention.'),
      ).toBeTruthy();
    });
  });
});
