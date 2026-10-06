import type { PatientChart, ToothCode, Visit } from '@dcm/contracts';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { id, json } from '@/features/patients/patients.test-utils';
import { SAVE_DEBOUNCE_MS } from '../../save-groups-store';
import {
  chart,
  diagnosisRecord,
  FRONT_DESK,
  historyLine,
  mockWorkspace,
  OLDER_VISIT_ID,
  pickRowAction,
  renderWorkspace,
  sent,
  serviceItem,
  treatmentPlan,
  visit,
  VISIT_ID,
  visitService,
} from '../workspace.test-utils';

/** A little fake server: the visit and chart as they stand, changed by the charting writes the
 * panel sends (perform, remove service, price edit, tooth presence, add service). */
function fakeClinic(initial: { visit?: Visit; chart?: PatientChart } = {}) {
  const state = { visit: initial.visit ?? visit(), chart: initial.chart ?? chart() };
  const fetchMock = mockWorkspace({
    visit: () => state.visit,
    chart: () => state.chart,
    services: [
      serviceItem(40, 'Composite filling', { frequent: true }),
      serviceItem(42, 'Scaling', { chargeUnit: 'per_jaw', category: 'Periodontal' }),
    ],
    mutation: (method, path, body) => {
      const perform = /\/plans\/([^/]+)\/perform$/.exec(path)?.[1];
      if (method === 'POST' && perform) {
        const plan = state.chart.plans.find((row) => row.id === perform);
        if (!plan) return undefined;
        const performed = { ...plan, status: 'performed' as const, performedInVisitId: VISIT_ID };
        const service = visitService(50, plan.name, plan.toothCode, { planId: plan.id });
        state.chart = {
          ...state.chart,
          plans: state.chart.plans.map((row) => (row.id === plan.id ? performed : row)),
        };
        state.visit = { ...state.visit, services: [...state.visit.services, service] };
        return json({ visit: state.visit, record: performed });
      }
      const serviceId = /\/services\/([^/]+)$/.exec(path)?.[1];
      const service = state.visit.services.find((row) => row.id === serviceId);
      if (method === 'DELETE' && service) {
        state.visit = {
          ...state.visit,
          services: state.visit.services.filter((row) => row.id !== service.id),
        };
        state.chart = {
          ...state.chart,
          plans: state.chart.plans.map((row) =>
            row.id === service.planId
              ? { ...row, status: 'planned' as const, performedInVisitId: null }
              : row,
          ),
        };
        return json({ visit: state.visit, record: service });
      }
      if (method === 'PATCH' && service) {
        const { baseAmount, discountAmount } = body as {
          baseAmount: string;
          discountAmount: string;
        };
        const updated = {
          ...service,
          base: { amount: baseAmount, currency: 'USD' },
          discount: { amount: discountAmount, currency: 'USD' },
        };
        state.visit = {
          ...state.visit,
          services: state.visit.services.map((row) => (row.id === service.id ? updated : row)),
        };
        return json({ visit: state.visit, record: updated });
      }
      if (method === 'POST' && path.endsWith('/services')) {
        const { toothCode, surfaces } = body as { toothCode?: ToothCode; surfaces: [] };
        const added = visitService(51, 'Composite filling', toothCode ?? null, { surfaces });
        state.visit = { ...state.visit, services: [...state.visit.services, added] };
        return json({ visit: state.visit, record: added });
      }
      const position = /\/teeth\/(\d+)$/.exec(path)?.[1];
      if (method === 'PUT' && position) {
        const { present } = body as { present: 'primary' | 'permanent' };
        const record = { position: position as '14', present };
        const others = state.chart.toothStatus.filter((row) => row.position !== position);
        state.chart = { ...state.chart, toothStatus: [...others, record] };
        return json({ visit: state.visit, record });
      }
      return undefined;
    },
  });
  return { state, fetchMock };
}

const aside = () => screen.getByRole('complementary', { name: 'Selected tooth' });

/** Waits for the chart, then selects a tooth by its column button. */
async function selectTooth(label: RegExp) {
  await screen.findByRole('group', { name: 'Upper arch' });
  const card = screen.getByRole('region', { name: 'Dental chart' });
  fireEvent.click(within(card).getByRole('button', { name: label }));
}

const section = (name: string) => within(aside()).getByRole('region', { name });

const collapse = (name: string) => {
  fireEvent.click(within(section(name)).getByRole('button', { expanded: true }));
};

