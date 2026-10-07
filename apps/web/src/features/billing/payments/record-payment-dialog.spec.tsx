import type { PatientAccount, RecordPaymentResult } from '@dcm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';
import { ToastProvider } from '@/components/ui/toast';
import { sessionQueryOptions } from '@/features/auth/session';
import { json, sessionWith } from '@/features/patients/patients.test-utils';
import { RecordPaymentDialog } from './record-payment-dialog';

const id = (n: number) => `01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d${String(n).padStart(2, '0')}`;

const ACCOUNT: PatientAccount = {
  patientId: id(1),
  currency: 'USD',
  balance: '300.00',
  credit: '0.00',
  lastVisit: null,
  previousOutstanding: '300.00',
  openCharges: [
    {
      entryId: id(10),
      patientId: id(1),
      kind: 'visit_charge',
      visitId: id(20),
      visitNumber: 12,
      date: '2026-09-01',
      charged: '300.00',
      paid: '0.00',
      outstanding: '300.00',
    },
  ],
  payer: { contactId: null, name: 'Rana Haddad', patientId: null },
  payers: [],
  household: null,
  payerFor: null,
  history: [],
  adjustments: [],
};

const RESULT: RecordPaymentResult = {
  receiptNumber: 7,
  paymentIds: [id(30)],
  householdGroupId: null,
  amount: '300.00',
  currency: 'USD',
  remaining: '0.00',
  allocations: [],
};

function mockApi(account: PatientAccount = ACCOUNT) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace('/api/v1', '').split('?')[0];
    if (path === '/billing/payments' && init?.method === 'POST') {
      return Promise.resolve(json(RESULT, 201));
    }
    if (path === `/billing/patients/${id(1)}/account`) return Promise.resolve(json(account));
    return Promise.resolve(json([]));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderDialog(onRecorded = vi.fn(), onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const session = sessionWith(['payment:read', 'payment:write']);
  client.setQueryData(sessionQueryOptions().queryKey, session);
  const tenant = session.tenant;
  if (!tenant) throw new Error('session without tenant');
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <RecordPaymentDialog
          options={{ patientId: id(1), contextVisitId: id(20), onRecorded }}
          tenant={tenant}
          onClose={onClose}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { onRecorded, onClose };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Record payment (spec §Record Payment)', () => {
  it('starts empty with the outstanding as placeholder; the chips and cap drive the submit label', async () => {
    mockApi();
    renderDialog();
    const amount = await screen.findByLabelText('Amount taken now');
    expect((amount as HTMLInputElement).value).toBe('');
    expect((amount as HTMLInputElement).placeholder).toBe('300.00');
    expect(
      screen.getByText('Applied to this visit first, then to the oldest unpaid charge.'),
    ).toBeTruthy();
    const submit = () => screen.getByRole<HTMLButtonElement>('button', { name: /^Record/ });
    expect(submit().disabled).toBe(true);

    fireEvent.change(amount, { target: { value: '300.01' } });
    expect(screen.getByText('The amount can’t be more than the $300 owed.')).toBeTruthy();
    expect(submit().disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Half $150' }));
    expect(submit().textContent).toBe('Record payment');

    fireEvent.click(screen.getByRole('button', { name: 'Full amount $300' }));
    expect(submit().textContent).toBe('Record full payment');
  });

  it('posts the payment with an Idempotency-Key, the context visit and the method', async () => {
    const fetchMock = mockApi();
    const { onRecorded, onClose } = renderDialog();
    fireEvent.change(await screen.findByLabelText('Amount taken now'), {
      target: { value: '300' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Card' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record full payment' }));
    await waitFor(() => {
      expect(onRecorded).toHaveBeenCalledWith(RESULT);
    });
    expect(onClose).toHaveBeenCalled();
    const post = fetchMock.mock.calls.find(
      ([url, init]) => url === '/api/v1/billing/payments' && init?.method === 'POST',
    );
    const init = post?.[1];
    expect(new Headers(init?.headers).get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(typeof init?.body === 'string' ? init.body : '')).toMatchObject({
      patientId: id(1),
      amount: '300.00',
      method: 'card',
      scope: 'patient',
      contextVisitId: id(20),
    });
    expect(await screen.findByText('$300 recorded')).toBeTruthy();
  });

  it('offers the household when the payer bills for several patients', async () => {
    mockApi({
      ...ACCOUNT,
      payer: { contactId: id(2), name: 'Karim Haddad', patientId: null },
      payers: [{ contactId: id(2), name: 'Karim Haddad', patientId: null }],
      household: {
        payer: { contactId: id(2), name: 'Karim Haddad', patientId: null },
        patients: [
          { id: id(1), fullName: 'Rana Haddad', displayNumber: 'P-000001', balance: '300.00' },
          { id: id(3), fullName: 'Sami Haddad', displayNumber: 'P-000003', balance: '80.00' },
        ],
        total: '380.00',
      },
    });
    renderDialog();
    expect(await screen.findByText('Payer: Karim Haddad ·')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Pay for the whole household' }));
    expect(screen.getByText('Pay for: household (2 patients · $380)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Full amount $380' })).toBeTruthy();
  });
});
