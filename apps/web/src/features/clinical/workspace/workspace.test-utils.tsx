import type { Patient, PatientChart, Permission, Visit } from '@dcm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { vi } from 'vitest';
import '@/lib/i18n';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { ToastProvider } from '@/components/ui/toast';
import { sessionQueryOptions } from '@/features/auth/session';
import {
  DENTIST_ID,
  id,
  json,
  patient,
  problem,
  profileId,
  sessionWith,
} from '@/features/patients/patients.test-utils';
import { VisitWorkspaceScreen } from './visit-workspace-page';

/** Test-only: the workspace's fixtures, an API mock and the `/visits/$visitId` route's wiring on
 * a memory router, with a stand-in patient record to land on. */

export const VISIT_ID = id(60);
/** Aged 8 on the fixture's `serverNow` date: a mixed dentition. */
export const RANA = patient(1, 'Rana Haddad', {
  dateOfBirth: '2018-03-01',
  medicalAlerts: ['Penicillin allergy'],
});

export const DENTIST_WRITE: Permission[] = ['patient:read', 'visit:read', 'visit:write'];
export const FRONT_DESK: Permission[] = ['patient:read', 'visit:read'];

export function visit(extra: Partial<Visit> = {}): Visit {
  return {
    id: VISIT_ID,
    patientId: RANA.id,
    branchId: id(70),
    roomId: null,
    dentistId: profileId(DENTIST_ID),
    startedBy: DENTIST_ID,
    status: 'in_progress',
    localDate: '2026-09-04',
    startedAt: '2026-09-04T09:00:00.000Z',
    pausedAt: null,
    pausedSeconds: 0,
    completedAt: null,
    durationMinutes: null,
    notes: '',
    discountMode: 'percent',
    discountValue: '0.00',
    currency: 'USD',
    services: [],
    money: { subtotal: '0.00', discount: '0.00', total: '0.00', capped: false },
    serverNow: '2026-09-04T09:12:05.000Z',
    ...extra,
  };
}

export function chart(extra: Partial<PatientChart> = {}): PatientChart {
  return {
    dentition: { stage: 'mixed', source: 'auto', ageYears: 8 },
    toothStatus: [],
    diagnoses: [],
    plans: [],
    history: [],
    liveVisitId: VISIT_ID,
    teeth: [],
    ...extra,
  };
}

type Answer = Response | Promise<Response> | undefined;

export interface WorkspaceApi {
  visit?: Visit | null;
  patient?: Patient;
  chart?: PatientChart;
  /** Overrides a mutation's answer; `undefined` falls back to the default. */
  mutation?: (method: string, path: string, body: unknown) => Answer;
}

const LIFECYCLE = ['pause', 'resume', 'discard'] as const;

type FetchMock = ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>;

/** Answers the workspace's reads and lifecycle writes; returns the fetch mock. `visit: null`
 * answers the visit with a 404. */
export function mockWorkspace({
  visit: current = visit(),
  patient: record = RANA,
  chart: charted = chart(),
  mutation,
}: WorkspaceApi = {}): FetchMock {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const path = (url.replace('/api/v1', '').split('?')[0] ?? '').replace(/\/$/, '');
    const method = init?.method ?? 'GET';
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;

    if (method !== 'GET') {
      const custom = mutation?.(method, path, body);
      if (custom) return Promise.resolve(custom);
      const action = /^\/visits\/[^/]+\/(pause|resume|discard)$/.exec(path)?.[1];
      const lifecycle = LIFECYCLE.find((known) => known === action);
      if (lifecycle && current) {
        const status = { pause: 'paused', resume: 'in_progress', discard: 'discarded' } as const;
        const pausedAt = lifecycle === 'pause' ? current.serverNow : null;
        return Promise.resolve(
          json({ visit: { ...current, status: status[lifecycle], pausedAt } }),
        );
      }
      if (path === `/patients/${record.id}/dentition`) {
        const { override } = body as { override: Patient['dentitionOverride'] };
        return Promise.resolve(json({ ...record, dentitionOverride: override }));
      }
      return Promise.resolve(problem(404, 'not_found'));
    }

    if (path === `/visits/${VISIT_ID}`) {
      return Promise.resolve(current ? json(current) : problem(404, 'visit.not_found'));
    }
    if (path === `/patients/${record.id}`) return Promise.resolve(json(record));
    if (path === `/clinical/patients/${record.id}/chart`) return Promise.resolve(json(charted));
    if (path === '/users/practitioners') {
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
    return Promise.resolve(problem(404, 'not_found'));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The (last) `method path` call's JSON body, `null` for a call without one, or `undefined` when
 * there was no such call. */
export function sent(fetchMock: FetchMock, method: string, path: string): unknown {
  const call = fetchMock.mock.calls.findLast(
    ([url, init]) => url === `/api/v1${path}` && (init?.method ?? 'GET') === method,
  );
  if (!call) return undefined;
  const body = call[1]?.body;
  return typeof body === 'string' ? JSON.parse(body) : null;
}

/** Renders `/visits/<id>` as the route does (`VisitWorkspaceScreen`), plus a stand-in record. */
export function renderWorkspace({
  permissions = DENTIST_WRITE,
}: { permissions?: Permission[] } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(sessionQueryOptions().queryKey, sessionWith(permissions));
  const rootRoute = createRootRoute({ component: Outlet });
  const visitRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/visits/$visitId',
    component: VisitRoute,
  });
  function VisitRoute() {
    const { visitId } = visitRoute.useParams();
    return <VisitWorkspaceScreen visitId={visitId} />;
  }
  const recordRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/patients/$patientId',
    component: RecordRoute,
  });
  function RecordRoute() {
    const { patientId } = recordRoute.useParams();
    return (
      <p>
        {'Record '}
        {patientId}
      </p>
    );
  }
  const router = createRouter({
    routeTree: rootRoute.addChildren([visitRoute, recordRoute]),
    history: createMemoryHistory({ initialEntries: [`/visits/${VISIT_ID}`] }),
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
