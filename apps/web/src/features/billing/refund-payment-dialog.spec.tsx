import type { PatientAccount, PaymentHistoryItem } from '@dcm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';
import { ToastProvider } from '@/components/ui/toast';
import { sessionQueryOptions } from '@/features/auth/session';
import { json, sessionWith } from '@/features/patients/patients.test-utils';
import { RefundPaymentDialog } from './refund-payment-dialog';

const id = (n: number) => `01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d${String(n).padStart(2, '0')}`;

const payment = (n: number, extra: Partial<PaymentHistoryItem> = {}): PaymentHistoryItem => ({
  id: id(n),
  kind: 'payment',
  receiptNumber: n,
  paidAt: '2026-09-01',
  patient: { id: id(1), fullName: 'Rana Haddad', displayNumber: 'P-0001' },
  householdGroupId: null,
  method: 'cash',
  amount: '120.00',
  currency: 'USD',
  reference: null,
  note: null,
  reason: null,
  reversesPaymentId: null,
  partial: false,
  refunded: '0.00',
  voided: false,
  visits: [],
  recordedBy: { userId: id(90), name: null },
  recordedAt: '2026-09-01T09:00:00.000Z',
  advance: null,
  heldUnspent: '0.00',
  releasedAt: null,
  allocations: [],
  remaining: '0.00',
  ...extra,
});

const ACCOUNT: PatientAccount = {
  patientId: id(1),
  currency: 'USD',
  balance: '0.00',
  credit: '0.00',
  held: '0.00',
  planRemaining: null,
  lastVisit: null,
  previousOutstanding: '0.00',
  openCharges: [],
  payer: { contactId: null, name: 'Rana Haddad', patientId: null },
  payers: [],
  household: null,
  payerFor: null,
  history: [
    payment(43, { amount: '120.00', refunded: '20.00' }),
    payment(42, { refunded: '120.00' }),
    payment(41, { voided: true }),
    payment(40, { kind: 'refund', amount: '20.00' }),
  ],
  adjustments: [],
};

function renderDialog() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace('/api/v1', '').split('?')[0];
    if (path === `/billing/patients/${id(1)}/account`) return Promise.resolve(json(ACCOUNT));
    if (path === `/billing/payments/${id(43)}/refund` && init?.method === 'POST') {
      return Promise.resolve(json({ ids: [id(50)] }, 201));
    }
    return Promise.resolve(json([]));
  });
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(
    sessionQueryOptions().queryKey,
    sessionWith(['payment:read', 'payment:refund']),
  );
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <RefundPaymentDialog patientId={id(1)} locale="en" onClose={onClose} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { fetchMock, onClose };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Refund a payment from the patient record (ADR-0064)', () => {
  it('lists the payments, newest first, with nothing left to refund disabled', async () => {
    renderDialog();
    const rows = await screen.findAllByRole<HTMLButtonElement>('button', { name: /^RCT-/ });
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Refunded $20'),
      expect.stringContaining('Fully refunded'),
      expect.stringContaining('Voided'),
    ]);
    expect(rows.map((row) => row.disabled)).toEqual([false, true, true]);
  });

  it('refunds part of the picked payment, and Back returns to the list', async () => {
    const { fetchMock, onClose } = renderDialog();
    const [first] = await screen.findAllByRole('button', { name: /^RCT-/ });
    fireEvent.click(first!);
    const amount = await screen.findByLabelText('Amount to refund');
    expect((amount as HTMLInputElement).value).toBe('100.00');

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click((await screen.findAllByRole('button', { name: /^RCT-/ }))[0]!);

    fireEvent.change(await screen.findByLabelText('Amount to refund'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'Treatment stopped' } });
    fireEvent.click(screen.getByRole('button', { name: /^Refund/ }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    const call = fetchMock.mock.calls.find(([url]) => url.endsWith(`/payments/${id(43)}/refund`));
    expect(JSON.parse(call?.[1]?.body as string)).toMatchObject({
      amount: '30.00',
      reason: 'Treatment stopped',
      method: 'cash',
    });
  });
});
