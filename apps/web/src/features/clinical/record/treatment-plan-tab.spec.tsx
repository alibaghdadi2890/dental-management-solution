import type { PatientChart, Permission } from '@dcm/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALL_PERMISSIONS,
  EMPTY_CHART,
  json,
  mockApi,
  patient,
  renderRecord,
} from '@/features/patients/patients.test-utils';
import { diagnosisRecord, treatmentPlan } from '../workspace/workspace.test-utils';

const RANA = patient(1, 'Rana Haddad');
const URL_ = `/patients/${RANA.id}?tab=plan`;
const READ: Permission[] = [...ALL_PERMISSIONS, 'visit:read'];
const WRITE: Permission[] = [...READ, 'chart:write'];
const own = { patientId: RANA.id, recordedInVisitId: null };

const caries = diagnosisRecord(10, 'Deep caries', '16', own);
const crown = treatmentPlan(30, 'Crown', '16', {
  ...own,
  priority: 'urgent',
  diagnosisRecordId: caries.id,
  surfaces: ['O'],
});
const rootCanal = treatmentPlan(32, 'Root canal treatment', '26', {
  ...own,
  status: 'in_progress',
  acceptedAt: '2026-03-12T09:00:00.000Z',
});
const filling = treatmentPlan(34, 'Composite', '24', {
  ...own,
  status: 'performed',
  acceptedAt: '2026-03-12T09:00:00.000Z',
});
const CHART: PatientChart = {
  ...EMPTY_CHART,
  diagnoses: [caries],
  plans: [filling, crown, rootCanal],
};

/** A fake server: priority and acceptance writes answer the chart as it then is. */
function server(held: NonNullable<Parameters<typeof mockApi>[0]>['held'] = {}) {
  const state = { chart: CHART };
  const patch = (planId: string, change: Partial<PatientChart['plans'][number]>) => {
    state.chart = {
      ...state.chart,
      plans: state.chart.plans.map((plan) => (plan.id === planId ? { ...plan, ...change } : plan)),
    };
    return json({ chart: state.chart });
  };
  const fetchMock = mockApi({
    patients: [RANA],
    held,
    get: (path) => (path.endsWith('/chart') ? json(state.chart) : undefined),
    mutation: (method, path, body) => {
      const acceptance = /\/plans\/([^/]+)\/acceptance$/.exec(path)?.[1];
      if (acceptance) {
        return patch(acceptance, {
          acceptedAt: method === 'PUT' ? '2026-09-04T09:00:00.000Z' : null,
        });
      }
      const planId = /\/plans\/([^/]+)$/.exec(path)?.[1];
      if (planId && method === 'PATCH') return patch(planId, body as { priority: 'elective' });
      return undefined;
    },
  });
  return { state, fetchMock };
}

const phase = (name: string) => screen.findByRole('region', { name });
const rowNames = (region: HTMLElement) =>
  [...region.querySelectorAll<HTMLElement>('[data-plan]')].map(
    (row) => within(row).getAllByRole('cell')[1]?.textContent,
  );

describe('TreatmentPlanTab', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the plan as its three phases, done rows dimmed and last', async () => {
    server();
    renderRecord({ url: URL_, permissions: READ });
    expect(await screen.findByRole('tab', { name: 'Treatment plan', selected: true })).toBeTruthy();
    const high = await phase('High');
    expect(rowNames(high)).toEqual(['Root canal treatment', 'Composite']);
    expect(within(high).getByText('2 items · 1 done')).toBeTruthy();
    const done = high.querySelector<HTMLElement>(`[data-plan="${filling.id}"]`);
    expect(done?.className).toContain('opacity-55');

    const urgent = await phase('Urgent');
    const [tooth, treatment, forWhat, status, accepted, price, priority] = within(
      urgent.querySelector<HTMLElement>(`[data-plan="${crown.id}"]`)!,
    ).getAllByRole('cell');
    expect(
      [tooth, treatment, forWhat, status, accepted, price, priority].map(
        (cell) => cell?.textContent,
      ),
    ).toEqual(['#16', 'CrownO', 'Deep caries', 'Planned', 'Proposed', '$400', 'Urgent']);
    expect(within(await phase('Elective')).getByText('Nothing in this phase')).toBeTruthy();
    // Reading only: nothing to change.
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: /accepted/i })).toBeNull();
  });

  it('moves a row to another phase when its priority changes, with both totals', async () => {
    const { fetchMock } = server();
    renderRecord({ url: URL_, permissions: WRITE });
    const urgent = await phase('Urgent');
    // The phase's total, and the row's price.
    expect(within(urgent).getAllByText('$400')).toHaveLength(2);
    fireEvent.change(
      within(urgent).getByRole('combobox', { name: 'Priority of the treatment for Crown' }),
      { target: { value: 'elective' } },
    );
    await waitFor(async () => {
      expect(rowNames(await phase('Elective'))).toEqual(['CrownO']);
    });
    expect(within(await phase('Elective')).getAllByText('$400')).toHaveLength(2);
    expect(rowNames(await phase('Urgent'))).toEqual([]);
    expect(within(await phase('Urgent')).queryByText('$400')).toBeNull();
    expect(within(await phase('Urgent')).getByText('Nothing in this phase')).toBeTruthy();
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === 'PATCH');
    expect(call?.[0]).toBe(`/api/v1/clinical/patients/${RANA.id}/plans/${crown.id}`);
    const body = call?.[1]?.body;
    expect(typeof body === 'string' && JSON.parse(body)).toEqual({ priority: 'elective' });
  });

  it('marks a plan accepted; work already begun keeps its acceptance', async () => {
    server();
    renderRecord({ url: URL_, permissions: WRITE });
    const urgent = await phase('Urgent');
    fireEvent.click(within(urgent).getByRole('button', { name: 'Mark Crown accepted' }));
    expect(
      await within(urgent).findByRole('button', { name: 'Take back the acceptance of Crown' }),
    ).toHaveProperty('textContent', '✓ Accepted');
    // In progress: accepted by the work, and not to be taken back.
    const high = await phase('High');
    const started = high.querySelector<HTMLElement>(`[data-plan="${rootCanal.id}"]`)!;
    expect(within(started).getByText('✓ Accepted').tagName).toBe('SPAN');
  });

  it('prints the quote of one phase', async () => {
    server();
    const open = vi.fn(() => null);
    vi.stubGlobal('open', open);
    renderRecord({ url: URL_, permissions: READ });
    fireEvent.click(await screen.findByRole('button', { name: 'Quote: Urgent' }));
    expect(open).toHaveBeenCalledWith(`/print/quote/${RANA.id}?priority=urgent`, '_blank');
    // A phase with nothing open has nothing to quote.
    expect(screen.queryByRole('button', { name: 'Quote: Elective' })).toBeNull();
  });

  it('shows what was paid in advance for the plan and what is still to pay, with payment:read', async () => {
    server({ [RANA.id]: { held: '500.00', planRemaining: '300.00' } });
    renderRecord({ url: URL_, permissions: READ });
    const advance = await screen.findByRole('region', { name: 'Paid in advance' });
    expect(within(advance).getByText('$500')).toBeTruthy();
    expect(within(advance).getByText('$300')).toBeTruthy();
  });

  it('shows nothing about advances without payment:read', async () => {
    server({ [RANA.id]: { held: '500.00', planRemaining: '300.00' } });
    renderRecord({ url: URL_, permissions: READ.filter((p) => p !== 'payment:read') });
    await phase('High');
    expect(screen.queryByRole('region', { name: 'Paid in advance' })).toBeNull();
  });
});
