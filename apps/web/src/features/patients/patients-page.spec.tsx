import {
  ageOn,
  type DuplicateGroup,
  type Patient,
  type PatientBalance,
  type PatientListItem,
  type Permission,
  type Session,
} from '@dcm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  useSearch,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import '@/lib/i18n';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { ToastProvider } from '@/components/ui/toast';
import { sessionQueryOptions } from '@/features/auth/session';
import { todayIn } from '@/lib/format';
import { parsePatientsSearch } from './list-query';
import { PatientsScreen } from './patients-screen';

const id = (n: number) => `01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d${String(n).padStart(2, '0')}`;
const DENTIST_ID = id(80);
const INACTIVE_DENTIST_ID = id(81);

const staff = (userId: string, displayName: string, active: boolean) => ({
  id: userId,
  email: `${userId}@example.com`,
  displayName,
  title: null,
  practitionerType: 'dentist',
  phone: null,
  active,
  roles: [],
  branches: [],
  createdAt: '2026-01-01T10:00:00.000Z',
});

const item = (n: number, fullName: string, extra: Partial<PatientListItem> = {}) =>
  ({
    id: id(n),
    displayNumber: `P-${String(n).padStart(6, '0')}`,
    fullName,
    phone: '+9613123456',
    dateOfBirth: '1990-05-01',
    sex: 'female',
    medicalAlerts: [],
    primaryDentistUserId: null,
    email: null,
    archivedAt: null,
    updatedAt: '2026-09-01T10:00:00.000Z',
    ...extra,
  }) satisfies PatientListItem;

const full = (patient: PatientListItem, archivedAt: string | null): Patient => ({
  ...patient,
  address: null,
  insurance: null,
  emergencyContact: null,
  notes: null,
  guardianName: null,
  guardianPhone: null,
  externalId: null,
  archivedAt,
  mergedIntoId: null,
  createdAt: '2026-01-01T10:00:00.000Z',
});

const RANA = item(1, 'Rana Haddad', {
  medicalAlerts: ['Penicillin allergy'],
  primaryDentistUserId: DENTIST_ID,
});
const SAMI = item(2, 'Sami Khoury', { sex: 'male', dateOfBirth: null });
const LINA = item(3, 'Lina Aoun');
const ALL_PERMISSIONS: Permission[] = [
  'patient:read',
  'patient:write',
  'payment:read',
  'user:read',
];

function sessionWith(permissions: Permission[]): Session {
  return {
    user: { id: id(90), displayName: 'Jamie Ortiz', email: 'j@example.com' },
    platformAdmin: false,
    mustChangePassword: false,
    tenant: {
      id: id(91),
      name: 'Northgate Dental',
      slug: 'northgate',
      timeZone: 'Asia/Beirut',
      currency: 'USD',
      locale: 'en',
      country: 'LB',
    },
    branch: null,
    branches: [],
    roleNames: [],
    permissions,
    idleTimeoutSeconds: 900,
  };
}

interface Api {
  items?: PatientListItem[];
  total?: number;
  balances?: PatientBalance[];
  duplicates?: DuplicateGroup[];
  listStatus?: number;
  archiveStatus?: number;
  /** Overrides the list answer (a pending promise keeps the previous page on screen). */
  list?: (params: URLSearchParams) => Promise<Response> | undefined;
  /** Overrides the CSV export answer. */
  exportCsv?: () => Promise<Response>;
  /** Overrides the balances answer for a page's ids. */
  balancesFor?: (ids: string[]) => Promise<Response> | undefined;
}

const json = (body: unknown, status = 200, type = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });

