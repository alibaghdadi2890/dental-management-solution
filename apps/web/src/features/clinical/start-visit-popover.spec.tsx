import type { Permission, Practitioner, Room, Session, StartDefaults } from '@dcm/contracts';
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
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { ToastProvider } from '@/components/ui/toast';
import { sessionQueryOptions } from '@/features/auth/session';
import {
  DENTIST_ID,
  id,
  json,
  problem,
  profileId,
  sessionWith,
} from '@/features/patients/patients.test-utils';
import { BRANCH, startedVisit } from './start-visit.test-utils';
import { StartVisitPopover } from './start-visit-popover';

const PATIENT_ID = id(1);
const ANA = profileId(DENTIST_ID);
const MARCUS = profileId(id(83));
const WRITE: Permission[] = ['patient:read', 'visit:read', 'visit:write'];

const room = (n: number, name: string, active = true): Room => ({
  id: id(n),
  branchId: BRANCH.id,
  name,
  code: null,
  active,
});
const ROOMS = [room(71, 'Room 1'), room(72, 'Room 2'), room(73, 'Old room', false)];
const DENTISTS: Practitioner[] = [
  { id: ANA, userId: DENTIST_ID, displayName: 'Dr. Ana Reyes', title: null },
  { id: MARCUS, userId: id(83), displayName: 'Dr. Marcus Lee', title: null },
];

type FetchMock = ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;

function mockStart({
  defaults = { dentistId: ANA, roomId: id(72) },
  rooms = ROOMS,
  dentists = () => DENTISTS,
  start = () => json({ visit: startedVisit(60), resumed: false }, 201),
}: {
  /** `null` answers the defaults with a 500. */
  defaults?: StartDefaults | null;
  rooms?: Room[];
  /** The branch's dentists at each read. */
  dentists?: () => Practitioner[];
  start?: () => Response;
} = {}): FetchMock {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace('/api/v1', '');
    const method = init?.method ?? 'GET';
    if (method === 'POST' && path === '/visits') return Promise.resolve(start());
    if (path === `/users/practitioners?branchId=${BRANCH.id}`) {
      return Promise.resolve(json(dentists()));
    }
    if (path === `/rooms?branchId=${BRANCH.id}`) return Promise.resolve(json(rooms));
    if (path === '/visits/start-defaults') {
      return Promise.resolve(defaults ? json(defaults) : problem(500, 'internal'));
    }
    return Promise.resolve(problem(404, 'not_found'));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const posted = (fetchMock: FetchMock): unknown => {
  const call = fetchMock.mock.calls.findLast(
    ([url, init]) => url === '/api/v1/visits' && init?.method === 'POST',
  );
  const body = call?.[1]?.body;
  return typeof body === 'string' ? JSON.parse(body) : undefined;
};

/** The popover behind a Start visit trigger, with a stand-in workspace to land on. */
function renderPopover(session: Session = { ...sessionWith(WRITE), branch: BRANCH }) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(sessionQueryOptions().queryKey, session);
  const rootRoute = createRootRoute({ component: Outlet });
  const visitRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/visits/$visitId',
    component: WorkspaceRoute,
  });
  function WorkspaceRoute() {
    const { visitId } = useParams({ strict: false });
    return <p>{`Workspace ${visitId ?? ''}`}</p>;
  }
  const routeTree = rootRoute.addChildren([
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => (
        <StartVisitPopover patientId={PATIENT_ID}>
          <Button variant="primary">{'Start visit'}</Button>
        </StartVisitPopover>
      ),
    }),
    visitRoute,
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

async function open() {
  fireEvent.click(await screen.findByRole('button', { name: 'Start visit' }));
  return screen.findByRole('dialog', { name: 'Start visit' });
}

const select = (dialog: HTMLElement, name: string) =>
  within(dialog).getByRole<HTMLSelectElement>('combobox', { name });
const submit = (dialog: HTMLElement) => {
  fireEvent.click(within(dialog).getByRole('button', { name: 'Start visit' }));
};

