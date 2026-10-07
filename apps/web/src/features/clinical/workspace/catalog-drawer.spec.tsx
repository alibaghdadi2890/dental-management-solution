import type { DiagnosisItem, ServiceItem, SurfaceKey, ToothCode } from '@dcm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';
import { sessionQueryOptions } from '@/features/auth/session';
import { id, json, sessionWith } from '@/features/patients/patients.test-utils';
import { diagnosesQuery, servicesQuery } from '../catalog/catalog-api';
import { CatalogDrawer } from './catalog-drawer';
import { type ChartingActions, ChartingActionsContext, type DrawerMode } from './charting-actions';
import { type ChartArea, type ToothSelection, ToothSelectionContext } from './tooth-selection';
import {
  chart,
  DENTIST_WRITE,
  diagnosisItem,
  mockWorkspace,
  renderWorkspace,
  sent,
  serviceItem,
  visit,
  VISIT_ID,
  visitService,
} from './workspace.test-utils';

const SERVICES: ServiceItem[] = [
  serviceItem(40, 'Composite filling', { frequent: true }),
  serviceItem(41, 'Amalgam filling'),
  serviceItem(42, 'Scaling', { chargeUnit: 'per_mouth', category: 'Periodontal' }),
  serviceItem(46, 'Whitening', { chargeUnit: 'per_jaw', category: 'Periodontal' }),
  serviceItem(43, 'Retired crown', { active: false }),
];
const DIAGNOSES: DiagnosisItem[] = [
  diagnosisItem(44, 'Dental caries', { frequent: true }),
  diagnosisItem(45, 'Pulpitis', { category: 'Pulpal' }),
];

function actionsMock(): ChartingActions {
  return {
    scope: { kind: 'visit', visitId: VISIT_ID },
    addService: vi.fn(),
    planTreatment: vi.fn(),
    recordDiagnosis: vi.fn(),
    performPlan: vi.fn(),
    markUnfinished: vi.fn(),
    continuePlan: vi.fn(),
    undoSession: vi.fn(),
    removeUnfinished: vi.fn(),
    removeService: vi.fn(),
    removing: new Set(),
    saveServicePrice: vi.fn(),
    resolveDiagnosis: vi.fn(),
    reopenDiagnosis: vi.fn(),
    removeDiagnosis: vi.fn(),
    removePlan: vi.fn(),
    cancelPlan: vi.fn(),
    setPresence: vi.fn(),
  };
}

/** The drawer alone, over a seeded catalog, a selection and mocked actions. */
function renderDrawer(
  mode: DrawerMode,
  {
    tooth = null,
    surfaces = [],
    area = null,
  }: { tooth?: ToothCode | null; surfaces?: SurfaceKey[]; area?: ChartArea | null } = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
  client.setQueryData(sessionQueryOptions().queryKey, sessionWith(DENTIST_WRITE));
  client.setQueryData(servicesQuery().queryKey, SERVICES);
  client.setQueryData(diagnosesQuery().queryKey, DIAGNOSES);
  const selection: ToothSelection = {
    tooth,
    area,
    surfaces,
    select: vi.fn(),
    selectArea: vi.fn(),
    ensureSelected: vi.fn(),
    toggleSurface: vi.fn(),
  };
  const actions = actionsMock();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <ToothSelectionContext.Provider value={selection}>
        <ChartingActionsContext.Provider value={actions}>
          <CatalogDrawer mode={mode} onClose={onClose} />
        </ChartingActionsContext.Provider>
      </ToothSelectionContext.Provider>
    </QueryClientProvider>,
  );
  return { selection, actions, onClose };
}

const row = (name: RegExp) => screen.getAllByRole('button', { name })[0] as HTMLButtonElement;