/** Answers every request the page makes; returns the fetch mock so tests can read its calls. */
function mockApi({
  items = [RANA, SAMI, LINA],
  total,
  balances = [],
  duplicates = [],
  listStatus = 200,
  archiveStatus = 200,
  list,
  exportCsv,
  balancesFor,
}: Api = {}) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace('/api/v1', '');
    if (path === '/patients/counts')
      return Promise.resolve(json({ active: 54, notSeen: 54, archived: 3 }));
    if (path === '/billing/patients/owing-count') return Promise.resolve(json({ count: 7 }));
    if (path === '/patients/duplicates') return Promise.resolve(json(duplicates));
    if (path === '/users/practitioners') {
      return Promise.resolve(
        json([{ userId: DENTIST_ID, displayName: 'Dr. Ana Reyes', title: null }]),
      );
    }
    if (path === '/users') {
      return Promise.resolve(
        json([
          staff(DENTIST_ID, 'Dr. Ana Reyes', true),
          staff(INACTIVE_DENTIST_ID, 'Dr. Marcus Lee', false),
        ]),
      );
    }
    if (path.startsWith('/billing/balances')) {
      const ids = new URLSearchParams(path.split('?')[1]).get('patientIds')?.split(',') ?? [];
      return balancesFor?.(ids) ?? Promise.resolve(json(balances));
    }
    if (path === '/patients/archive' && archiveStatus !== 200) {
      return Promise.resolve(
        json(
          { type: 'about:blank', title: 'Conflict', status: archiveStatus, code: 'patient.merged' },
          archiveStatus,
          'application/problem+json',
        ),
      );
    }
    if (path === '/patients/archive' || path === '/patients/restore') {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        ids: string[];
      };
      const archivedAt = path === '/patients/archive' ? '2026-09-28T10:00:00.000Z' : null;
      return Promise.resolve(
        json(items.filter((p) => body.ids.includes(p.id)).map((p) => full(p, archivedAt))),
      );
    }
    if (path.startsWith('/billing/patients/export')) {
      return exportCsv?.() ?? Promise.resolve(new Response('id\n', { status: 200 }));
    }
    if (/^\/(billing\/)?patients(\?|$)/.test(path)) {
      const custom = list?.(new URLSearchParams(path.split('?')[1]));
      if (custom) return custom;
      if (listStatus !== 200) {
        return Promise.resolve(
          json(
            {
              type: 'about:blank',
              title: 'Internal Server Error',
              status: listStatus,
              code: 'internal',
              requestId: 'req-7f3a',
            },
            listStatus,
            'application/problem+json',
          ),
        );
      }
      const page = Number(new URLSearchParams(path.split('?')[1]).get('page') ?? 1);
      const size = Number(new URLSearchParams(path.split('?')[1]).get('size') ?? 25);
      return Promise.resolve(json({ items, total: total ?? items.length, page, size }));
    }
    return Promise.resolve(json({ title: 'Not found' }, 404));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const calledUrls = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.map(([url]) => url);

function renderPage({
  permissions = ALL_PERMISSIONS,
  url = '/',
}: { permissions?: Permission[]; url?: string } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(sessionQueryOptions().queryKey, sessionWith(permissions));
  // The route's own wiring (`PatientsScreen`), on a bare root route: the test router isn't the
  // registered one, so the search is parsed here rather than typed through it.
  const rootRoute = createRootRoute({ component: Harness });
  function Harness() {
    const search = parsePatientsSearch(useSearch({ strict: false }));
    const navigate = rootRoute.useNavigate();
    return (
      <PatientsScreen
        search={search}
        navigate={(navigation) => {
          void navigate(navigation);
        }}
      />
    );
  }
  // Stand-ins so the list's own routes resolve: `/` is the list itself, and opening a record
  // lands on `/patients/<id>` (asserted by its pathname).
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => null }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/patients/$patientId',
      component: () => null,
    }),
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ConfirmProvider>
          <RouterProvider router={router} />
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return router;
}

const searchBox = () => screen.getByRole<HTMLInputElement>('textbox', { name: 'Search patients' });
const listCalls = (fetchMock: ReturnType<typeof mockApi>) =>
  calledUrls(fetchMock).filter((url) => /\/api\/v1\/(billing\/)?patients(\?|$)/.test(url));

const rowOf = async (name: string) => {
  const cell = await screen.findByText(name);
  const row = cell.closest<HTMLElement>('[role="row"]');
  if (!row) throw new Error(`No row for ${name}`);
  return row;
};

const openMenu = async (name: string) => {
  const trigger = await screen.findByRole('button', { name: `Actions for ${name}` });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return screen.findByRole('menu');
};

const quickView = async (name: string) => {
  const menu = await openMenu(name);
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'Quick view' }));
};

