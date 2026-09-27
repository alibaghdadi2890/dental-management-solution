import { describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.fn().mockResolvedValue([]);

vi.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]): Promise<unknown> => apiFetchMock(...args) as Promise<unknown>,
}));

const { balancesQuery, balanceQuery, createWithOpeningBalance } = await import('./billing-api');

describe('balancesQuery', () => {
  it('is disabled for an empty id list', () => {
    expect(balancesQuery([]).enabled).toBe(false);
  });

  it('is enabled and requests the given ids once there are some', async () => {
    const options = balancesQuery(['a', 'b']);
    expect(options.enabled).toBe(true);
    await (options.queryFn as () => Promise<unknown>)();
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/billing/balances?patientIds=a,b',
      expect.anything(),
    );
  });
});

describe('balanceQuery', () => {
  it('requests the single patient balance', async () => {
    apiFetchMock.mockResolvedValueOnce({ patientId: 'a', balances: [] });
    await (balanceQuery('a').queryFn as () => Promise<unknown>)();
    expect(apiFetchMock).toHaveBeenCalledWith('/billing/patients/a/balance', expect.anything());
  });
});

describe('createWithOpeningBalance', () => {
  it('posts to /billing/opening-balances', async () => {
    apiFetchMock.mockResolvedValueOnce({ patient: {}, balance: {} });
    const input = {
      patient: { fullName: 'Jane', phone: '03123456' },
      openingBalance: { amount: '50', asOf: '2026-09-27', note: null },
    };
    await createWithOpeningBalance(input as never);
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/billing/opening-balances',
      expect.anything(),
      expect.objectContaining({ method: 'POST', json: input }),
    );
  });
});
