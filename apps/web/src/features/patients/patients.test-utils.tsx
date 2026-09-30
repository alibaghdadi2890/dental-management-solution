import type {
  AuditEntry,
  BalanceMoney,
  ContactLookupItem,
  Patient,
  PatientContact,
  PatientListItem,
  Permission,
  Session,
} from '@dcm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useNavigate,
  useSearch,
} from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import '@/lib/i18n';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { ToastProvider } from '@/components/ui/toast';
import { sessionQueryOptions } from '@/features/auth/session';
import { parsePatientsSearch } from './list-query';
import { PatientsScreen } from './patients-screen';
import { PatientRecordScreen } from './record/patient-record-page';
import { parseRecordSearch } from './record/record-search';

/** Test-only: shared by the panel specs — fixtures, an API mock, and the route's own wiring
 * (`PatientsScreen`) on a memory router. */

export const id = (n: number) => `01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d${String(n).padStart(2, '0')}`;
/** A distinct-looking uuid for a staff profile id, so fixtures never reuse the auth user id as
 * the profile id (they are different ids in the real schema). */
export const profileId = (userId: string) => userId.replace('4c5d', '4c5e');
export const DENTIST_ID = id(80);
export const INACTIVE_DENTIST_ID = id(81);
export const FRONT_DESK_ID = id(82);

export function patient(n: number, fullName: string, extra: Partial<Patient> = {}): Patient {
  return {
    id: id(n),
    displayNumber: `P-${String(n).padStart(6, '0')}`,
    fullName,
    phone: '+9613123456',
    dateOfBirth: '1990-05-01',
    sex: 'female',
    email: null,
    address: null,
    insurance: null,
    medicalAlerts: [],
    primaryDentistId: null,
    notes: null,
    dentitionOverride: null,
    externalId: null,
    archivedAt: null,
    mergedIntoId: null,
    createdAt: '2026-01-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    ...extra,
  };
}

export const listItem = (p: Patient): PatientListItem => ({
  id: p.id,
  displayNumber: p.displayNumber,
  fullName: p.fullName,
  phone: p.phone,
  dateOfBirth: p.dateOfBirth,
  sex: p.sex,
  medicalAlerts: p.medicalAlerts,
  primaryDentistId: p.primaryDentistId,
  email: p.email,
  archivedAt: p.archivedAt,
  updatedAt: p.updatedAt,
  primaryGuardian: null,
  matchedContact: null,
});

/** A contact link of a patient: by default an unlinked contact who is the primary guardian. */
export function patientContact(
  n: number,
  fullName: string,
  extra: Partial<PatientContact> = {},
): PatientContact {
  return {
    contact: { id: id(n), fullName, phone: '+9613987654', email: null, linkedPatient: null },
    relationship: 'parent',
    isGuardian: true,
    isBillingContact: false,
    isEmergencyContact: false,
    isPrimaryGuardian: true,
    isPrimaryBilling: false,
    isPrimaryEmergency: false,
    ...extra,
  };
}

export const ALL_PERMISSIONS: Permission[] = [
  'patient:read',
  'patient:write',
  'payment:read',
  'payment:write',
  'user:read',
  'audit:read',
];

export function sessionWith(permissions: Permission[]): Session {
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
      chartMode: 'surface',
      toothNotation: 'fdi',
      chartOrientation: 'patient_right_on_right',
    },
    branch: null,
    branches: [],
    roleNames: [],
    permissions,
    idleTimeoutSeconds: 900,
  };
}

const staff = (userId: string, displayName: string, active: boolean) => ({
  id: userId,
  profileId: profileId(userId),
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

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status < 400 ? 'application/json' : 'application/problem+json' },
  });

export const problem = (
  status: number,
  code: string,
  errors?: { path: string; code: string; message: string }[],
) =>
  json(
    {
      type: 'about:blank',
      title: status === 409 ? 'Conflict' : 'Unprocessable Entity',
      status,
      code,
      ...(errors ? { errors } : {}),
    },
    status,
  );

