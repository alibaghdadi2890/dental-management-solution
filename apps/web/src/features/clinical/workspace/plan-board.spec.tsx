import type { PatientChart, ToothCode, Visit } from '@dcm/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessionQueryOptions } from '@/features/auth/session';
import { id, json, sessionWith } from '@/features/patients/patients.test-utils';
import {
  chart,
  DENTIST_WRITE,
  diagnosisRecord,
  FRONT_DESK,
  mockWorkspace,
  OLDER_VISIT_ID,
  renderWorkspace,
  sent,
  treatmentPlan,
  visit,
  VISIT_ID,
  visitService,
} from './workspace.test-utils';

const usd = (amount: string) => ({ amount, currency: 'USD' });

/** Open plans on #26, #16 (two), primary #55 and one jaw-level, plus a performed and a cancelled
 * one that the board leaves out. */
const PLANS = [
  treatmentPlan(20, 'Root canal', '26', { recordedInVisitId: OLDER_VISIT_ID }),
  treatmentPlan(22, 'Scaling', null, { price: usd('60.00') }),
  treatmentPlan(24, 'Zircon crown', '16', { surfaces: ['O', 'D'] }),
  treatmentPlan(26, 'Composite filling', '16', { price: usd('90.00') }),
  treatmentPlan(28, 'Pulpotomy', '55', { price: usd('50.00') }),
  treatmentPlan(30, 'Sealant', '11', { status: 'performed', performedInVisitId: OLDER_VISIT_ID }),
  treatmentPlan(32, 'Veneer', '21', { status: 'cancelled', cancelledInVisitId: OLDER_VISIT_ID }),
];

/** A fake server holding the visit and the chart; Perform moves a plan into the visit. */
function fakeClinic(initial: PatientChart) {
  const state: { visit: Visit; chart: PatientChart } = { visit: visit(), chart: initial };
  const fetchMock = mockWorkspace({
    visit: () => state.visit,
    chart: () => state.chart,
    mutation: (method, path) => {
      const planId = /\/plans\/([^/]+)\/perform$/.exec(path)?.[1];
      const plan = state.chart.plans.find((row) => row.id === planId);
      if (method !== 'POST' || !plan) return undefined;
      const performed = { ...plan, status: 'performed' as const, performedInVisitId: VISIT_ID };
      state.chart = {
        ...state.chart,
        plans: state.chart.plans.map((row) => (row.id === plan.id ? performed : row)),
      };
      const service = visitService(50, plan.name, plan.toothCode, { planId: plan.id });
      state.visit = { ...state.visit, services: [...state.visit.services, service] };
      return json({ visit: state.visit, record: performed });
    },
  });
  return { state, fetchMock };
}

/** The board, once the chart has loaded. */
const board = async () => {
  await screen.findByRole('group', { name: 'Upper arch' });
  return screen.getByRole('region', { name: 'Treatment plan' });
};

