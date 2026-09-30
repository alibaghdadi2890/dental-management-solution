import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { id, problem } from '@/features/patients/patients.test-utils';
import {
  chart,
  FRONT_DESK,
  mockWorkspace,
  RANA,
  renderWorkspace,
  sent,
  visit,
  VISIT_ID,
} from './workspace.test-utils';

const header = async () => {
  await screen.findByRole('link', { name: /Rana Haddad/ });
  return screen.getByRole('banner');
};

const timerChip = () => screen.getByRole('timer', { name: 'Visit time' });

describe('VisitHeader', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shows the patient chip linking to the record, the alerts, the status, date and dentist', async () => {
    // The visit's own day, so the age line doesn't drift with the calendar.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-09-04T09:12:05.000Z') });
    mockWorkspace();
    const { router } = renderWorkspace();
    const banner = await header();
    expect(within(banner).getByText('P-000001 · 8 yrs · 1 Mar 2018')).toBeTruthy();
    const alerts = within(banner).getByRole('list', { name: 'Medical alerts' });
    expect(within(alerts).getByText('Penicillin allergy')).toBeTruthy();
    expect(within(banner).getByText('In progress')).toBeTruthy();
    expect(await within(banner).findByText('4 Sep 2026 · Dr. Ana Reyes')).toBeTruthy();
    expect(timerChip().textContent).toBe('12:05');

    fireEvent.click(within(banner).getByRole('link', { name: /Rana Haddad/ }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/patients/${RANA.id}`);
    });
  });

  it('pauses: the chip turns static and Resume resumes it', async () => {
    const fetchMock = mockWorkspace();
    renderWorkspace();
    await header();
    expect(timerChip().dataset.state).toBe('running');
    expect(timerChip().className).toContain('bg-primary-tint');

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await screen.findByRole('button', { name: 'Resume' });
    expect(sent(fetchMock, 'POST', `/visits/${VISIT_ID}/pause`)).toBeNull();
    expect(screen.getByText('Paused')).toBeTruthy();
    expect(timerChip().dataset.state).toBe('paused');
    expect(timerChip().className).toContain('bg-subtle');
    expect(timerChip().className).not.toContain('bg-primary-tint');

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    await screen.findByRole('button', { name: 'Pause' });
    expect(sent(fetchMock, 'POST', `/visits/${VISIT_ID}/resume`)).toBeNull();
    expect(timerChip().dataset.state).toBe('running');
  });

  it('opens a visit paused elsewhere as paused, with Resume and a frozen timer', async () => {
    const fetchMock = mockWorkspace({
      visit: visit({ status: 'paused', pausedAt: '2026-09-04T09:10:00.000Z', pausedSeconds: 60 }),
    });
    renderWorkspace();
    const banner = await header();
    expect(within(banner).getByText('Paused')).toBeTruthy();
    expect(within(banner).queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(timerChip().dataset.state).toBe('paused');
    // Ten minutes from the start to the pause, less the minute already paused.
    expect(timerChip().textContent).toBe('09:00');

    fireEvent.click(within(banner).getByRole('button', { name: 'Resume' }));
    await screen.findByRole('button', { name: 'Pause' });
    expect(sent(fetchMock, 'POST', `/visits/${VISIT_ID}/resume`)).toBeNull();
  });

  it('offers Discard visit while the visit is empty; confirming returns to the record', async () => {
    const fetchMock = mockWorkspace();
    const { router } = renderWorkspace();
    await header();
    fireEvent.pointerDown(await screen.findByRole('button', { name: 'Visit actions' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Discard visit' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard this visit?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard visit' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/patients/${RANA.id}`);
    });
    expect(sent(fetchMock, 'POST', `/visits/${VISIT_ID}/discard`)).toBeNull();
    expect(await screen.findByText('Visit discarded')).toBeTruthy();
  });

  it.each([
    ['a service', { visit: visit({ services: [serviceRow()] }) }],
    ['notes', { visit: visit({ notes: 'Checked the fissures.' }) }],
    ['a diagnosis recorded in it', { chart: chart({ diagnoses: [diagnosisRow(VISIT_ID)] }) }],
    [
      'a plan performed in it',
      { chart: chart({ plans: [planRow({ performedInVisitId: VISIT_ID })] }) },
    ],
  ])('offers no Discard once the visit has %s', async (_, api) => {
    mockWorkspace(api);
    renderWorkspace();
    await header();
    await screen.findByRole('button', { name: 'Pause' });
    await screen.findByRole('group', { name: 'Upper arch' });
    expect(screen.queryByRole('button', { name: 'Visit actions' })).toBeNull();
  });

  it("keeps an older visit's records from blocking the discard", async () => {
    mockWorkspace({ chart: chart({ diagnoses: [diagnosisRow(id(61))] }) });
    renderWorkspace();
    await header();
    expect(await screen.findByRole('button', { name: 'Visit actions' })).toBeTruthy();
  });

  it("shows the server's refusal inside the dialog when the visit isn't empty after all", async () => {
    mockWorkspace({
      mutation: (method, path) =>
        method === 'POST' && path.endsWith('/discard')
          ? problem(409, 'visit.not_empty')
          : undefined,
    });
    const { router } = renderWorkspace();
    await header();
    fireEvent.pointerDown(await screen.findByRole('button', { name: 'Visit actions' }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Discard visit' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard visit' }));
    expect(
      await within(dialog).findByText(
        "Something was recorded in this visit, so it can't be discarded. Complete it instead.",
      ),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/visits/${VISIT_ID}`);
  });

  it('shows front desk no Pause, no menu, and says the visit is view-only', async () => {
    mockWorkspace();
    renderWorkspace({ permissions: FRONT_DESK });
    const banner = await header();
    expect(within(banner).getByText('View only')).toBeTruthy();
    expect(within(banner).queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(within(banner).queryByRole('button', { name: 'Visit actions' })).toBeNull();
    expect(timerChip()).toBeTruthy();
  });
});

function serviceRow() {
  return {
    id: id(62),
    procedureId: id(63),
    code: 'CGIC',
    name: 'Glass ionomer filling',
    category: null,
    chargeUnit: 'per_tooth' as const,
    toothCode: '16' as const,
    surfaces: [],
    base: { amount: '40.00', currency: 'USD' },
    discount: { amount: '0.00', currency: 'USD' },
    final: { amount: '40.00', currency: 'USD' },
    planId: null,
    recordedBy: id(80),
    createdAt: '2026-09-04T09:05:00.000Z',
  };
}

function diagnosisRow(visitId: string) {
  return {
    id: id(64),
    patientId: RANA.id,
    toothCode: '16' as const,
    surfaces: [],
    diagnosisId: id(65),
    code: 'K02',
    name: 'Dental caries',
    category: null,
    status: 'active' as const,
    note: null,
    dentistId: id(66),
    dentistName: 'Dr. Ana Reyes',
    recordedBy: id(80),
    recordedInVisitId: visitId,
    recordedInVisitDate: '2026-09-04',
    recordedAt: '2026-09-04T09:05:00.000Z',
    resolvedInVisitId: null,
    resolvedAt: null,
  };
}

function planRow(extra: { performedInVisitId: string }) {
  return {
    id: id(67),
    patientId: RANA.id,
    toothCode: '16' as const,
    surfaces: [],
    procedureId: id(63),
    code: 'CGIC',
    name: 'Glass ionomer filling',
    category: null,
    chargeUnit: 'per_tooth' as const,
    price: { amount: '40.00', currency: 'USD' },
    diagnosisRecordId: null,
    status: 'performed' as const,
    note: null,
    dentistId: id(66),
    dentistName: 'Dr. Ana Reyes',
    recordedBy: id(80),
    recordedInVisitId: id(61),
    recordedAt: '2026-08-01T09:05:00.000Z',
    performedAt: '2026-09-04T09:06:00.000Z',
    cancelledInVisitId: null,
    cancelledAt: null,
    ...extra,
  };
}