describe('StartVisitPopover', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('pre-selects a dentist user and their room, and starts the visit there', async () => {
    const fetchMock = mockStart();
    const router = renderPopover();
    const dialog = await open();
    await waitFor(() => {
      expect(select(dialog, 'Dentist').value).toBe(ANA);
    });
    expect(select(dialog, 'Room').value).toBe(id(72));
    // Active rooms only.
    expect(
      within(select(dialog, 'Room'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Choose…', 'Room 1', 'Room 2']);
    // Nothing left to fill: Start has the focus.
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(dialog).getByRole('button', { name: 'Start visit' }),
      );
    });

    submit(dialog);
    await screen.findByText(`Workspace ${id(60)}`);
    expect(posted(fetchMock)).toEqual({ patientId: PATIENT_ID, dentistId: ANA, roomId: id(72) });
    expect(router.state.location.pathname).toBe(`/visits/${id(60)}`);
  });

  it('makes an assistant pick the dentist and the room', async () => {
    const fetchMock = mockStart({ defaults: { dentistId: null, roomId: null } });
    renderPopover();
    const dialog = await open();
    await within(dialog).findByRole('option', { name: 'Dr. Marcus Lee' });
    expect(select(dialog, 'Dentist').value).toBe('');
    expect(select(dialog, 'Room').value).toBe('');
    await waitFor(() => {
      expect(document.activeElement).toBe(select(dialog, 'Dentist'));
    });

    submit(dialog);
    expect(await within(dialog).findByText('Choose a dentist')).toBeTruthy();
    expect(within(dialog).getByText('Choose a room')).toBeTruthy();
    expect(posted(fetchMock)).toBeUndefined();

    fireEvent.change(select(dialog, 'Dentist'), { target: { value: MARCUS } });
    fireEvent.change(select(dialog, 'Room'), { target: { value: id(71) } });
    expect(within(dialog).queryByText('Choose a dentist')).toBeNull();
    submit(dialog);
    await screen.findByText(`Workspace ${id(60)}`);
    expect(posted(fetchMock)).toEqual({ patientId: PATIENT_ID, dentistId: MARCUS, roomId: id(71) });
  });

  it('hides the room when the branch has no active room, and starts without one', async () => {
    const fetchMock = mockStart({ rooms: [room(73, 'Old room', false)] });
    renderPopover();
    const dialog = await open();
    await waitFor(() => {
      expect(select(dialog, 'Dentist').value).toBe(ANA);
    });
    expect(within(dialog).queryByRole('combobox', { name: 'Room' })).toBeNull();
    submit(dialog);
    await screen.findByText(`Workspace ${id(60)}`);
    expect(posted(fetchMock)).toEqual({ patientId: PATIENT_ID, dentistId: ANA });
  });

  it('goes to a resumed visit without a toast', async () => {
    mockStart({ start: () => json({ visit: startedVisit(61), resumed: true }) });
    renderPopover();
    const dialog = await open();
    await waitFor(() => {
      expect(select(dialog, 'Dentist').value).toBe(ANA);
    });
    submit(dialog);
    await screen.findByText(`Workspace ${id(61)}`);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows a busy room inline and stays open', async () => {
    mockStart({ start: () => problem(409, 'visit.room_busy') });
    const router = renderPopover();
    const dialog = await open();
    await waitFor(() => {
      expect(select(dialog, 'Room').value).toBe(id(72));
    });
    submit(dialog);
    expect(await within(dialog).findByText('Another live visit is using this room')).toBeTruthy();
    expect(select(dialog, 'Room').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(select(dialog, 'Room'));
    expect(router.state.location.pathname).toBe('/');

    // Choosing another room clears it.
    fireEvent.change(select(dialog, 'Room'), { target: { value: id(71) } });
    expect(within(dialog).queryByText('Another live visit is using this room')).toBeNull();
  });

  it('puts a dentist the server refuses on the Dentist field', async () => {
    mockStart({ start: () => problem(422, 'visit.dentist_invalid') });
    renderPopover();
    const dialog = await open();
    await waitFor(() => {
      expect(select(dialog, 'Dentist').value).toBe(ANA);
    });
    submit(dialog);
    expect(
      await within(dialog).findByText('This dentist no longer works in this branch'),
    ).toBeTruthy();
    expect(select(dialog, 'Dentist').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(select(dialog, 'Dentist'));
  });

  it('drops a chosen dentist the reloaded list no longer has', async () => {
    let reads = 0;
    mockStart({
      defaults: { dentistId: null, roomId: id(72) },
      dentists: () => {
        reads += 1;
        return reads === 1 ? DENTISTS : DENTISTS.filter((p) => p.id !== MARCUS);
      },
      start: () => problem(422, 'visit.dentist_invalid'),
    });
    renderPopover();
    const dialog = await open();
    await within(dialog).findByRole('option', { name: 'Dr. Marcus Lee' });
    fireEvent.change(select(dialog, 'Dentist'), { target: { value: MARCUS } });
    submit(dialog);
    await within(dialog).findByText('This dentist no longer works in this branch');
    await waitFor(() => {
      expect(within(dialog).queryByRole('option', { name: 'Dr. Marcus Lee' })).toBeNull();
    });
    expect(select(dialog, 'Dentist').value).toBe('');
  });

  it('starts empty when the defaults fail to load', async () => {
    const fetchMock = mockStart({ defaults: null });
    renderPopover();
    const dialog = await open();
    await within(dialog).findByRole('option', { name: 'Dr. Marcus Lee' });
    expect(select(dialog, 'Dentist').value).toBe('');
    expect(select(dialog, 'Room').value).toBe('');
    fireEvent.change(select(dialog, 'Dentist'), { target: { value: ANA } });
    fireEvent.change(select(dialog, 'Room'), { target: { value: id(71) } });
    submit(dialog);
    await screen.findByText(`Workspace ${id(60)}`);
    expect(posted(fetchMock)).toEqual({ patientId: PATIENT_ID, dentistId: ANA, roomId: id(71) });
  });

  it.each([
    ['patient.archived', 409, 'This patient is archived. Restore the record to start a visit.'],
    [
      'patient.merged',
      409,
      'This record was merged into another one. Start the visit from the kept record.',
    ],
    [
      'visit.branch_required',
      422,
      'Visits start in a branch, and this session has none. Switch branch and try again.',
    ],
  ])('says why %s can’t start a visit', async (code, status, message) => {
    mockStart({ start: () => problem(status, code) });
    renderPopover();
    const dialog = await open();
    await waitFor(() => {
      expect(select(dialog, 'Dentist').value).toBe(ANA);
    });
    submit(dialog);
    expect(await within(dialog).findByText(message)).toBeTruthy();
  });

  it('can’t be dismissed while the start is in flight', async () => {
    let answer: (response: Response) => void = () => undefined;
    const fetchMock = mockStart();
    const base = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? new Promise<Response>((resolve) => {
            answer = resolve;
          })
        : (base?.(url, init) ?? Promise.resolve(problem(404, 'not_found'))),
    );
    renderPopover();
    const dialog = await open();
    await waitFor(() => {
      expect(select(dialog, 'Dentist').value).toBe(ANA);
    });
    submit(dialog);
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Cancel' }).hasAttribute('disabled')).toBe(
        true,
      );
    });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Start visit' })).toBe(dialog);

    answer(json({ visit: startedVisit(60), resumed: false }, 201));
    await screen.findByText(`Workspace ${id(60)}`);
  });

  it('explains that a visit needs a branch when the session has none', async () => {
    const fetchMock = mockStart();
    renderPopover(sessionWith(WRITE));
    const dialog = await open();
    expect(within(dialog).getByText(/Visits start in a branch/)).toBeTruthy();
    expect(within(dialog).queryByRole('combobox')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Start visit' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
