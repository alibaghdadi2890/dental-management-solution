import { afterEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.fn().mockResolvedValue([]);

vi.mock('@/lib/api', () => ({
  apiFetch: (...args: unknown[]): Promise<unknown> => apiFetchMock(...args) as Promise<unknown>,
}));

const { balanceQuery, balancesQuery, billingKeys, createWithOpeningBalance } =
  await import('./billing-api');

afterEach(() => {
  apiFetchMock.mockClear();
  sessionStorage.clear();
});

describe('billingKeys', () => {
  it('scopes every key under the tenant, distinct per tenant', () => {
    expect(billingKeys.all('t1')).not.toEqual(billingKeys.all('t2'));
    expect(billingKeys.balances('t1', ['a'])).not.toEqual(billingKeys.balances('t2', ['a']));
    expect(billingKeys.balance('t1', 'a')).not.toEqual(billingKeys.balance('t2', 'a'));
  });

  it('sorts ids so the same selection in a different order shares a cache entry', () => {
    expect(billingKeys.balances('t1', ['b', 'a'])).toEqual(billingKeys.balances('t1', ['a', 'b']));
  });

  it('is null-tenant for no acting tenant, not the literal string "null"', () => {
    expect(billingKeys.all(null)).toEqual(['billing', null]);
  });
});

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
      {},
    );
  });

  it('keys by the acting tenant when none is given explicitly', () => {
    sessionStorage.setItem('dcm.actingTenantId', 'tenant-1');
    expect(balancesQuery(['a']).queryKey).toEqual(billingKeys.balances('tenant-1', ['a']));
  });

  it('forwards an explicit tenant to both the key and the request', async () => {
    const options = balancesQuery(['a'], 'tenant-2');
    expect(options.queryKey).toEqual(billingKeys.balances('tenant-2', ['a']));
    await (options.queryFn as () => Promise<unknown>)();
    expect(apiFetchMock).toHaveBeenCalledWith(expect.any(String), expect.anything(), {
      tenantId: 'tenant-2',
    });
  });
});

describe('balanceQuery', () => {
  it('requests the single patient balance', async () => {
    apiFetchMock.mockResolvedValueOnce({ patientId: 'a', balances: [], charged: [] });
    await (balanceQuery('a').queryFn as () => Promise<unknown>)();
    expect(apiFetchMock).toHaveBeenCalledWith('/billing/patients/a/balance', expect.anything(), {});
  });
});

describe('createWithOpeningBalance', () => {
  it('posts to /billing/opening-balances', async () => {
    apiFetchMock.mockResolvedValueOnce({ patient: {}, balance: {} });
    const input = {
      patient: { fullName: 'Jane', phone: '03123456' },
      openingBalance: { amount: '50', asOf: '2026-09-27', note: null },
    };
    await createWithOpeningBalance(input);
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/billing/opening-balances',
      expect.anything(),
      expect.objectContaining({ method: 'POST', json: input }),
    );
  });
});