export interface MockApi {
  patients?: Patient[];
  balances?: Record<string, BalanceMoney[]>;
  audit?: Record<string, AuditEntry[]>;
  /** `GET /patients/:id/contacts` per patient id (none by default). */
  contacts?: Record<string, PatientContact[]>;
  /** `GET /contacts/lookup` answer, whatever the query. */
  lookup?: ContactLookupItem[];
  /** `GET /patients/duplicates/check` answer. */
  twins?: PatientListItem[];
  /** Overrides a mutation's answer (`POST /patients`, `PATCH /patients/:id`, …); a pending
   * promise keeps the save in flight. */
  mutation?: (
    method: string,
    path: string,
    body: unknown,
  ) => Response | Promise<Response> | undefined;
  /** Overrides a `GET` answer (full path, query string included); a pending promise keeps the
   * read loading. */
  get?: (path: string) => Response | Promise<Response> | undefined;
}

type FetchMock = ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;

/** Answers every request the page and its panels make; returns the fetch mock. */
export function mockApi({
  patients = [],
  balances = {},
  audit = {},
  contacts = {},
  lookup = [],
  twins = [],
  mutation,
  get,
}: MockApi = {}): FetchMock {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace('/api/v1', '');
    const method = init?.method ?? 'GET';
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const bare = path.split('?')[0] ?? path;

    if (method !== 'GET') {
      const custom = mutation?.(method, bare, body);
      if (custom) return Promise.resolve(custom);
      if (bare === '/patients') {
        return Promise.resolve(json(patient(50, 'Created Patient'), 201));
      }
      if (bare === '/billing/opening-balances') {
        const created = patient(50, 'Created Patient');
        return Promise.resolve(
          json({ patient: created, balance: { patientId: created.id, balances: [] } }, 201),
        );
      }
      if (bare === '/patients/merge') {
        const { keepId } = body as { keepId: string };
        return Promise.resolve(json(patients.find((p) => p.id === keepId)));
      }
      // The contact actions answer the patient's contacts: as they are (link, patch), or
      // without the one unlinked; a spec's `mutation` answers what the change made.
      const link = /^\/patients\/([^/]+)\/contacts(?:\/([^/]+))?$/.exec(bare);
      if (link) {
        const [, patientId = '', contactId] = link;
        const current = contacts[patientId] ?? [];
        if (method === 'DELETE') {
          return Promise.resolve(json(current.filter((c) => c.contact.id !== contactId)));
        }
        return Promise.resolve(json(current, method === 'POST' ? 201 : 200));
      }
      const edited = /^\/patients\/([^/]+)$/.exec(bare)?.[1];
      const found = patients.find((p) => p.id === edited);
      if (method === 'PATCH' && found) return Promise.resolve(json(found));
      return Promise.resolve(problem(404, 'not_found'));
    }

    const custom = get?.(path);
    if (custom) return Promise.resolve(custom);
    if (bare === '/patients/counts') {
      return Promise.resolve(json({ active: 0, notSeen: 0, archived: 0 }));
    }
    if (bare === '/billing/patients/owing-count') return Promise.resolve(json({ count: 0 }));
    if (bare === '/patients/duplicates') return Promise.resolve(json([]));
    if (bare === '/patients/duplicates/check') return Promise.resolve(json(twins));
    if (bare === '/users/practitioners') {
      return Promise.resolve(
        json([
          {
            id: profileId(DENTIST_ID),
            userId: DENTIST_ID,
            displayName: 'Dr. Ana Reyes',
            title: null,
          },
        ]),
      );
    }
    if (bare === '/users') {
      return Promise.resolve(
        json([
          staff(DENTIST_ID, 'Dr. Ana Reyes', true),
          staff(INACTIVE_DENTIST_ID, 'Dr. Marcus Lee', false),
          staff(FRONT_DESK_ID, 'Jamie Ortiz', true),
        ]),
      );
    }
    if (bare === '/billing/balances') return Promise.resolve(json([]));
    if (bare === '/contacts/lookup') return Promise.resolve(json(lookup));
    const contactsOf = /^\/patients\/([^/]+)\/contacts$/.exec(bare)?.[1];
    if (contactsOf) return Promise.resolve(json(contacts[contactsOf] ?? []));
    if (bare === '/patients' || bare === '/billing/patients') {
      return Promise.resolve(json({ items: [], total: 0, page: 1, size: 25 }));
    }
    if (bare === '/audit') {
      const resourceId = new URLSearchParams(path.split('?')[1]).get('resourceId') ?? '';
      return Promise.resolve(json({ items: audit[resourceId] ?? [], nextCursor: null }));
    }
    const balanceOf = /^\/billing\/patients\/([^/]+)\/balance$/.exec(bare)?.[1];
    if (balanceOf) {
      return Promise.resolve(json({ patientId: balanceOf, balances: balances[balanceOf] ?? [] }));
    }
    const detail = /^\/patients\/([^/]+)$/.exec(bare)?.[1];
    const found = patients.find((p) => p.id === detail);
    if (found) return Promise.resolve(json(found));
    return Promise.resolve(problem(404, 'patient.not_found'));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The JSON body of the (last) call to `method path`, or `undefined` when there was none. */
export function sent(fetchMock: FetchMock, method: string, path: string): unknown {
  const call = fetchMock.mock.calls.findLast(
    ([url, init]) => url === `/api/v1${path}` && (init?.method ?? 'GET') === method,
  );
  const body = call?.[1]?.body;
  return typeof body === 'string' ? JSON.parse(body) : undefined;
}

/** Renders `/patients` exactly as the route does (`PatientsScreen`), at `url`. */
export function renderPanels({
  url,
  permissions = ALL_PERMISSIONS,
}: {
  url: string;
  permissions?: Permission[];
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(sessionQueryOptions().queryKey, sessionWith(permissions));
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

/**
 * Renders the patient record at `url` (after `before`, earlier history entries) with the real
 * `/patients` list beside it, both wired as their routes are (`PatientRecordScreen`,
 * `PatientsScreen`), plus a stand-in `/visits`. Returns
 * the router and the query client.
 */
export function renderRecord({
  url,
  before = [],
  permissions = ALL_PERMISSIONS,
}: {
  url: string;
  before?: string[];
  permissions?: Permission[];
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(sessionQueryOptions().queryKey, sessionWith(permissions));
  const rootRoute = createRootRoute({ component: Outlet });
  function ListRoute() {
    const search = parsePatientsSearch(useSearch({ strict: false }));
    const navigate = useNavigate();
    return (
      <PatientsScreen
        search={search}
        navigate={(navigation) => {
          void navigate({ to: '/patients', ...navigation });
        }}
      />
    );
  }
  const recordRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/patients/$patientId',
    validateSearch: (search: Record<string, unknown>) => parseRecordSearch(search),
    component: RecordRoute,
  });
  function RecordRoute() {
    const { patientId } = recordRoute.useParams();
    const { tab, panel } = recordRoute.useSearch();
    return <PatientRecordScreen patientId={patientId} tab={tab} panel={panel} />;
  }
  const routeTree = rootRoute.addChildren([
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/patients',
      validateSearch: (search: Record<string, unknown>) => parsePatientsSearch(search),
      component: ListRoute,
    }),
    recordRoute,
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/visits',
      component: () => <p>{'Visits screen'}</p>,
    }),
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [...before, url] }),
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
  return { router, client };
}

/** Opens the create panel the way the shell's "New patient" / palette "Create …" does: the
 * pre-fill rides in history state, never in the URL. */
export function prefilled(
  router: ReturnType<typeof renderPanels>,
  prefill: { fullName?: string; phone?: string },
) {
  return router.navigate({ to: '/', search: { panel: 'new' }, state: { patientPrefill: prefill } });
}