describe('PatientsPage', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders the number, Age·sex, formatted phone and "—" for Visits and Last visit', async () => {
    mockApi();
    renderPage();
    const cells = within(await rowOf('Rana Haddad')).getAllByRole('cell');
    const age = ageOn('1990-05-01', todayIn('Asia/Beirut'));
    expect(cells[1]?.textContent).toContain('P-000001');
    expect(cells[1]?.textContent).toContain('Penicillin');
    expect(cells[2]?.textContent).toBe(`${String(age)} · F`);
    expect(cells[3]?.textContent).toBe('03 123 456');
    expect(cells[4]?.textContent).toBe('—');
    expect(cells[5]?.textContent).toBe('Dr. Ana Reyes');
    expect(cells[6]?.textContent).toBe('—');
    const sami = within(await rowOf('Sami Khoury')).getAllByRole('cell');
    expect(sami[2]?.textContent).toBe('— · M');
  });

  it('names a deactivated dentist from the staff list', async () => {
    mockApi({ items: [item(5, 'Omar Nassar', { primaryDentistUserId: INACTIVE_DENTIST_ID })] });
    renderPage();
    const cells = within(await rowOf('Omar Nassar')).getAllByRole('cell');
    await waitFor(() => {
      expect(cells[5]?.textContent).toBe('Dr. Marcus Lee');
    });
    const dentist = screen.getByRole('combobox', { name: 'Dentist' });
    expect(within(dentist).queryByRole('option', { name: 'Dr. Marcus Lee' })).toBeNull();
  });

  it('falls back to the practitioners for dentist names without user:read', async () => {
    const fetchMock = mockApi();
    renderPage({ permissions: ['patient:read', 'payment:read'] });
    const cells = within(await rowOf('Rana Haddad')).getAllByRole('cell');
    await waitFor(() => {
      expect(cells[5]?.textContent).toBe('Dr. Ana Reyes');
    });
    expect(calledUrls(fetchMock)).not.toContain('/api/v1/users');
  });

  it('without payment:read, turns an Owes balance / balance-sort URL into Active by name', async () => {
    const fetchMock = mockApi();
    const router = renderPage({
      permissions: ['patient:read', 'user:read'],
      url: '/?view=owing&sort=balance&dir=desc',
    });
    await rowOf('Rana Haddad');
    expect(calledUrls(fetchMock).some((url) => url.includes('/billing/'))).toBe(false);
    expect(calledUrls(fetchMock)).toContain('/api/v1/patients');
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({
        view: 'active',
        sort: 'name',
        dir: 'asc',
      });
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('tab', { name: /Active/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('shows the balance from the balances query, danger-styled when owing', async () => {
    const fetchMock = mockApi({
      balances: [
        { patientId: RANA.id, balances: [{ amount: '250.00', currency: 'USD' }] },
        { patientId: SAMI.id, balances: [] },
      ],
    });
    renderPage();
    const balance = await within(await rowOf('Rana Haddad')).findByText('$250');
    expect(balance.className).toContain('text-danger');
    expect(balance.className).toContain('font-semibold');
    expect(within(await rowOf('Sami Khoury')).getAllByRole('cell')[7]?.textContent).toBe('—');
    expect(calledUrls(fetchMock)).toContain(
      `/api/v1/billing/balances?patientIds=${[RANA.id, SAMI.id, LINA.id].join(',')}`,
    );
  });

  it('asks the billing route for the Owes balance view', async () => {
    const fetchMock = mockApi();
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: /Owes balance/ }));
    await waitFor(() => {
      expect(calledUrls(fetchMock)).toContain('/api/v1/billing/patients?view=owing');
    });
  });

  it('sorts by balance through the billing route', async () => {
    const fetchMock = mockApi();
    renderPage();
    await rowOf('Rana Haddad');
    fireEvent.click(screen.getByRole('button', { name: 'Balance' }));
    await waitFor(() => {
      expect(calledUrls(fetchMock)).toContain('/api/v1/billing/patients?sort=balance&dir=desc');
    });
    expect(screen.getByRole('columnheader', { name: /Balance/ }).getAttribute('aria-sort')).toBe(
      'descending',
    );
  });

  it('tints a Dentist chip that differs from its default, and Clear filters resets it', async () => {
    const fetchMock = mockApi();
    renderPage();
    await rowOf('Rana Haddad');
    const dentist = screen.getByRole('combobox', { name: 'Dentist' });
    await within(dentist).findByRole('option', { name: 'Dr. Ana Reyes' });
    expect(dentist.closest('label')?.className).not.toContain('bg-primary-tint');

    fireEvent.change(dentist, { target: { value: DENTIST_ID } });
    await waitFor(() => {
      expect(calledUrls(fetchMock)).toContain(`/api/v1/patients?dentist=${DENTIST_ID}`);
    });
    const chip = screen.getByRole('combobox', { name: 'Dentist' });
    expect(chip.closest('label')?.className).toContain('bg-primary-tint');

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    });
    expect(
      screen.getByRole('combobox', { name: 'Dentist' }).closest('label')?.className,
    ).not.toContain('bg-primary-tint');
  });

  it('offers "Merge 2 records" for exactly two selected rows', async () => {
    mockApi();
    renderPage();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Rana Haddad' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Sami Khoury' }));
    expect(screen.getByText('2 selected')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Merge 2 records' })).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Lina Aoun' }));
    expect(screen.getByText('3 selected')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Merge 2 records' })).toBeNull();
  });

  it('archives from the row menu with an optional reason, and Undo restores', async () => {
    const fetchMock = mockApi();
    renderPage();
    const menu = await openMenu('Rana Haddad');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Archive' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Archive Rana Haddad?')).toBeTruthy();
    expect(within(dialog).getByPlaceholderText('Optional — saved to the audit trail')).toBeTruthy();
    const ok = within(dialog).getByRole('button', { name: 'Archive' });
    expect(ok).toHaveProperty('disabled', false);
    expect(ok.className).toContain('bg-danger');
    fireEvent.click(ok);

    const toast = await screen.findByText('Rana Haddad archived');
    const archiveCall = fetchMock.mock.calls.find(([url]) => url === '/api/v1/patients/archive');
    expect(
      JSON.parse(typeof archiveCall?.[1]?.body === 'string' ? archiveCall[1].body : ''),
    ).toEqual({ ids: [RANA.id], reason: null });

    const status = toast.closest<HTMLElement>('[role="status"]');
    fireEvent.click(within(status ?? document.body).getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Rana Haddad restored')).toBeTruthy();
    const restoreCall = fetchMock.mock.calls.find(([url]) => url === '/api/v1/patients/restore');
    expect(
      JSON.parse(typeof restoreCall?.[1]?.body === 'string' ? restoreCall[1].body : ''),
    ).toEqual({ ids: [RANA.id] });
  });

  it('shows the duplicate banner with the number of records', async () => {
    mockApi({ duplicates: [{ patients: [RANA, item(4, 'Rana Haddad')] }] });
    renderPage();
    expect(await screen.findByText('2 possible duplicate records')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Review & merge' })).toBeTruthy();
  });

  it('hides New patient, Archive and Merge without patient:write', async () => {
    mockApi({ duplicates: [{ patients: [RANA, SAMI] }] });
    renderPage({ permissions: ['patient:read', 'payment:read'] });
    await screen.findByText('2 possible duplicate records');
    expect(screen.queryByRole('button', { name: 'New patient' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Review & merge' })).toBeNull();

    const menu = await openMenu('Rana Haddad');
    expect(within(menu).getByRole('menuitem', { name: 'Quick view' })).toBeTruthy();
    expect(within(menu).queryByRole('menuitem', { name: 'Archive' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: /Merge with/ })).toBeNull();
    fireEvent.keyDown(menu, { key: 'Escape' });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Rana Haddad' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Sami Khoury' }));
    const bulk = screen.getByRole('toolbar');
    expect(within(bulk).queryByRole('button', { name: 'Merge 2 records' })).toBeNull();
    expect(within(bulk).queryByRole('button', { name: 'Archive' })).toBeNull();
    expect(within(bulk).getByRole('button', { name: 'Export' })).toBeTruthy();
  });

  it('shows the empty state for a clinic without patients', async () => {
    mockApi({ items: [] });
    renderPage();
    expect(await screen.findByText('No patients yet')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'New patient' })).toHaveLength(2);
  });

  it('shows no results for a search, naming the view, and clears it', async () => {
    const fetchMock = mockApi({ items: [] });
    renderPage({ url: '/?q=zzz' });
    expect(await screen.findByText('No patients match')).toBeTruthy();
    expect(screen.getByText('Nothing in “Active” matches your search and filters.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search and filters' }));
    await waitFor(() => {
      expect(calledUrls(fetchMock)).toContain('/api/v1/patients');
    });
  });

  it('shows the error state with the request id and retries', async () => {
    const fetchMock = mockApi({ listStatus: 500 });
    renderPage();
    expect(await screen.findByText("Couldn't load patients")).toBeTruthy();
    expect(screen.getByText('Request req-7f3a')).toBeTruthy();
    const before = calledUrls(fetchMock).filter((url) => url === '/api/v1/patients').length;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(calledUrls(fetchMock).filter((url) => url === '/api/v1/patients').length).toBe(
        before + 1,
      );
    });
  });

  it('pages with "Showing 11–20 of 54", and a new Rows size goes back to page 1', async () => {
    const fetchMock = mockApi({ total: 54 });
    renderPage({ url: '/?page=2&size=10' });
    await rowOf('Rana Haddad');
    expect(
      screen.getByText(
        (_, element) =>
          element?.textContent === 'Showing 11–20 of 54' && element.tagName === 'SPAN',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: '2' }).getAttribute('aria-current')).toBe('page');

    fireEvent.change(screen.getByRole('combobox', { name: 'Rows' }), { target: { value: '50' } });
    await waitFor(() => {
      expect(calledUrls(fetchMock)).toContain('/api/v1/patients?size=50');
    });
  });
  describe('search box', () => {
    it('keeps typing across a debounced commit', async () => {
      const fetchMock = mockApi();
      renderPage();
      await rowOf('Rana Haddad');
      fireEvent.change(searchBox(), { target: { value: 'Rana ' } });
      await waitFor(() => {
        expect(calledUrls(fetchMock)).toContain('/api/v1/patients?q=Rana');
      });
      expect(searchBox().value).toBe('Rana ');
      fireEvent.change(searchBox(), { target: { value: 'Rana H' } });
      await waitFor(() => {
        expect(calledUrls(fetchMock)).toContain('/api/v1/patients?q=Rana+H');
      });
      expect(searchBox().value).toBe('Rana H');
    });

    it('commits once per pause in typing', async () => {
      const fetchMock = mockApi();
      renderPage();
      await rowOf('Rana Haddad');
      for (const value of ['R', 'Ra', 'Ran', 'Rana']) {
        fireEvent.change(searchBox(), { target: { value } });
      }
      await waitFor(() => {
        expect(calledUrls(fetchMock)).toContain('/api/v1/patients?q=Rana');
      });
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(listCalls(fetchMock).filter((url) => url.includes('q='))).toEqual([
        '/api/v1/patients?q=Rana',
      ]);
    });

    it('is emptied by Clear filters', async () => {
      mockApi();
      renderPage({ url: '/?q=rana' });
      await rowOf('Rana Haddad');
      expect(searchBox().value).toBe('rana');
      expect(searchBox().maxLength).toBe(100);
      fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
      await waitFor(() => {
        expect(searchBox().value).toBe('');
      });
    });
  });

  it('keeps the previous rows inert while the next view loads', async () => {
    mockApi({
      list: (params) =>
        params.get('view') === 'archived' ? new Promise<Response>(() => undefined) : undefined,
    });
    renderPage();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Rana Haddad' }));
    fireEvent.click(screen.getByRole('tab', { name: /Archived/ }));

    const table = await screen.findByRole('table', { busy: true });
    expect(within(table).getByText('Rana Haddad')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Actions for Rana Haddad' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByRole('checkbox', { name: 'Select Rana Haddad' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
  });

  it('steps back from a page past the end to the last page', async () => {
    const fetchMock = mockApi({
      total: 30,
      list: (params) =>
        params.get('page') === '5'
          ? Promise.resolve(json({ items: [], total: 30, page: 5, size: 25 }))
          : undefined,
    });
    renderPage({ url: '/?page=5' });
    await waitFor(() => {
      expect(calledUrls(fetchMock)).toContain('/api/v1/patients?page=2');
    });
    expect(await screen.findByText('Rana Haddad')).toBeTruthy();
    expect(screen.queryByText('No patients match')).toBeNull();
  });

  it('restores from the row menu in the Archived view, with Undo', async () => {
    const archived = [RANA, SAMI].map((p) => ({ ...p, archivedAt: '2026-09-01T10:00:00.000Z' }));
    const fetchMock = mockApi({ items: archived });
    renderPage({ url: '/?view=archived' });
    const menu = await openMenu('Rana Haddad');
    expect(within(menu).queryByRole('menuitem', { name: 'Archive' })).toBeNull();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Restore' }));

    const toast = await screen.findByText('Rana Haddad restored');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    const restore = fetchMock.mock.calls.find(([url]) => url === '/api/v1/patients/restore');
    expect(JSON.parse(typeof restore?.[1]?.body === 'string' ? restore[1].body : '')).toEqual({
      ids: [RANA.id],
    });
    const status = toast.closest<HTMLElement>('[role="status"]');
    fireEvent.click(within(status ?? document.body).getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Rana Haddad archived')).toBeTruthy();
  });

  it('archives the selection from the bulk bar, focuses the table, and Undo restores', async () => {
    const fetchMock = mockApi();
    renderPage();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Rana Haddad' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Sami Khoury' }));
    fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Archive' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Archive 2 patients?')).toBeTruthy();
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Moved away' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));

    const toast = await screen.findByText('2 patients archived');
    const archive = fetchMock.mock.calls.find(([url]) => url === '/api/v1/patients/archive');
    expect(JSON.parse(typeof archive?.[1]?.body === 'string' ? archive[1].body : '')).toEqual({
      ids: [RANA.id, SAMI.id],
      reason: 'Moved away',
    });
    expect(screen.queryByRole('toolbar')).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('table'));
    });

    // A selection made after the archive survives its Undo.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Lina Aoun' }));
    const status = toast.closest<HTMLElement>('[role="status"]');
    fireEvent.click(within(status ?? document.body).getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('2 patients restored')).toBeTruthy();
    const restore = fetchMock.mock.calls.find(([url]) => url === '/api/v1/patients/restore');
    expect(JSON.parse(typeof restore?.[1]?.body === 'string' ? restore[1].body : '')).toEqual({
      ids: [RANA.id, SAMI.id],
    });
    expect(screen.getByText('1 selected')).toBeTruthy();
  });

  it('keeps the archive dialog open with the reason when archiving fails', async () => {
    mockApi({
      archiveStatus: 409,
    });
    renderPage();
    const menu = await openMenu('Rana Haddad');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Archive' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Duplicate' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));

    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      "Couldn't archive: the record has already been merged into another",
    );
    expect(within(dialog).getByRole<HTMLTextAreaElement>('textbox').value).toBe('Duplicate');
  });

  it('exports the current query, or the selected ids, and is busy meanwhile', async () => {
    const { createObjectURL, revokeObjectURL } = URL;
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
    // jsdom can't save a download: clicking the link would try to navigate to it.
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    onTestFinished(() => {
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
      click.mockRestore();
    });
    let finish: (response: Response) => void = () => undefined;
    const fetchMock = mockApi({
      exportCsv: () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    });
    renderPage({ url: '/?view=archived' });
    await rowOf('Rana Haddad');
    const exportCsv = screen.getByRole('button', { name: 'Export CSV' });
    fireEvent.click(exportCsv);
    expect(calledUrls(fetchMock)).toContain(
      '/api/v1/billing/patients/export?view=archived&lang=en',
    );
    await waitFor(() => {
      expect(exportCsv).toHaveProperty('disabled', true);
    });
    finish(new Response('id\n', { status: 200 }));
    await waitFor(() => {
      expect(exportCsv).toHaveProperty('disabled', false);
    });
    expect(click).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Sami Khoury' }));
    fireEvent.click(within(screen.getByRole('toolbar')).getByRole('button', { name: 'Export' }));
    expect(calledUrls(fetchMock)).toContain(
      `/api/v1/billing/patients/export?ids=${SAMI.id}&lang=en`,
    );
  });

  it('names an unlisted dentist in the Dentist chip', async () => {
    mockApi();
    renderPage({ url: `/?dentist=${INACTIVE_DENTIST_ID}` });
    const dentist = await screen.findByRole<HTMLSelectElement>('combobox', { name: 'Dentist' });
    await waitFor(() => {
      expect(dentist.selectedOptions[0]?.textContent).toBe('Dr. Marcus Lee');
    });
  });

  it('opens the record on a row click', async () => {
    mockApi();
    const router = renderPage({ url: '/?q=rana' });
    fireEvent.click(await rowOf('Rana Haddad'));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/patients/${RANA.id}`);
    });
    expect(router.history.canGoBack()).toBe(true);
  });

  it('offers Open record first in the row menu, then Quick view', async () => {
    mockApi();
    const router = renderPage();
    const menu = await openMenu('Sami Khoury');
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((menuItem) => menuItem.textContent).slice(0, 2)).toEqual([
      'Open record',
      'Quick view',
    ]);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Open record' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/patients/${SAMI.id}`);
    });
  });

  it('opening a panel from a row drops the create pre-fill', async () => {
    mockApi();
    const router = renderPage();
    await router.navigate({
      to: '/',
      search: { panel: 'new' },
      state: { patientPrefill: { fullName: 'Rana' } },
    });
    await quickView('Rana Haddad');
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ panel: `quick:${RANA.id}` });
    });
    expect(router.state.location.state.patientPrefill).toBeUndefined();
  });

  it('keeps the create pre-fill while the list search changes under the open form', async () => {
    mockApi();
    const router = renderPage();
    await router.navigate({
      to: '/',
      search: { panel: 'new' },
      state: { patientPrefill: { fullName: 'Rana' } },
    });
    const name = await screen.findByRole<HTMLInputElement>('textbox', { name: /Full name/ });
    expect(name.value).toBe('Rana');
    fireEvent.change(searchBox(), { target: { value: 'sami' } });
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ q: 'sami', panel: 'new' });
    });
    expect(router.state.location.state.patientPrefill).toEqual({ fullName: 'Rana' });
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: /Full name/ })).toBe(name);
  });

  it('closing a panel opened from the list goes back instead of adding an entry', async () => {
    mockApi();
    const router = renderPage();
    await quickView('Rana Haddad');
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ panel: `quick:${RANA.id}` });
    });
    // Swapping panels replaces the entry and stays "opened from the list".
    await quickView('Sami Khoury');
    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ panel: `quick:${SAMI.id}` });
    });
    const panel = await screen.findByRole('complementary', { name: 'Patient not found' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(router.state.location.search).not.toHaveProperty('panel');
    });
    expect(router.history.location.state.__TSR_index).toBe(0);
  });

  it('closing a panel reached by a link replaces its entry', async () => {
    mockApi();
    const router = renderPage({ url: `/?panel=quick:${RANA.id}` });
    const panel = await screen.findByRole('complementary', { name: 'Patient not found' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(router.state.location.search).not.toHaveProperty('panel');
    });
    expect(router.history.location.state.__TSR_index).toBe(0);
    expect(router.history.canGoBack()).toBe(false);
  });

  it('shimmers the balances of a new page until they load', async () => {
    let release: (response: Response) => void = () => undefined;
    const OMAR = item(4, 'Omar Nassar');
    mockApi({
      total: 54,
      list: (params) =>
        params.get('page') === '2'
          ? Promise.resolve(json({ items: [OMAR], total: 54, page: 2, size: 25 }))
          : undefined,
      balancesFor: (ids) =>
        ids.includes(OMAR.id)
          ? new Promise<Response>((resolve) => {
              release = resolve;
            })
          : undefined,
    });
    renderPage();
    await rowOf('Rana Haddad');
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    const row = await rowOf('Omar Nassar');
    await waitFor(() => {
      expect(within(row).getAllByRole('cell')[7]?.getAttribute('aria-busy')).toBe('true');
    });
    release(json([{ patientId: OMAR.id, balances: [{ amount: '40.00', currency: 'USD' }] }]));
    expect(await within(row).findByText('$40')).toBeTruthy();
  });

  it('labels the table for assistive tech', async () => {
    mockApi();
    renderPage();
    const row = await rowOf('Rana Haddad');
    expect(row.hasAttribute('aria-selected')).toBe(false);
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Rana Haddad' }));
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'Select all on page' }).indeterminate,
    ).toBe(true);
  });
});