describe('PlanBoard', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('groups the open plans by tooth in numbering order, jaw-level last', async () => {
    fakeClinic(
      chart({
        plans: PLANS,
        diagnoses: [
          diagnosisRecord(40, 'Dental caries', '16'),
          diagnosisRecord(42, 'Old fracture', '16', { status: 'resolved' }),
          diagnosisRecord(44, 'Deep caries', '55'),
        ],
      }),
    );
    renderWorkspace();
    const card = await board();

    const groups = [...card.querySelectorAll<HTMLElement>('[data-tooth]')];
    expect(groups.map((group) => group.dataset.tooth)).toEqual(['16', '26', '55', 'jaw']);
    expect(within(card).getByText('Future work · not billed until performed')).toBeTruthy();
    expect(within(card).getByText('3 teeth · 5 procedures')).toBeTruthy();

    const [tooth16, tooth26, , jaw] = groups.map((group) => within(group));
    expect(tooth16?.getByRole('button', { name: '#16' })).toBeTruthy();
    expect(tooth16?.getByText('Upper right first molar')).toBeTruthy();
    // Active diagnoses only, in danger.
    expect(tooth16?.getByText('Dental caries').className).toContain('text-danger');
    expect(tooth16?.queryByText(/Old fracture/)).toBeNull();
    expect(tooth16?.getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      'Zircon crownO · D$400Perform now→ today',
      'Composite filling$90Perform now→ today',
    ]);
    expect(tooth26?.getByText('No diagnosis recorded').className).toContain('text-ink-muted');
    expect(jaw?.getByText('Jaw')).toBeTruthy();
    expect(jaw?.queryByRole('button', { name: 'Jaw' })).toBeNull();
    expect(jaw?.getByText('Jaw-level')).toBeTruthy();

    // Performed and cancelled plans are not on the board; the estimate sums the open ones.
    expect(within(card).queryByText('Sealant')).toBeNull();
    expect(within(card).queryByText('Veneer')).toBeNull();
    expect(within(card).getByText('Plan estimate')).toBeTruthy();
    expect(within(card).getByText('$1,000')).toBeTruthy();
  });

  it('orders by the Universal numbers when the clinic uses them', async () => {
    fakeClinic(
      chart({
        plans: (['11', '16', '31', '38', '51', '55', null] as (ToothCode | null)[]).map(
          (tooth, index) => treatmentPlan(60 + index * 2, `Plan ${String(index)}`, tooth),
        ),
      }),
    );
    const { client } = renderWorkspace();
    const session = sessionWith(DENTIST_WRITE);
    if (!session.tenant) throw new Error('no tenant');
    client.setQueryData(sessionQueryOptions().queryKey, {
      ...session,
      tenant: { ...session.tenant, toothNotation: 'universal' },
    });
    const card = await board();
    await waitFor(() => {
      expect(within(card).getByRole('button', { name: '#3' })).toBeTruthy();
    });
    const groups = [...card.querySelectorAll<HTMLElement>('[data-tooth]')];
    // #3 (16), #8 (11), #17 (38), #24 (31), then primary A (55), E (51), then the jaw.
    expect(groups.map((group) => group.dataset.tooth)).toEqual([
      '16',
      '11',
      '38',
      '31',
      '55',
      '51',
      'jaw',
    ]);
  });

  it('selects a tooth from its column', async () => {
    fakeClinic(chart({ plans: PLANS }));
    renderWorkspace();
    const card = await board();
    fireEvent.click(within(card).getByRole('button', { name: '#26' }));
    const aside = screen.getByRole('complementary', { name: 'Selected tooth' });
    expect(within(aside).getByRole('heading', { name: '#26' })).toBeTruthy();
  });

  it('Perform now performs the plan through the tooth panel’s action, with its Undo toast', async () => {
    const { fetchMock } = fakeClinic(chart({ plans: PLANS }));
    renderWorkspace();
    const card = await board();

    fireEvent.click(within(card).getByRole('button', { name: 'Perform now: Root canal' }));
    expect(await screen.findByText('Root canal performed')).toBeTruthy();
    expect(sent(fetchMock, 'POST', `/visits/${VISIT_ID}/plans/${id(20)}/perform`)).toBeNull();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
    await waitFor(() => {
      expect(within(card).queryByText('Root canal')).toBeNull();
    });
    expect(within(card).getByText('2 teeth · 4 procedures')).toBeTruthy();
  });

  it('says nothing is planned yet', async () => {
    fakeClinic(
      chart({
        plans: [
          treatmentPlan(30, 'Sealant', '11', {
            status: 'performed',
            performedInVisitId: OLDER_VISIT_ID,
          }),
        ],
      }),
    );
    renderWorkspace();
    const card = await board();
    expect(within(card).getByText('Nothing planned yet')).toBeTruthy();
    expect(
      within(card).getByText(
        'Select a tooth, record what you found, then plan the treatment. You can complete this visit as an examination without billing anything.',
      ),
    ).toBeTruthy();
    expect(within(card).queryByText('Plan estimate')).toBeNull();
  });

  it('is read-only for front desk: no Perform now, the tooth link still selects', async () => {
    fakeClinic(chart({ plans: PLANS }));
    renderWorkspace({ permissions: FRONT_DESK });
    const card = await board();
    expect(within(card).queryByRole('button', { name: /^Perform/ })).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: '#16' }));
    const aside = screen.getByRole('complementary', { name: 'Selected tooth' });
    expect(within(aside).getByRole('heading', { name: '#16' })).toBeTruthy();
  });
});
