import type { AlertTray, Permission, Practitioner, Session } from '@dcm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useParams,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';
import { ToastProvider } from '@/components/ui/toast';
import { sessionQueryOptions } from '@/features/auth/session';
import { id, json, problem, sessionWith } from '@/features/patients/patients.test-utils';
import { PatientsTray } from './patients-tray';
import { seenKey } from './use-alerts';

const REYES = id(81);
const LEE = id(82);
const DENTISTS: Practitioner[] = [
  { id: REYES, userId: id(83), displayName: 'Dr. Reyes', title: null },
  { id: LEE, userId: id(84), displayName: 'Dr. Lee', title: null },
];
const RUN: Permission[] = ['visit:read', 'visit:start', 'visit:write', 'appointment:read'];

const TRAY: AlertTray = {
  waiting: [
    {
      appointmentId: id(11),
      patientId: id(21),
      patientName: 'Omar Farouk',
      dentistId: REYES,
      dentistName: 'Dr. Reyes',
      roomName: null,
      startsAt: '2026-11-03T08:00:00.000Z',
      checkedInAt: '2026-11-03T07:55:00.000Z',
    },
  ],
  inRoom: [
    {
      visitId: id(12),
      patientId: id(22),
      patientName: 'Sofia Mendes',
      dentistId: REYES,
      dentistName: 'Dr. Reyes',
      roomName: 'Room 1',
      status: 'in_progress',
      startedAt: '2026-11-03T08:01:00.000Z',
      pausedAt: null,
      pausedSeconds: 0,
      startedBy: id(85),
      startedByName: 'Jamie',
    },
  ],
  follows: [],
  serverNow: '2026-11-03T08:05:00.000Z',
};

class FakeEventSource {
  addEventListener() {}
  close() {}
}

function mockApi(tray: AlertTray) {
  const fetchMock = vi.fn((url: string) => {
    const path = url.replace('/api/v1', '');
    if (path === '/alerts/tray') return Promise.resolve(json(tray));
    if (path === '/users/practitioners') return Promise.resolve(json(DENTISTS));
    return Promise.resolve(problem(404, 'not_found'));
  });
  vi.stubGlobal('fetch', fetchMock);
}

function renderTray(session: Session) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(sessionQueryOptions().queryKey, session);
  const rootRoute = createRootRoute({ component: Outlet });
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: '/', component: PatientsTray }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/visits/$visitId',
      component: function Workspace() {
        const { visitId } = useParams({ strict: false });
        return <p>{`Workspace ${visitId ?? ''}`}</p>;
      },
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/schedule',
      validateSearch: (search: Record<string, unknown>) => search,
      component: () => <p>{'Schedule'}</p>,
    }),
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return router;
}

const reyesSession = (permissions = RUN): Session => ({
  ...sessionWith(permissions),
  profile: { id: REYES, practitionerType: 'dentist', specialties: [], primarySpecialty: null },
});

describe('PatientsTray', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource);
    localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('lists who is in a room and who is waiting, each one click from its screen', async () => {
    mockApi(TRAY);
    const router = renderTray(reyesSession());
    fireEvent.click(await screen.findByRole('button', { name: 'Your patients: 2' }));
    const list = await screen.findByRole('dialog', { name: 'Your patients' });
    const inRoom = within(list).getByRole('region', { name: 'In room' });
    expect(within(inRoom).getByText('Room 1 · Dr. Reyes · started by Jamie')).toBeTruthy();
    expect(within(list).getByRole('region', { name: 'Waiting' })).toBeTruthy();
    // A dentist without visit:read_all follows nobody else: no checklist.
    expect(within(list).queryByText('Also alert me for')).toBeNull();

    fireEvent.click(within(inRoom).getByRole('button', { name: /Sofia Mendes/ }));
    await screen.findByText(`Workspace ${id(12)}`);
    expect(router.state.location.pathname).toBe(`/visits/${id(12)}`);
  });

  it('marks what is new since the list was last opened, then not', async () => {
    mockApi(TRAY);
    renderTray(reyesSession());
    fireEvent.click(await screen.findByRole('button', { name: 'Your patients: 2' }));
    const list = await screen.findByRole('dialog', { name: 'Your patients' });
    expect(within(list).getAllByText('New')).toHaveLength(2);
    fireEvent.keyDown(list, { key: 'Escape' });
    fireEvent.click(await screen.findByRole('button', { name: 'Your patients: 2' }));
    const again = await screen.findByRole('dialog', { name: 'Your patients' });
    expect(within(again).queryByText('New')).toBeNull();
  });

  it('alerts with a toast for a patient this browser has not seen', async () => {
    localStorage.setItem(seenKey(sessionWith(RUN).user.id), JSON.stringify([`started:${id(12)}`]));
    mockApi(TRAY);
    renderTray(reyesSession());
    const toast = await screen.findByText('Omar Farouk arrived');
    expect(toast).toBeTruthy();
    expect(screen.queryByText('Sofia Mendes is in Room 1')).toBeNull();
  });

  it('offers who reads every visit the dentists to follow, and nothing to the front desk', async () => {
    mockApi({ ...TRAY, waiting: [], inRoom: [] });
    renderTray(sessionWith([...RUN, 'visit:read_all']));
    fireEvent.click(await screen.findByRole('button', { name: 'Your patients: 0' }));
    const list = await screen.findByRole('dialog', { name: 'Your patients' });
    expect(await within(list).findByRole('checkbox', { name: 'Dr. Lee' })).toBeTruthy();
    expect(within(list).getByText(/dentists you follow show here too/)).toBeTruthy();
    cleanup();

    mockApi(TRAY);
    renderTray(sessionWith(['visit:read', 'visit:start', 'visit:read_all']));
    await screen.findByText('Schedule', {}, { timeout: 50 }).catch(() => undefined);
    expect(screen.queryByRole('button', { name: /Your patients/ })).toBeNull();
  });
});
