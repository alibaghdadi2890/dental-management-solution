import type { Permission, VisitBalance, VisitListItem } from '@dcm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { ToastProvider } from '@/components/ui/toast';
import { sessionQueryOptions } from '@/features/auth/session';
import { sessionWith } from '@/features/patients/patients.test-utils';
import { VisitDetailPanel } from './visit-detail-panel';

const id = (n: number) => `01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d${String(n).padStart(2, '0')}`;
const usd = (amount: string) => ({ amount, currency: 'USD' });

const VISIT: VisitListItem = {
  id: id(1),
  displayNumber: 42,
  type: 'treatment',
  currentStep: 'complete',
  reason: null,
  status: 'completed',
  localDate: '2026-09-04',
  startedAt: '2026-09-04T09:00:00.000Z',
  completedAt: '2026-09-04T09:45:00.000Z',
  durationMinutes: 45,
  pausedAt: null,
  pausedSeconds: 0,
  branchId: id(2),
  room: { id: id(3), name: 'Room 1' },
  patient: { id: id(4), displayNumber: 'P-000004', fullName: 'Rana Haddad' },
  dentist: { id: id(5), name: 'Dr. Ana Reyes' },
  services: [
    {
      id: id(6),
      code: 'FIL',
      name: 'Composite filling',
      chargeUnit: 'per_tooth',
      toothCode: '16',
      jaw: null,
      surfaces: ['O'],
      planId: null,
      final: usd('80.00'),
    },
    {
      id: id(7),
      code: 'SCL',
      name: 'Scaling',
      chargeUnit: 'per_mouth',
      toothCode: null,
      jaw: null,
      surfaces: [],
      planId: null,
      final: usd('60.00'),
    },
  ],
  notes: '',
  discount: { mode: 'percent', value: '0.00' },
  currency: 'USD',
  subtotal: '140.00',
  discountAmount: '0.00',
  total: '140.00',
  amendmentCount: 0,
  imported: false,
  checkedOutAt: null,
  voidedAt: null,
  voidReason: null,
  updatedAt: '2026-09-04T09:45:00.000Z',
  serverNow: '2026-09-04T10:00:00.000Z',
};

const balance = (paid: string): VisitBalance => ({
  visitId: VISIT.id,
  currency: 'USD',
  charged: '140.00',
  paid,
  paidByPayments: paid,
  outstanding: (140 - Number(paid)).toFixed(2),
});