describe('CatalogDrawer', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each([
    ['service', 'Add completed service', 'Search services…'],
    ['plan', 'Add planned treatment', 'Search treatments to plan…'],
    ['diagnosis', 'Add diagnosis', 'Search diagnoses…'],
  ] as const)('%s mode: its title and autofocused search', (mode, title, placeholder) => {
    renderDrawer(mode, { tooth: '16' });
    expect(screen.getByRole('dialog', { name: title })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByPlaceholderText(placeholder));
  });

  it('names the target: the tooth, its name and the pending surfaces', () => {
    renderDrawer('service', { tooth: '16', surfaces: ['O', 'D'] });
    expect(screen.getByText('Tooth #16 · Upper right first molar · O · D')).toBeTruthy();
    expect(within(row(/^Composite filling/)).getByText('Applies to #16 · O · D')).toBeTruthy();
  });

  it('lists Frequently used, then the categories; hides inactive rows', () => {
    renderDrawer('service', { tooth: '16' });
    const headings = screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent);
    expect(headings).toEqual(['Frequently used', 'Restorative', 'Periodontal']);
    expect(screen.queryByText('Retired crown')).toBeNull();
    expect(screen.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('a query shows one group of matches; nothing matching shows the copy', () => {
    renderDrawer('service', { tooth: '16' });
    const search = screen.getByPlaceholderText('Search services…');
    fireEvent.change(search, { target: { value: 'fill' } });
    expect(screen.getByRole('heading', { name: '2 matches' })).toBeTruthy();

    fireEvent.change(search, { target: { value: 'veneer' } });
    expect(screen.getByText('Nothing matches “veneer”')).toBeTruthy();
    expect(screen.getByText('Check the spelling, or clear the category filter.')).toBeTruthy();
  });

  it('a category chip narrows the list to that category', () => {
    renderDrawer('service', { tooth: '16' });
    fireEvent.click(screen.getByRole('button', { name: 'Periodontal' }));
    const headings = screen.getAllByRole('heading', { level: 3 }).map((node) => node.textContent);
    expect(headings).toEqual(['Periodontal']);
    expect(screen.queryByText('Composite filling')).toBeNull();
  });

  it('without a tooth, whole-mouth rows are allowed and per-tooth rows disabled', () => {
    const { actions, onClose } = renderDrawer('service');
    expect(screen.getByText('No tooth selected')).toBeTruthy();
    expect(row(/^Composite filling/).disabled).toBe(true);
    expect(within(row(/^Composite filling/)).getByText('Per tooth')).toBeTruthy();
    const scaling = row(/^Scaling/);
    expect(scaling.disabled).toBe(false);
    expect(within(scaling).getByText('Whole mouth')).toBeTruthy();

    fireEvent.click(scaling);
    expect(actions.addService).toHaveBeenCalledWith(SERVICES[2], {
      tooth: null,
      surfaces: [],
      jaw: undefined,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('a per-jaw row commits on its Upper or Lower button, in either mode', () => {
    const { actions, onClose } = renderDrawer('plan', { tooth: '16' });
    expect(screen.queryByRole('button', { name: /^Whitening/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add Whitening to the Upper jaw' }));
    expect(actions.planTreatment).toHaveBeenCalledWith(SERVICES[3], {
      tooth: '16',
      surfaces: [],
      jaw: 'upper',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('with a jaw selected lists the per-jaw services and commits on that jaw in one click', () => {
    const { actions } = renderDrawer('service', { area: 'lower' });
    expect(screen.getByText('Lower jaw')).toBeTruthy();
    expect(screen.queryByText('Composite filling')).toBeNull();
    expect(screen.queryByText('Scaling')).toBeNull();
    fireEvent.click(row(/^Whitening/));
    expect(actions.addService).toHaveBeenCalledWith(SERVICES[3], {
      tooth: null,
      surfaces: [],
      jaw: 'lower',
    });
  });

  it('with the whole mouth selected lists the whole-mouth services only', () => {
    renderDrawer('plan', { area: 'mouth' });
    expect(screen.getByText('Whole mouth', { selector: 'p' })).toBeTruthy();
    expect(screen.getByText('Scaling')).toBeTruthy();
    expect(screen.queryByText('Whitening')).toBeNull();
    expect(screen.queryByText('Composite filling')).toBeNull();
  });

  it('a diagnosis needs a tooth', () => {
    renderDrawer('diagnosis');
    expect(screen.getByText('No tooth selected')).toBeTruthy();
    expect(row(/^Dental caries/).disabled).toBe(true);
    expect(row(/^Pulpitis/).disabled).toBe(true);
  });

  it('one click commits with the target and closes; the pending scope clears', () => {
    const { actions, selection, onClose } = renderDrawer('plan', {
      tooth: '16',
      surfaces: ['O'],
    });
    fireEvent.click(row(/^Amalgam filling/));
    expect(actions.planTreatment).toHaveBeenCalledWith(SERVICES[1], {
      tooth: '16',
      surfaces: ['O'],
    });
    expect(selection.select).toHaveBeenCalledWith('16');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a diagnosis keeps the pending scope for the plan that follows', () => {
    const { actions, selection } = renderDrawer('diagnosis', { tooth: '16', surfaces: ['O'] });
    fireEvent.click(row(/^Pulpitis/));
    expect(actions.recordDiagnosis).toHaveBeenCalledWith(DIAGNOSES[1], {
      tooth: '16',
      surfaces: ['O'],
    });
    expect(selection.select).not.toHaveBeenCalled();
  });
});

describe('CatalogDrawer — in the workspace', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  async function openFor(tooth: RegExp, add: string) {
    await screen.findByRole('group', { name: 'Upper arch' });
    const card = screen.getByRole('region', { name: 'Dental chart' });
    fireEvent.click(within(card).getByRole('button', { name: tooth }));
    fireEvent.click(await screen.findByRole('button', { name: add }));
  }

  it('diagnosis toast → Plan treatment; service toast → Undo deletes the service', async () => {
    const state = { visit: visit(), chart: chart() };
    const record = {
      id: id(46),
      patientId: state.visit.patientId,
      toothCode: '16',
      surfaces: [],
      diagnosisId: id(44),
      code: 'DENT',
      name: 'Dental caries',
      category: 'Caries',
      status: 'active',
      note: null,
      dentistId: state.visit.dentistId,
      dentistName: 'Dr. Ana Reyes',
      recordedBy: state.visit.startedBy,
      recordedInVisitId: VISIT_ID,
      recordedDate: '2026-09-04',
      recordedAt: '2026-09-04T09:05:00.000Z',
      resolvedInVisitId: null,
      resolvedAt: null,
    };
    const added = visitService(47, 'Scaling', null);
    const fetchMock = mockWorkspace({
      visit: () => state.visit,
      chart: () => state.chart,
      diagnoses: DIAGNOSES,
      services: SERVICES,
      mutation: (method, path) => {
        if (method === 'POST' && path.endsWith('/diagnoses')) {
          return json({ visit: state.visit, record });
        }
        if (method === 'POST' && path.endsWith('/services')) {
          state.visit = { ...state.visit, services: [added] };
          return json({ visit: state.visit, record: added });
        }
        if (method === 'DELETE' && path.endsWith(`/services/${added.id}`)) {
          state.visit = { ...state.visit, services: [] };
          return json({ visit: state.visit, record: added });
        }
        return undefined;
      },
    });
    renderWorkspace();
    await openFor(/^#16 · /, 'Add diagnosis');
    fireEvent.click((await screen.findAllByRole('button', { name: /^Dental caries/ }))[0]!);
    expect(await screen.findByText('Dental caries recorded')).toBeTruthy();
    expect(screen.getByText('Tooth #16')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Plan treatment' }));
    const planDrawer = await screen.findByRole('dialog', { name: 'Add planned treatment' });
    expect(within(planDrawer).getByText('Tooth #16 · Upper right first molar')).toBeTruthy();
    fireEvent.click(within(planDrawer).getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByRole('button', { name: 'Add completed service' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Scaling/ }));
    expect(await screen.findByText('Scaling added')).toBeTruthy();
    expect(screen.getAllByText('Whole mouth').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(sent(fetchMock, 'DELETE', `/visits/${VISIT_ID}/services/${added.id}`)).toBeNull();
    });
  });

  it('is modal: the arrows can’t move the selection under it, and Tab stays inside', async () => {
    mockWorkspace({ services: SERVICES });
    renderWorkspace();
    await openFor(/^#16 · /, 'Add completed service');
    const drawer = await screen.findByRole('dialog', { name: 'Add completed service' });
    const chip = await within(drawer).findByRole('button', { name: 'Periodontal' });
    chip.focus();
    fireEvent.keyDown(chip, { key: 'ArrowLeft' });
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    const card = screen.getByRole('region', { name: 'Dental chart' });
    expect(
      within(card)
        .getByRole('button', { name: /^#16 · / })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    expect(within(drawer).getByText('Tooth #16 · Upper right first molar')).toBeTruthy();

    const last = within(drawer).getByRole('button', { name: 'Add Whitening to the Lower jaw' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(drawer.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(within(drawer).getByRole('button', { name: 'Close' }));
  });

  it('Plan treatment plans on the diagnosed tooth, even after the selection moved', async () => {
    const current = visit();
    const record = {
      id: id(46),
      patientId: current.patientId,
      toothCode: '16',
      surfaces: [],
      diagnosisId: id(44),
      code: 'DENT',
      name: 'Dental caries',
      category: 'Caries',
      status: 'active',
      note: null,
      dentistId: current.dentistId,
      dentistName: 'Dr. Ana Reyes',
      recordedBy: current.startedBy,
      recordedInVisitId: VISIT_ID,
      recordedDate: '2026-09-04',
      recordedAt: '2026-09-04T09:05:00.000Z',
      resolvedInVisitId: null,
      resolvedAt: null,
    };
    mockWorkspace({
      visit: current,
      diagnoses: DIAGNOSES,
      services: SERVICES,
      mutation: (method, path) =>
        method === 'POST' && path.endsWith('/diagnoses')
          ? json({ visit: current, record })
          : undefined,
    });
    renderWorkspace();
    await openFor(/^#16 · /, 'Add diagnosis');
    fireEvent.click((await screen.findAllByRole('button', { name: /^Dental caries/ }))[0]!);
    expect(await screen.findByText('Dental caries recorded')).toBeTruthy();

    const card = screen.getByRole('region', { name: 'Dental chart' });
    fireEvent.click(within(card).getByRole('button', { name: /^#17 · / }));
    fireEvent.click(screen.getByRole('button', { name: 'Plan treatment' }));
    const drawer = await screen.findByRole('dialog', { name: 'Add planned treatment' });
    expect(within(drawer).getByText('Tooth #16 · Upper right first molar')).toBeTruthy();
    expect(
      within(card)
        .getByRole('button', { name: /^#16 · / })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
