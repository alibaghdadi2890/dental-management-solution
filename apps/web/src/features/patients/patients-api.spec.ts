import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, size: 25 });

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    apiFetch: (...args: unknown[]): Promise<unknown> => apiFetchMock(...args) as Promise<unknown>,
  };
});

const { LIST_QUERY_DEFAULTS } = await import('./list-query');
const { downloadExport, invalidatePatientData, patientKeys, patientListQuery } =
  await import('./patients-api');

/** `queryOptions()`'s `queryFn` is typed to take a `QueryFunctionContext`; every `queryFn` here
 * ignores it, so tests call it with none. */
async function runQueryFn(options: { queryFn?: unknown }): Promise<unknown> {
  return (options.queryFn as () => Promise<unknown>)();
}

afterEach(() => {
  apiFetchMock.mockClear();
  sessionStorage.clear();
});

describe('patientKeys', () => {
  it('scopes every key under the tenant, distinct per tenant', () => {
    expect(patientKeys.all('t1')).not.toEqual(patientKeys.all('t2'));
    expect(patientKeys.counts('t1')).not.toEqual(patientKeys.counts('t2'));
    expect(patientKeys.detail('t1', 'p1')).not.toEqual(patientKeys.detail('t2', 'p1'));
    expect(patientKeys.audit('t1', 'p1')).not.toEqual(patientKeys.audit('t2', 'p1'));
  });

  it('is null-tenant for no acting tenant, not the literal string "null"', () => {
    expect(patientKeys.all(null)).toEqual(['patients', null]);
  });
});

describe('patientListQuery', () => {
  it('uses GET /patients for the default (active/name) query', async () => {
    await runQueryFn(patientListQuery(LIST_QUERY_DEFAULTS));
    expect(apiFetchMock).toHaveBeenCalledWith('/patients', expect.anything(), {});
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

  it('keys by the acting tenant when none is given explicitly', () => {
    sessionStorage.setItem('dcm.actingTenantId', 'tenant-1');
    expect(patientListQuery(LIST_QUERY_DEFAULTS).queryKey).toEqual(
      patientKeys.list('tenant-1', LIST_QUERY_DEFAULTS),
    );
  });

  it('forwards an explicit tenant to both the key and the request', async () => {
    const options = patientListQuery(LIST_QUERY_DEFAULTS, 'tenant-2');
    expect(options.queryKey).toEqual(patientKeys.list('tenant-2', LIST_QUERY_DEFAULTS));
    await runQueryFn(options);
    expect(apiFetchMock).toHaveBeenCalledWith(expect.any(String), expect.anything(), {
      tenantId: 'tenant-2',
    });
  });
});

describe('invalidatePatientData', () => {
  it('invalidates both the patients and billing umbrellas for the tenant', async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const queryClient = { invalidateQueries } as unknown as Parameters<
      typeof invalidatePatientData
    >[0];

    await invalidatePatientData(queryClient, 'tenant-1');

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['patients', 'tenant-1'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['billing', 'tenant-1'] });
  });

  it('defaults to the acting tenant', async () => {
    sessionStorage.setItem('dcm.actingTenantId', 'tenant-9');
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const queryClient = { invalidateQueries } as unknown as Parameters<
      typeof invalidatePatientData
    >[0];

    await invalidatePatientData(queryClient);

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['patients', 'tenant-9'] });
  });
});

describe('downloadExport', () => {
  let createObjectURL: ReturnType<typeof vi.fn<(obj: Blob | MediaSource) => string>>;
  let revokeObjectURL: ReturnType<typeof vi.fn<(url: string) => void>>;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  function spyOnAnchorClick() {
    return vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  }
  let clickSpy: ReturnType<typeof spyOnAnchorClick>;

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:mock-url');
    revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    clickSpy = spyOnAnchorClick();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  function respondCsv(body: string, contentDisposition?: string, init: ResponseInit = {}) {
    const headers = new Headers(init.headers);
    headers.set('content-type', 'text/csv');
    if (contentDisposition) headers.set('content-disposition', contentDisposition);
    const fetchMock = vi.fn<(url: string, requestInit: RequestInit) => Promise<Response>>(() =>
      Promise.resolve(new Response(body, { ...init, headers })),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('downloads the export for the current filters and saves it under its server filename', async () => {
    const fetchMock = respondCsv('id,name\n', 'attachment; filename="patients.csv"');

    await downloadExport({ query: { ...LIST_QUERY_DEFAULTS, view: 'archived' } });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/billing/patients/export?view=archived');
    expect(new Headers(init.headers).get('Accept')).toBe('text/csv');
    expect(createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('sends the acting tenant header for a platform admin', async () => {
    sessionStorage.setItem('dcm.actingTenantId', 'tenant-1');
    const fetchMock = respondCsv('id,name\n');

    await downloadExport({ ids: ['a', 'b'] });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('X-Tenant-Id')).toBe('tenant-1');
  });

  it('builds the export query from an explicit id list, with lang', async () => {
    const fetchMock = respondCsv('id,name\n');

    await downloadExport({ ids: ['id-1', 'id-2'] }, 'fr');

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/billing/patients/export?ids=id-1%2Cid-2&lang=fr');
  });

  it('has no query string for the plain default query with no language', async () => {
    const fetchMock = respondCsv('id,name\n');
    await downloadExport({ query: LIST_QUERY_DEFAULTS });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/v1/billing/patients/export');
  });

  it('throws rather than exporting the whole view for an empty id selection', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(downloadExport({ ids: [] })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws an ApiError on a failed response instead of downloading a blob', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 403 }))),
    );

    await expect(downloadExport({ query: LIST_QUERY_DEFAULTS })).rejects.toMatchObject({
      status: 403,
    });
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
