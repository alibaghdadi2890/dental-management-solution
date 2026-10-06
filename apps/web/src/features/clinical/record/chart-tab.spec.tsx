import type { PatientChart, Permission } from '@dcm/contracts';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALL_PERMISSIONS,
  DENTIST_ID,
  EMPTY_CHART,
  id,
  json,
  mockApi,
  profileId,
  renderRecord,
  sent,
} from '@/features/patients/patients.test-utils';
import {
  diagnosisRecord,
  OLDER_VISIT_ID,
  RANA,
  serviceItem,
  treatmentPlan,
} from '../workspace/workspace.test-utils';

const READER: Permission[] = [...ALL_PERMISSIONS, 'visit:read', 'catalog:read'];
const DENTIST: Permission[] = [...READER, 'visit:write', 'chart:write'];

const GROUP = { id: id(70), patientId: RANA.id, title: 'Phase 1', note: 'Upper right first' };

/** A caries on #16 from an earlier visit and one recorded on the record; a filling planned in a
 * visit, and a crown planned on the record inside the named plan. */
const CHART: PatientChart = {
  ...EMPTY_CHART,
  diagnoses: [
    diagnosisRecord(10, 'Dental caries', '16', { recordedInVisitId: OLDER_VISIT_ID }),
    diagnosisRecord(12, 'Fracture', '16', { recordedInVisitId: null }),
  ],
  plans: [
    treatmentPlan(20, 'Composite filling', '16', { recordedInVisitId: OLDER_VISIT_ID }),
    treatmentPlan(22, 'Zircon crown', '26', { recordedInVisitId: null, groupId: GROUP.id }),
  ],
  planGroups: [GROUP],
};

const SERVICES = [serviceItem(40, 'Root canal')];

function renderChartTab(permissions: Permission[], chart: PatientChart = CHART) {
  const state = { chart };
  const fetchMock = mockApi({
    patients: [RANA],
    get: (path) => {
      if (path === `/clinical/patients/${RANA.id}/chart`) return json(state.chart);
      if (path === '/catalog/services') return json(SERVICES);
      return undefined;
    },
    mutation: (method, path) =>
      path.startsWith(`/clinical/patients/${RANA.id}/`)
        ? json({ chart: state.chart }, method === 'POST' ? 201 : 200)
        : undefined,
  });
  renderRecord({ url: `/patients/${RANA.id}?tab=chart`, permissions });
  return { fetchMock, state };
}

const records = (rest: string) => `/clinical/patients/${RANA.id}/${rest}`;

describe('ChartTab', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('is the read-only chart without chart:write', async () => {
    renderChartTab(READER);
    await screen.findByRole('group', { name: 'Upper arch' });
    expect(screen.queryByRole('region', { name: 'Treatment plan' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Selected tooth' })).toBeNull();
  });

  it('with chart:write offers what needs no visit: no Perform, Resolve or Add service', async () => {
    renderChartTab(DENTIST);
    const board = await screen.findByRole('region', { name: 'Treatment plan' });
    expect(within(board).queryByRole('button', { name: /^Perform/ })).toBeNull();
    // A plan made in a visit is cancelled; one made on the record is removed.
    expect(within(board).getByRole('button', { name: 'Cancel Composite filling' })).toBeTruthy();
    expect(within(board).getByRole('button', { name: 'Remove Zircon crown' })).toBeTruthy();

    fireEvent.click(within(board).getByRole('button', { name: '#16' }));
    const panel = screen.getByRole('complementary', { name: 'Selected tooth' });
    expect(within(panel).queryByRole('button', { name: /^Resolve/ })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Remove Dental caries' })).toBeNull();
    expect(within(panel).getByRole('button', { name: 'Remove Fracture' })).toBeTruthy();
    expect(within(panel).queryByRole('button', { name: 'Add completed service' })).toBeNull();
    expect(within(panel).getByRole('button', { name: 'Add planned treatment' })).toBeTruthy();

    // A jaw is selected from the chart: its panel plans, and adds no service.
    fireEvent.click(screen.getByRole('button', { name: 'Upper jaw' }));
    const area = screen.getByRole('complementary', { name: 'Selected tooth' });
    expect(within(area).getByRole('heading', { name: 'Upper jaw' })).toBeTruthy();
    expect(within(area).getByRole('button', { name: 'Add planned treatment' })).toBeTruthy();
    expect(within(area).queryByRole('button', { name: 'Add completed service' })).toBeNull();
  });

  it('plans a treatment on the selected tooth for the chosen dentist', async () => {
    const { fetchMock } = renderChartTab(DENTIST);
    const board = await screen.findByRole('region', { name: 'Treatment plan' });
    // The session user is not a dentist, so the records name one.
    fireEvent.change(await screen.findByLabelText('Recording for'), {
      target: { value: profileId(DENTIST_ID) },
    });
    fireEvent.click(within(board).getByRole('button', { name: '#26' }));
    fireEvent.click(
      within(screen.getByRole('complementary', { name: 'Selected tooth' })).getByRole('button', {
        name: 'Add planned treatment',
      }),
    );
    const drawer = await screen.findByRole('dialog', { name: 'Add planned treatment' });
    fireEvent.click(await within(drawer).findByRole('button', { name: /^Root canal/ }));
    await waitFor(() => {
      expect(sent(fetchMock, 'POST', records('plans'))).toEqual({
        procedureId: id(40),
        toothCode: '26',
        surfaces: [],
        note: null,
        dentistId: profileId(DENTIST_ID),
      });
    });
    expect(await screen.findByText('Root canal planned')).toBeTruthy();
  });

  it('shows named plans with their estimate, moves a plan and creates a plan', async () => {
    const { fetchMock } = renderChartTab(DENTIST);
    const board = await screen.findByRole('region', { name: 'Treatment plan' });
    const named = board.querySelector<HTMLElement>(`[data-plan-group="${GROUP.id}"]`);
    if (!named) throw new Error('no named plan section');
    expect(within(named).getByRole('heading', { name: 'Phase 1' })).toBeTruthy();
    expect(within(named).getByText('Upper right first')).toBeTruthy();
    expect(within(named).getByText('Zircon crown')).toBeTruthy();
    expect(within(board).getByRole('heading', { name: 'Other planned treatment' })).toBeTruthy();

    fireEvent.change(within(board).getByLabelText('Named plan for Composite filling'), {
      target: { value: GROUP.id },
    });
    await waitFor(() => {
      expect(sent(fetchMock, 'PATCH', records(`plans/${id(20)}`))).toEqual({ groupId: GROUP.id });
    });

    fireEvent.click(within(board).getByRole('button', { name: 'New plan' }));
    const dialog = await screen.findByRole('dialog', { name: 'New named plan' });
    const create = within(dialog).getByRole('button', { name: 'Create plan' });
    expect((create as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: ' Phase 2 ' } });
    fireEvent.click(create);
    await waitFor(() => {
      expect(sent(fetchMock, 'POST', records('plan-groups'))).toEqual({
        title: 'Phase 2',
        note: null,
      });
    });
  });
});
