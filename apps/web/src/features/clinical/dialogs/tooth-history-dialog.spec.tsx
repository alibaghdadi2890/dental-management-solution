import type { Permission, ToothCode } from '@dcm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessionQueryOptions } from '@/features/auth/session';
import {
  ALL_PERMISSIONS,
  EMPTY_CHART,
  mockApi,
  type MockApi,
  problem,
  renderRecord,
  sessionWith,
} from '@/features/patients/patients.test-utils';
import {
  diagnosisRecord,
  historyLine,
  RANA,
  treatmentPlan,
  VISIT_ID,
} from '../workspace/workspace.test-utils';
import { ToothHistoryDialog } from './tooth-history-dialog';

const DENTIST: Permission[] = [...ALL_PERMISSIONS, 'visit:read', 'visit:write'];
const FRONT_DESK: Permission[] = [...ALL_PERMISSIONS, 'visit:read'];

/** Renders the record's Overview and opens the history of the tooth named `tooth` (the start of
 * its accessible name) from the Dental status card. */
async function openHistory(
  tooth: string,
  { permissions = DENTIST, ...api }: MockApi & { permissions?: Permission[] } = {},
) {
  mockApi({ patients: [RANA], ...api });
  const rendered = renderRecord({ url: `/patients/${RANA.id}`, permissions });
  // The loading record's skeleton cards carry the same titles.
  await screen.findByRole('heading', { level: 1 });
  const chart = screen.getByRole('region', { name: 'Dental status' });
  const button = await within(chart).findByRole('button', { name: new RegExp(`^${tooth} · `) });
  button.focus();
  fireEvent.click(button);
  return { ...rendered, button };
}

