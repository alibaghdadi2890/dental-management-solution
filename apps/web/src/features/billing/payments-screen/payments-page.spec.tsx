import type { Permission, Receivables, Transaction } from '@dcm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { ToastProvider } from '@/components/ui/toast';
import { sessionQueryOptions } from '@/features/auth/session';
import { json, sessionWith } from '@/features/patients/patients.test-utils';
import { PaymentsPage } from './payments-page';
import { parsePaymentsSearch } from './payments-search';

const id = (n: number) => `01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d${String(n).padStart(2, '0')}`;

const PAYMENT: Transaction = {
  id: id(1),
  kind: 'payment',
  receiptNumber: 12,
  paidAt: '2026-09-30',
  patient: { id: id(2), fullName: 'Rana Haddad', displayNumber: 'P-000002' },
  householdGroupId: null,
  method: 'card',
  amount: '120.00',
  currency: 'USD',
  reference: null,
  note: null,
  reason: null,
  reversesPaymentId: null,
  partial: true,
  refunded: '0.00',
  voided: false,
  visits: [{ visitId: id(3), visitNumber: 42 }],
  recordedBy: { userId: id(4), name: 'Jamie Ortiz' },
  recordedAt: '2026-09-30T09:00:00.000Z',
};

const AGING: Receivables = {
  currency: 'USD',
  collected30d: '120.00',
  refunds30d: '0.00',
  outstanding: '80.00',
  buckets: [
    { bucket: 'd0_30', amount: '80.00', patients: 1 },
    { bucket: 'd31_60', amount: '0.00', patients: 0 },
    { bucket: 'd61_90', amount: '0.00', patients: 0 },
    { bucket: 'd90_plus', amount: '0.00', patients: 0 },
  ],
};

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const path = url.replace('/api/v1', '').split('?')[0];
      if (path === '/billing/aging') return Promise.resolve(json(AGING));
      if (path === '/billing/outstanding') {
        return Promise.resolve(
          json({
            items: [
              {
                patient: { id: id(5), fullName: 'Sami Haddad', displayNumber: 'P-000005' },
                payer: { contactId: id(6), name: 'Karim Haddad', patientId: null },
                members: [
                  { id: id(5), fullName: 'Sami Haddad', displayNumber: 'P-000005' },
                  { id: id(2), fullName: 'Rana Haddad', displayNumber: 'P-000002' },
                ],
                payFor: id(5),
                oldestUnpaid: '2026-08-01',
                bucket: 'd61_90',
                openVisits: 2,
                balance: '200.00',
                currency: 'USD',
              },
            ],
            nextCursor: null,
          }),
        );
      }
      if (path === '/billing/payments') {
        return Promise.resolve(json({ items: [PAYMENT], nextCursor: null }));
      }
      return Promise.resolve(json([]));
    }),
  );
}

function renderPage(permissions: Permission[], raw: Record<string, unknown> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(sessionQueryOptions().queryKey, sessionWith(permissions));
  const onSearch = vi.fn();
  const rootRoute = createRootRoute({
    component: () => <PaymentsPage search={parsePaymentsSearch(raw)} onSearch={onSearch} />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/patients/$patientId',
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
  return { onSearch };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the Payments screen (feature 5 §Screens 2)', () => {
  it('lets a dentist refund or void a payment', async () => {
    mockApi();
    renderPage(['payment:read', 'payment:write', 'payment:refund', 'patient:read']);
    expect(await screen.findByText('Rana Haddad')).toBeTruthy();
    expect(screen.getByText('· partial')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Refund' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Void payment' })).toBeTruthy();
    expect(screen.queryByText('Ask a dentist to refund')).toBeNull();
  });

  it('shows front desk who to ask instead of refund and void', async () => {
    mockApi();
    renderPage(['payment:read', 'payment:write', 'patient:read']);
    expect(await screen.findByText('Rana Haddad')).toBeTruthy();
    expect(screen.getByText('Ask a dentist to refund')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Refund' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Void payment' })).toBeNull();
  });

  it('a bucket button switches to Outstanding on that bucket', async () => {
    mockApi();
    const { onSearch } = renderPage(['payment:read']);
    fireEvent.click(await screen.findByRole('button', { name: /0–30 days/ }));
    expect(onSearch).toHaveBeenCalledWith(
      expect.objectContaining({ tab: 'outstanding', bucket: 'd0_30' }),
    );
  });

  it('groups Outstanding by payer: one family row with its members', async () => {
    mockApi();
    renderPage(['payment:read', 'patient:read'], { tab: 'outstanding', group: 'payer' });
    expect(await screen.findByText('Karim Haddad · family')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sami Haddad' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Rana Haddad' })).toBeTruthy();
    expect(screen.getByText('$200')).toBeTruthy();
  });
});
