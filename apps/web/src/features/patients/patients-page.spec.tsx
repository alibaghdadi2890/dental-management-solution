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
  createRouter,
  RouterProvider,
  useSearch,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { ToastProvider } from '@/components/ui/toast';
import { sessionQueryOptions } from '@/features/auth/session';
import { todayIn } from '@/lib/format';
import { parsePatientsSearch } from './list-query';
import { PatientsPage } from './patients-page';

const id = (n: number) => `01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d${String(n).padStart(2, '0')}`;
const DENTIST_ID = id(80);

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
const ALL_PERMISSIONS: Permission[] = ['patient:read', 'patient:write', 'payment:read'];

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
    if (path.startsWith('/billing/balances')) return Promise.resolve(json(balances));
    if (path === '/patients/archive' || path === '/patients/restore') {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        ids: string[];
      };
      const archivedAt = path === '/patients/archive' ? '2026-09-28T10:00:00.000Z' : null;
      return Promise.resolve(
        json(items.filter((p) => body.ids.includes(p.id)).map((p) => full(p, archivedAt))),
      );
    }
    if (/^\/(billing\/)?patients(\?|$)/.test(path)) {
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
  // The route's own wiring (`routes/_app/patients/index.tsx`), on a bare root route: the test
  // router isn't the registered one, so the search is parsed here rather than typed through it.
  const rootRoute = createRootRoute({ component: Harness });
  function Harness() {
    const search = parsePatientsSearch(useSearch({ strict: false }));
    const navigate = rootRoute.useNavigate();
    return (
      <PatientsPage
        search={search}
        onSearch={(next) => {
          void navigate({ search: next });
        }}
      />
    );
  }
  const router = createRouter({
    routeTree: rootRoute,
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
});