describe('ToothPanel', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shows the empty state until a tooth is selected', async () => {
    fakeClinic();
    renderWorkspace();
    const panel = await screen.findByRole('complementary', { name: 'Selected tooth' });
    expect(await within(panel).findByText('No tooth selected')).toBeTruthy();
  });

  it('shows the header: label, Upper, name and the surface hint', async () => {
    fakeClinic();
    renderWorkspace();
    await selectTooth(/^#16 · /);
    expect(within(aside()).getByRole('heading', { name: '#16' })).toBeTruthy();
    expect(within(aside()).getByText('Upper')).toBeTruthy();
    expect(within(aside()).getByText('Upper right first molar')).toBeTruthy();
    expect(within(aside()).queryByText(/^Surfaces selected/)).toBeNull();
  });

  it('builds the pending surface scope from the glyph, and adding a service clears it', async () => {
    const { fetchMock } = fakeClinic();
    renderWorkspace();
    await selectTooth(/^#16 · /);
    fireEvent.click(within(aside()).getByRole('button', { name: /^Occlusal/ }));
    fireEvent.click(within(aside()).getByRole('button', { name: /^Distal/ }));
    expect(within(aside()).getByText('Surfaces selected: Occlusal, Distal')).toBeTruthy();
    expect(
      within(aside())
        .getByRole('button', { name: /^Occlusal/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');

    fireEvent.click(within(aside()).getByRole('button', { name: 'Add completed service' }));
    const drawer = await screen.findByRole('dialog', { name: 'Add completed service' });
    expect(within(drawer).getByText('Tooth #16 · Upper right first molar · O · D')).toBeTruthy();
    const frequent = await within(drawer).findByRole('region', { name: 'Frequently used' });
    fireEvent.click(within(frequent).getByRole('button', { name: /Composite filling.*#16/ }));

    await waitFor(() => {
      expect(sent(fetchMock, 'POST', `/visits/${VISIT_ID}/services`)).toEqual({
        procedureId: id(40),
        toothCode: '16',
        surfaces: ['O', 'D'],
      });
    });
    expect(within(aside()).queryByText(/^Surfaces selected/)).toBeNull();
    expect(await screen.findByText('Composite filling added')).toBeTruthy();
    expect(screen.getByText('Tooth #16')).toBeTruthy();
  });

  it('collapses each stage to its summary', async () => {
    fakeClinic({
      visit: visit({ services: [visitService(30, 'Composite filling', '16')] }),
      chart: chart({
        diagnoses: [
          diagnosisRecord(10, 'Dental caries', '16'),
          diagnosisRecord(12, 'Cracked tooth', '16', { status: 'resolved' }),
        ],
        plans: [treatmentPlan(20, 'Zircon crown', '16')],
        history: [historyLine(32, 'Scaling', '16'), historyLine(33, 'Sealant', '16')],
      }),
    });
    renderWorkspace();
    await selectTooth(/^#16 · /);

    for (const name of ['Diagnosis', 'Treatment plan', 'Completed']) collapse(name);
    expect(within(section('Diagnosis')).getByText('Dental caries')).toBeTruthy();
    expect(within(section('Treatment plan')).getByText('Zircon crown · $400')).toBeTruthy();
    expect(within(section('Completed')).getByText('1 this visit · 2 previously')).toBeTruthy();
    // The planned strip stays above the stages.
    expect(within(aside()).getByText('Planned: Zircon crown · $400')).toBeTruthy();

    // A closed stage stays closed on another tooth, where it summarises that tooth.
    await selectTooth(/^#17 · /);
    expect(within(section('Diagnosis')).getByText('none recorded')).toBeTruthy();
    expect(within(section('Treatment plan')).getByText('nothing planned')).toBeTruthy();
    expect(within(section('Completed')).getByText('nothing recorded')).toBeTruthy();
  });

  it('summarises all resolved and all performed (in this visit, as the note says)', async () => {
    fakeClinic({
      chart: chart({
        diagnoses: [diagnosisRecord(10, 'Dental caries', '16', { status: 'resolved' })],
        plans: [
          treatmentPlan(20, 'Zircon crown', '16', {
            status: 'performed',
            performedInVisitId: VISIT_ID,
          }),
          treatmentPlan(22, 'Root canal', '17', {
            status: 'performed',
            performedInVisitId: OLDER_VISIT_ID,
          }),
        ],
      }),
    });
    renderWorkspace();
    await selectTooth(/^#16 · /);
    expect(
      within(section('Treatment plan')).getByText('One planned treatment performed — see below.'),
    ).toBeTruthy();
    collapse('Diagnosis');
    collapse('Treatment plan');
    expect(within(section('Diagnosis')).getByText('all resolved')).toBeTruthy();
    expect(within(section('Treatment plan')).getByText('all performed')).toBeTruthy();

    // Performed in an earlier visit: the body shows the empty block, so the summary agrees.
    await selectTooth(/^#17 · /);
    expect(within(section('Treatment plan')).getByText('nothing planned')).toBeTruthy();
    fireEvent.click(within(section('Treatment plan')).getByRole('button', { expanded: false }));
    expect(within(section('Treatment plan')).getByText('No planned treatment'));
  });

  it('offers Remove only on records of this visit; older ones are resolved or cancelled', async () => {
    const { fetchMock } = fakeClinic({
      chart: chart({
        diagnoses: [
          diagnosisRecord(10, 'Dental caries', '16'),
          diagnosisRecord(12, 'Old abscess', '16', { recordedInVisitId: OLDER_VISIT_ID }),
        ],
        plans: [
          treatmentPlan(20, 'Zircon crown', '16'),
          treatmentPlan(22, 'Root canal', '16', { recordedInVisitId: OLDER_VISIT_ID }),
        ],
      }),
    });
    renderWorkspace();
    await selectTooth(/^#16 · /);
    const panel = within(aside());

    expect(panel.getByRole('button', { name: 'Remove Dental caries' })).toBeTruthy();
    expect(panel.queryByRole('button', { name: 'Remove Old abscess' })).toBeNull();
    expect(panel.getByRole('button', { name: 'Resolve Old abscess' })).toBeTruthy();
    expect(panel.getByRole('button', { name: 'Remove Zircon crown' })).toBeTruthy();
    expect(panel.queryByRole('button', { name: 'Remove Root canal' })).toBeNull();

    // Cancelling a plan from an earlier visit asks first (4a follow-up).
    fireEvent.click(panel.getByRole('button', { name: 'Cancel Root canal' }));
    expect(await screen.findByText('Cancel Root canal?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel plan' }));
    expect(await screen.findByText('Root canal cancelled')).toBeTruthy();
    fireEvent.click(panel.getByRole('button', { name: 'Resolve Old abscess' }));
    await waitFor(() => {
      expect(sent(fetchMock, 'POST', `/visits/${VISIT_ID}/plans/${id(22)}/cancel`)).toBeNull();
      expect(sent(fetchMock, 'POST', `/visits/${VISIT_ID}/diagnoses/${id(12)}/resolve`)).toBeNull();
    });
  });

  it('Perform now replaces the plan with the note; Undo deletes the service and restores it', async () => {
    const { fetchMock } = fakeClinic({
      chart: chart({ plans: [treatmentPlan(20, 'Zircon crown', '16')] }),
    });
    renderWorkspace();
    await selectTooth(/^#16 · /);

    fireEvent.click(within(aside()).getByRole('button', { name: 'Perform now: Zircon crown' }));
    expect(
      await within(aside()).findByText('One planned treatment performed — see below.'),
    ).toBeTruthy();
    expect(within(aside()).queryByRole('button', { name: 'Perform now: Zircon crown' })).toBeNull();
    // The service card, tagged as coming from the plan.
    expect(within(section('Completed')).getByText('From plan')).toBeTruthy();

    expect(await screen.findByText('Zircon crown performed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(
      await within(aside()).findByRole('button', { name: 'Perform now: Zircon crown' }),
    ).toBeTruthy();
    expect(sent(fetchMock, 'DELETE', `/visits/${VISIT_ID}/services/${id(50)}`)).toBeNull();
    expect(within(aside()).queryByText('One planned treatment performed — see below.')).toBeNull();
  });

  it('autosaves a service’s price, capping the discount at the base', async () => {
    const { fetchMock } = fakeClinic({
      visit: visit({ services: [visitService(30, 'Composite filling', '16')] }),
    });
    renderWorkspace();
    await selectTooth(/^#16 · /);
    const card = within(section('Completed'));
    vi.useFakeTimers({ shouldAdvanceTime: true });

    fireEvent.change(card.getByLabelText('Base price'), { target: { value: '120' } });
    fireEvent.change(card.getByLabelText('Discount'), { target: { value: '150' } });
    expect(card.getByText('$0')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    });
    await waitFor(() => {
      expect(sent(fetchMock, 'PATCH', `/visits/${VISIT_ID}/services/${id(30)}`)).toEqual({
        baseAmount: '120',
        discountAmount: '120',
      });
    });
  });

  it('removing a service drops its unsaved price edit', async () => {
    const { fetchMock } = fakeClinic({
      visit: visit({ services: [visitService(30, 'Composite filling', '16')] }),
    });
    renderWorkspace();
    await selectTooth(/^#16 · /);
    vi.useFakeTimers({ shouldAdvanceTime: true });

    fireEvent.change(within(section('Completed')).getByLabelText('Base price'), {
      target: { value: '95' },
    });
    await pickRowAction(within(aside()), 'Composite filling', 'Remove');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS * 2);
    });
    await waitFor(() => {
      expect(sent(fetchMock, 'DELETE', `/visits/${VISIT_ID}/services/${id(30)}`)).toBeNull();
    });
    expect(sent(fetchMock, 'PATCH', `/visits/${VISIT_ID}/services/${id(30)}`)).toBeUndefined();
    expect(within(section('Completed')).getByText('No treatment recorded'));
  });

  it('forgets a price edit whose service someone else removed, so Complete can go ahead', async () => {
    const { state, fetchMock } = fakeClinic({
      visit: visit({ services: [visitService(30, 'Composite filling', '16')] }),
    });
    renderWorkspace();
    await selectTooth(/^#16 · /);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Removed elsewhere: the price save answers 404 and the refetch has no such service.
    state.visit = { ...state.visit, services: [] };
    fireEvent.change(within(section('Completed')).getByLabelText('Base price'), {
      target: { value: '95' },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);
    });
    await waitFor(() => {
      expect(within(section('Completed')).getByText('No treatment recorded'));
    });
    expect(sent(fetchMock, 'PATCH', `/visits/${VISIT_ID}/services/${id(30)}`)).toEqual({
      baseAmount: '95',
      discountAmount: '0.00',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Review & complete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Complete visit' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Complete visit' }));
    await waitFor(() => {
      expect(sent(fetchMock, 'POST', `/visits/${VISIT_ID}/complete`)).toBeNull();
    });
    const patches = fetchMock.mock.calls.filter(([, init]) => init?.method === 'PATCH');
    expect(patches).toHaveLength(1);
  });

  it('removes a service from its menu, and a service already gone is no error', async () => {
    const { state, fetchMock } = fakeClinic({
      visit: visit({ services: [visitService(30, 'Composite filling', '16')] }),
    });
    renderWorkspace();
    await selectTooth(/^#16 · /);
    // Someone else removed it already: the server answers 404.
    state.visit = { ...state.visit, services: [] };
    await pickRowAction(within(aside()), 'Composite filling', 'Remove');
    await waitFor(() => {
      expect(within(section('Completed')).getByText('No treatment recorded'));
    });
    const deletes = fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(screen.queryByText(/^Couldn’t save the change|^Couldn't save the change/)).toBeNull();
  });

  it('lists earlier services under Previously, without the empty block', async () => {
    fakeClinic({
      chart: chart({ history: [historyLine(32, 'Sealant', '16', { surfaces: ['O'] })] }),
    });
    renderWorkspace();
    await selectTooth(/^#16 · /);
    const completed = within(section('Completed'));
    expect(completed.getByText('Previously')).toBeTruthy();
    expect(completed.getByText('Sealant')).toBeTruthy();
    expect(completed.getByText('$60')).toBeTruthy();
    expect(completed.queryByText('No treatment recorded')).toBeNull();
  });

  it('is read-only for front desk: no add, remove, perform or surface toggles', async () => {
    fakeClinic({
      visit: visit({ services: [visitService(30, 'Composite filling', '16')] }),
      chart: chart({
        diagnoses: [diagnosisRecord(10, 'Dental caries', '16')],
        plans: [treatmentPlan(20, 'Zircon crown', '16')],
      }),
    });
    renderWorkspace({ permissions: FRONT_DESK });
    await selectTooth(/^#16 · /);
    const panel = within(aside());
    expect(panel.getByText('Dental caries')).toBeTruthy();
    expect(panel.queryByRole('button', { name: /^Add/ })).toBeNull();
    expect(panel.queryByRole('button', { name: /^(Remove|Resolve|Perform|Cancel)/ })).toBeNull();
    expect(panel.queryByRole('button', { name: /^Occlusal/ })).toBeNull();
    expect(panel.getByRole('img', { name: /^Occlusal/ })).toBeTruthy();
    expect(panel.getByLabelText('Base price').hasAttribute('readonly')).toBe(true);
  });
});
