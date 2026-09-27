import { afterEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, size: 25 });

vi.mock('@/lib/api', () => ({
  API_BASE: '/api/v1',
  apiFetch: (...args: unknown[]): Promise<unknown> => apiFetchMock(...args) as Promise<unknown>,
}));

const { LIST_QUERY_DEFAULTS } = await import('./list-query');
const { exportUrl, patientListQuery } = await import('./patients-api');

/** `queryOptions()`'s `queryFn` is typed to take a `QueryFunctionContext`; every `queryFn` here
 * ignores it, so tests call it with none. */
async function runQueryFn(options: { queryFn?: unknown }): Promise<unknown> {
  return (options.queryFn as () => Promise<unknown>)();
}

describe('patientListQuery', () => {
  afterEach(() => {
    apiFetchMock.mockClear();
  });

  it('uses GET /patients for the default (active/name) query', async () => {
    await runQueryFn(patientListQuery(LIST_QUERY_DEFAULTS));
    expect(apiFetchMock).toHaveBeenCalledWith('/patients', expect.anything());
  });

  it('uses GET /billing/patients for view=owing', async () => {
    await runQueryFn(patientListQuery({ ...LIST_QUERY_DEFAULTS, view: 'owing' }));
    const [path] = apiFetchMock.mock.calls[0] as [string, unknown];
    expect(path).toBe('/billing/patients?view=owing');
  });

  it('uses GET /billing/patients for sort=balance', async () => {
    await runQueryFn(patientListQuery({ ...LIST_QUERY_DEFAULTS, sort: 'balance', dir: 'desc' }));
    const [path] = apiFetchMock.mock.calls[0] as [string, unknown];
    expect(path).toBe('/billing/patients?sort=balance&dir=desc');
  });

  it('includes non-default filters in the query string', async () => {
    await runQueryFn(patientListQuery({ ...LIST_QUERY_DEFAULTS, q: 'jane', dentist: 'none' }));
    const [path] = apiFetchMock.mock.calls[0] as [string, unknown];
    expect(path).toBe('/patients?q=jane&dentist=none');
  });
});

describe('exportUrl', () => {
  it('builds the export path from the current filters, dropping page/size', () => {
    const url = exportUrl({ ...LIST_QUERY_DEFAULTS, view: 'archived', page: 3, size: 50 }, 'fr');
    expect(url).toBe('/api/v1/billing/patients/export?view=archived&lang=fr');
  });

  it('builds the export path from an explicit id list', () => {
    const url = exportUrl(['id-1', 'id-2'], 'en');
    expect(url).toBe('/api/v1/billing/patients/export?ids=id-1%2Cid-2&lang=en');
  });

  it('has no query string for the plain default query with no language', () => {
    expect(exportUrl(LIST_QUERY_DEFAULTS)).toBe('/api/v1/billing/patients/export');
  });

  it('omits ids entirely for an empty selection', () => {
    expect(exportUrl([])).toBe('/api/v1/billing/patients/export');
  });
});