/** The dialog alone, open on `code`, for what the record page can't reach (a failed chart). */
function renderDialog(code: ToothCode) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(sessionQueryOptions().queryKey, sessionWith(DENTIST));
  const rootRoute = createRootRoute({
    component: () => (
      <ToothHistoryDialog
        patientId={RANA.id}
        patientName={RANA.fullName}
        code={code}
        onCodeChange={() => undefined}
        canStart
      />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('ToothHistoryDialog', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the three stages in order, each with its badges, dates and prices', async () => {
    await openHistory('#16', {
      toothHistories: {
        [RANA.id]: [
          {
            toothCode: '16',
            voidedVisitIds: [],
            presence: [],
            diagnoses: [
              diagnosisRecord(20, 'Dental caries', '16', {
                recordedDate: '2026-05-04',
                note: 'Deep occlusal lesion',
              }),
              diagnosisRecord(22, 'Gingivitis', '16', {
                status: 'resolved',
                recordedDate: '2025-03-12',
              }),
            ],
            plans: [
              // 02:30 on 5 May in the tenant's Asia/Beirut (UTC+3).
              treatmentPlan(30, 'Zircon crown', '16', { recordedAt: '2026-05-04T23:30:00.000Z' }),
              treatmentPlan(32, 'Composite filling', '16', {
                status: 'performed',
                price: { amount: '80.00', currency: 'USD' },
                recordedAt: '2025-03-12T09:06:00.000Z',
              }),
              treatmentPlan(34, 'Root canal', '16', {
                status: 'cancelled',
                recordedAt: '2025-03-12T09:06:00.000Z',
              }),
            ],
            services: [
              historyLine(40, 'Composite filling', '16', {
                surfaces: ['O', 'D'],
                final: { amount: '80.00', currency: 'USD' },
              }),
            ],
          },
        ],
      },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Tooth #16' });
    expect(within(dialog).getByText('Upper right first molar · Rana Haddad')).toBeTruthy();
    await within(dialog).findByText('Dental caries');

    expect(
      within(dialog)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent),
    ).toEqual(['Diagnosis', 'Treatment plan', 'Completed services']);

    const [diagnoses, plans, services] = within(dialog)
      .getAllByRole('list')
      .map((list) => within(list).getAllByRole('listitem'));
    expect(diagnoses?.map((item) => item.textContent)).toEqual([
      'Dental cariesActive4 May 2026Deep occlusal lesion',
      'GingivitisResolved12 Mar 2025Dr. Ana Reyes',
    ]);
    expect(plans?.map((item) => item.textContent)).toEqual([
      'Zircon crownPlanned5 May 2026$400',
      'Composite fillingPerformed12 Mar 2025$80',
      'Root canalCancelled12 Mar 2025$400',
    ]);
    expect(services?.map((item) => item.textContent)).toEqual([
      '12 Mar 2025Composite filling$80CompletedDr. Ana Reyes · Occlusal, Distal',
    ]);
  });

  it('offers "Chart it in this visit" while a visit is live, which selects the tooth there', async () => {
    const { router } = await openHistory('#16', {
      charts: { [RANA.id]: { ...EMPTY_CHART, liveVisitId: VISIT_ID } },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Tooth #16' });
    expect(await within(dialog).findByText('No treatment recorded for this tooth')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Start a visit' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Chart it in this visit' }));
    await screen.findByText(`Workspace ${VISIT_ID}`);
    expect(router.state.location.pathname).toBe(`/visits/${VISIT_ID}`);
    expect(router.state.location.search).toEqual({ tooth: '16' });
    expect(screen.queryByRole('dialog', { name: 'Tooth #16' })).toBeNull();
  });

  it('offers "Start a visit" without a live visit, and nothing to the front desk', async () => {
    await openHistory('#16');
    const dialog = await screen.findByRole('dialog', { name: 'Tooth #16' });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Start a visit' }));
    expect(await screen.findByRole('dialog', { name: 'Start visit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Chart it in this visit' })).toBeNull();

    cleanup();
    await openHistory('#16', {
      permissions: FRONT_DESK,
      charts: { [RANA.id]: { ...EMPTY_CHART, liveVisitId: VISIT_ID } },
    });
    const readOnly = await screen.findByRole('dialog', { name: 'Tooth #16' });
    expect(await within(readOnly).findByText('No treatment recorded for this tooth')).toBeTruthy();
    expect(within(readOnly).queryByRole('button', { name: /visit/ })).toBeNull();
  });

  it('switches to the other tooth of the position through the succession link', async () => {
    await openHistory('#54', {
      charts: {
        [RANA.id]: { ...EMPTY_CHART, dentition: { stage: 'primary', source: 'auto', ageYears: 4 } },
      },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Tooth #54' });
    expect(within(dialog).getByText('Primary')).toBeTruthy();
    expect(within(dialog).getByText('Permanent successor')).toBeTruthy();
    fireEvent.click(await within(dialog).findByRole('button', { name: '#14' }));

    const successor = await screen.findByRole('dialog', { name: 'Tooth #14' });
    expect(within(successor).getByText('Upper right first premolar · Rana Haddad')).toBeTruthy();
    expect(within(successor).getByText('Primary predecessor')).toBeTruthy();
    expect(within(successor).getByRole('button', { name: '#54' })).toBeTruthy();
  });

  it('offers "Chart it" for a tooth of either chart', async () => {
    await openHistory('#54', {
      charts: {
        [RANA.id]: {
          ...EMPTY_CHART,
          dentition: { stage: 'primary', source: 'auto', ageYears: 4 },
          liveVisitId: VISIT_ID,
        },
      },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Tooth #54' });
    expect(
      await within(dialog).findByRole('button', { name: 'Chart it in this visit' }),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: '#14' }));

    const successor = await screen.findByRole('dialog', { name: 'Tooth #14' });
    expect(
      await within(successor).findByRole('button', { name: 'Chart it in this visit' }),
    ).toBeTruthy();
  });

  it('says why nothing can be charted when the chart fails to load', async () => {
    mockApi({
      patients: [RANA],
      get: (path) => (path.endsWith('/chart') ? problem(500, 'internal') : undefined),
    });
    renderDialog('16');
    const dialog = await screen.findByRole('dialog', { name: 'Tooth #16' });
    expect(
      await within(dialog).findByText(
        'Couldn’t load the chart, so this tooth can’t be charted from here.',
      ),
    ).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: /visit/ })).toBeNull();
  });

  it('offers no "Start a visit" on an archived record', async () => {
    await openHistory('#16', {
      patients: [{ ...RANA, archivedAt: '2026-09-01T10:00:00.000Z' }],
    });
    const dialog = await screen.findByRole('dialog', { name: 'Tooth #16' });
    expect(await within(dialog).findByText('No treatment recorded for this tooth')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Start a visit' })).toBeNull();
  });

  it('names no predecessor in a permanent dentition when it has no records', async () => {
    await openHistory('#14');
    const dialog = await screen.findByRole('dialog', { name: 'Tooth #14' });
    await within(dialog).findByText('No treatment recorded for this tooth');
    expect(within(dialog).queryByText('Primary predecessor')).toBeNull();
  });

  it('closes on Esc and on Close, handing focus back to the tooth', async () => {
    const { button } = await openHistory('#16');
    const dialog = await screen.findByRole('dialog', { name: 'Tooth #16' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(document.activeElement).toBe(button);

    button.focus();
    fireEvent.click(button);
    const again = await screen.findByRole('dialog', { name: 'Tooth #16' });
    fireEvent.click(within(again).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});
