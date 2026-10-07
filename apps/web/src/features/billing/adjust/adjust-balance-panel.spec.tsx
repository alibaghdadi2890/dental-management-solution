import type { PatientAccount, PatientBalance } from '@dcm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@/lib/i18n';
import { ConfirmProvider } from '@/components/ui/confirm-dialog';
import { ToastProvider } from '@/components/ui/toast';
import { sessionQueryOptions } from '@/features/auth/session';
import { json, sessionWith } from '@/features/patients/patients.test-utils';
import { AdjustBalanceContext, useAdjustBalance } from './adjust-balance-context';
import { AdjustBalancePanel } from './adjust-balance-panel';
import { AdjustBalanceButton } from './adjust-entry';

const id = (n: number) => `01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d${String(n).padStart(2, '0')}`;

const ACCOUNT: PatientAccount = {
  patientId: id(1),
  currency: 'USD',
  balance: '120.00',
  credit: '0.00',
  lastVisit: null,
  previousOutstanding: '120.00',
  openCharges: [],
  payer: { contactId: null, name: 'Rana Haddad', patientId: null },
  payers: [],
  household: null,
  payerFor: null,
  history: [],
  adjustments: [],
};

const BALANCE: PatientBalance = {
  patientId: id(1),
  balances: [{ amount: '100.00', currency: 'USD' }],
  charged: [],
};

function mockApi() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const path = url.replace('/api/v1', '').split('?')[0];
    if (path === `/billing/patients/${id(1)}/adjustments` && init?.method === 'POST') {
      return Promise.resolve(json(BALANCE, 201));
    }
    if (path === `/billing/patients/${id(1)}/account`) return Promise.resolve(json(ACCOUNT));
    return Promise.resolve(json([]));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function client(permissions: Parameters<typeof sessionWith>[0]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const session = sessionWith(permissions);
  queryClient.setQueryData(sessionQueryOptions().queryKey, session);
  if (!session.tenant) throw new Error('session without tenant');
  return { queryClient, tenant: session.tenant };
}

function renderPanel(onClose = vi.fn()) {
  const { queryClient, tenant } = client(['payment:read', 'payment:refund']);
  render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <ConfirmProvider>
          <AdjustBalancePanel patientId={id(1)} tenant={tenant} onClose={onClose} />
        </ConfirmProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return onClose;
}

const adjustments = (fetchMock: ReturnType<typeof mockApi>) =>
  fetchMock.mock.calls.filter(
    ([url, init]) => url.includes('/adjustments') && init?.method === 'POST',
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Adjust balance panel (H4)', () => {
  it('reduces the balance: the button says so, and the request is negative with one key', async () => {
    const fetchMock = mockApi();
    const onClose = renderPanel();
    const amount = await screen.findByLabelText('Amount');
    expect(screen.getByText('$120')).toBeTruthy();
    expect(
      screen.getByRole('radio', { name: 'Patient owes less' }).getAttribute('aria-checked'),
    ).toBe('true');
    const submit = () => screen.getByRole<HTMLButtonElement>('button', { name: /balance/i });
    expect(submit().textContent).toBe('Adjust balance');
    expect(submit().disabled).toBe(true);

    fireEvent.change(amount, { target: { value: '20' } });
    expect(submit().textContent).toBe('Reduce balance by $20');
    expect(submit().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'courtesy' } });
    expect(screen.getByText('$100')).toBeTruthy();
    expect(submit().disabled).toBe(false);

    fireEvent.click(submit());
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
    const [call] = adjustments(fetchMock);
    const body = call?.[1]?.body;
    expect(JSON.parse(typeof body === 'string' ? body : '{}')).toMatchObject({
      amount: '-20.00',
      reason: 'courtesy',
    });
    expect(new Headers(call?.[1]?.headers).get('Idempotency-Key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText('Balance adjusted')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Statement' })).toBeTruthy();
  });

  it('adds to the balance, fills the whole outstanding with Full only when reducing, and asks why for Other', async () => {
    mockApi();
    renderPanel();
    const amount = await screen.findByLabelText<HTMLInputElement>('Amount');
    fireEvent.click(screen.getByRole('button', { name: 'Full amount $120' }));
    expect(amount.value).toBe('120.00');

    fireEvent.click(screen.getByRole('radio', { name: 'Patient owes more' }));
    expect(screen.queryByRole('button', { name: /Full amount/ })).toBeNull();
    fireEvent.change(amount, { target: { value: '35' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'other' } });
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Add $35 to balance' });
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Lab fee carried over' } });
    expect(submit.disabled).toBe(false);
    expect(screen.getByText('$155')).toBeTruthy();
  });

  it('asks before discarding a started form', async () => {
    mockApi();
    const onClose = renderPanel();
    fireEvent.change(await screen.findByLabelText('Amount'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Discard and leave' }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalledOnce();
    });
  });
});

describe('Adjust balance entry points (H4)', () => {
  function Probe() {
    const adjust = useAdjustBalance();
    return <span>{adjust === null ? 'hidden' : adjust.open ? 'enabled' : 'ask'}</span>;
  }
  const renderWith = (permissions: Parameters<typeof sessionWith>[0], open = vi.fn()) => {
    const { queryClient } = client(permissions);
    render(
      <QueryClientProvider client={queryClient}>
        <AdjustBalanceContext.Provider value={open}>
          <Probe />
          <AdjustBalanceButton patientId={id(1)} />
        </AdjustBalanceContext.Provider>
      </QueryClientProvider>,
    );
    return open;
  };

  it('lets an owner or dentist open it', () => {
    const open = renderWith(['payment:read', 'payment:write', 'payment:refund']);
    expect(screen.getByText('enabled')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Adjust balance' }));
    expect(open).toHaveBeenCalledWith(id(1));
  });

  it('shows front desk the action, explained, without a way to use it', () => {
    renderWith(['payment:read', 'payment:write']);
    expect(screen.getByText('ask')).toBeTruthy();
    expect(screen.getByText('Ask a dentist to adjust')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Adjust balance' })).toBeNull();
  });

  it('shows nothing without payment:read', () => {
    renderWith(['patient:read']);
    expect(screen.getByText('hidden')).toBeTruthy();
    expect(screen.queryByText('Ask a dentist to adjust')).toBeNull();
  });
});