const IMPLANT = {
  id: id(8),
  code: 'IMP',
  name: 'Implant',
  category: null,
  chargeUnit: 'per_tooth',
  price: usd('900.00'),
  frequent: false,
  active: true,
  toothEffect: 'none',
  color: 'blue',
  icon: null,
  markPriority: 5,
  addedOnVisitType: null,
  typicalSessions: null,
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function mockApi() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace('/api/v1', '').split('?')[0];
    if (init?.method === 'POST') {
      return Promise.resolve(json({ visit: {} }, 200));
    }
    if (path === '/audit') return Promise.resolve(json({ items: [], nextCursor: null }));
    if (path === '/catalog/services') return Promise.resolve(json([IMPLANT]));
    return Promise.resolve(json([]));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPanel(permissions: Permission[], paid = '0.00') {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(sessionQueryOptions().queryKey, sessionWith(permissions));
  const rootRoute = createRootRoute({
    component: () => (
      <VisitDetailPanel
        visit={VISIT}
        balance={balance(paid)}
        canPay
        timeZone="Asia/Beirut"
        locale="en"
        onClose={() => undefined}
      />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/patients/$patientId',
        component: () => null,
      }),
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/payments',
        component: () => null,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
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

const DENTIST: Permission[] = [
  'visit:read',
  'visit:write',
  'visit:amend',
  'visit:void',
  'payment:read',
];
const FRONT_DESK: Permission[] = ['visit:read', 'payment:read', 'payment:write'];
const ASSISTANT: Permission[] = ['visit:read', 'visit:write', 'payment:read'];

describe('VisitDetailPanel', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('gives a dentist Void and Correct visit, front desk "Request a change", an assistant neither', async () => {
    mockApi();
    renderPanel(DENTIST);
    expect(await screen.findByRole('button', { name: 'Void' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Correct visit' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Request a change' })).toBeNull();
    cleanup();

    renderPanel(FRONT_DESK);
    fireEvent.click(await screen.findByRole('button', { name: 'Request a change' }));
    expect(await screen.findByText('Ask Dr. Ana Reyes to correct or void this visit')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Void' })).toBeNull();
    cleanup();

    renderPanel(ASSISTANT);
    await screen.findByText('Composite filling');
    for (const name of ['Void', 'Correct visit', 'Request a change']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  it('asks for a reason to void, and sends it with the visit version', async () => {
    const fetchMock = mockApi();
    renderPanel(DENTIST);
    fireEvent.click(await screen.findByRole('button', { name: 'Void' }));
    expect(await screen.findByText('Void V-000042?')).toBeTruthy();
    const ok = screen.getByRole('button', { name: 'Void visit' });
    expect((ok as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason for voiding'), {
      target: { value: 'Wrong patient' },
    });
    fireEvent.click(ok);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => url.endsWith('/void'));
      expect(JSON.parse(call?.[1]?.body as string)).toEqual({
        expectedUpdatedAt: VISIT.updatedAt,
        reason: 'Wrong patient',
      });
    });
  });

  it('corrects the times alone: the same form, a reason, and the services as they are', async () => {
    const fetchMock = mockApi();
    renderPanel(DENTIST);
    fireEvent.click(await screen.findByRole('button', { name: 'Correct visit' }));
    // 09:00–09:45 UTC is 12:00–12:45 in Beirut.
    const start = screen.getByLabelText('Start');
    expect((start as HTMLInputElement).value).toBe('12:00');
    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save correction' });
    expect(save.disabled).toBe(true);

    fireEvent.change(start, { target: { value: '11:30' } });
    expect(screen.getByText('Duration 45 min → 75 min')).toBeTruthy();
    fireEvent.click(save);
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/the services and money stay/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Reason for the correction'), {
      target: { value: 'Timer started late' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save correction' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => url.endsWith('/amend'));
      expect(JSON.parse(call?.[1]?.body as string)).toEqual({
        expectedUpdatedAt: VISIT.updatedAt,
        reason: 'Timer started late',
        discount: { mode: 'percent', value: '0.00' },
        services: [{ id: id(6), toothCode: '16', surfaces: ['O'] }, { id: id(7) }],
        times: { startedAt: '2026-09-04T08:30:00.000Z', completedAt: VISIT.completedAt },
      });
    });
  });

  it('replaces a service from the catalog; a price is typed only with visit:discount', async () => {
    const fetchMock = mockApi();
    renderPanel(DENTIST);
    fireEvent.click(await screen.findByRole('button', { name: 'Correct visit' }));
    expect(screen.queryByLabelText('Price of Composite filling')).toBeNull();
    cleanup();

    renderPanel([...DENTIST, 'visit:discount']);
    fireEvent.click(await screen.findByRole('button', { name: 'Correct visit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Composite filling' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add service' }));
    fireEvent.change(await screen.findByLabelText('Search the catalog for a service to add'), {
      target: { value: 'impl' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /Implant/ }));
    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save correction' });
    expect(screen.getByText('Enter a tooth and only surfaces it has.')).toBeTruthy();
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Tooth of Implant'), { target: { value: '16' } });
    fireEvent.change(screen.getByLabelText('Price of Implant'), { target: { value: '850' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.change(within(dialog).getByLabelText('Reason for the correction'), {
      target: { value: 'Wrong service picked' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save correction' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => url.endsWith('/amend'));
      expect(JSON.parse(call?.[1]?.body as string)).toEqual({
        expectedUpdatedAt: VISIT.updatedAt,
        reason: 'Wrong service picked',
        discount: { mode: 'percent', value: '0.00' },
        services: [
          { id: id(7) },
          { procedureId: IMPLANT.id, toothCode: '16', surfaces: [], price: '850' },
        ],
      });
    });
  });

  it('says to refund payments first when the visit has some, and goes to its payments', async () => {
    const fetchMock = mockApi();
    const router = renderPanel(DENTIST, '40.00');
    fireEvent.click(await screen.findByRole('button', { name: 'Void' }));
    expect(await screen.findByText('Refund payments first')).toBeTruthy();
    expect(screen.queryByLabelText('Reason for voiding')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Go to payments' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/payments');
    });
    expect(router.state.location.search).toMatchObject({ q: 'V-000042', range: 'all' });
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/void'))).toBe(false);
  });

  it('blocks Save on a tooth that does not parse, until that service is removed', async () => {
    mockApi();
    renderPanel(DENTIST);
    fireEvent.click(await screen.findByRole('button', { name: 'Correct visit' }));
    fireEvent.change(screen.getByLabelText('Tooth of Composite filling'), {
      target: { value: '99' },
    });
    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save correction' });
    expect(screen.getByText('Enter a tooth and only surfaces it has.')).toBeTruthy();
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Composite filling' }));
    expect(save.disabled).toBe(false);
  });

  it('corrects: Save waits for a change, then shows before → after and needs a reason', async () => {
    const fetchMock = mockApi();
    renderPanel(DENTIST);
    fireEvent.click(await screen.findByRole('button', { name: 'Correct visit' }));
    const save = screen.getByRole<HTMLButtonElement>('button', { name: 'Save correction' });
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Scaling' }));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(
      await screen.findByText(
        'Total changes $140 → $80. The patient gets $60 credit. The original is kept in the audit trail.',
      ),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Reason for the correction'), {
      target: { value: 'Scaling not done' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save correction' }).at(-1)!);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => url.endsWith('/amend'));
      expect(JSON.parse(call?.[1]?.body as string)).toEqual({
        expectedUpdatedAt: VISIT.updatedAt,
        reason: 'Scaling not done',
        discount: { mode: 'percent', value: '0.00' },
        services: [{ id: id(6), toothCode: '16', surfaces: ['O'] }],
      });
    });
  });
});
