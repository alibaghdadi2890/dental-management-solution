import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, apiFetch } from './api';

function respond(body: unknown, init: ResponseInit & { contentType?: string } = {}) {
  const { contentType = 'application/json', headers: extraHeaders, ...rest } = init;
  const headers = new Headers(extraHeaders);
  headers.set('content-type', contentType);
  const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
    Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), { ...rest, headers }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('apiFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls the versioned API with the session cookie and validates the response', async () => {
    respond({ id: 'p1', name: 'Jane' });

    const patient = await apiFetch('/patients/p1', z.object({ id: z.string(), name: z.string() }));

    expect(patient).toEqual({ id: 'p1', name: 'Jane' });
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/patients/p1',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  it('sends JSON bodies', async () => {
    const fetchMock = respond({ ok: true }, { status: 201 });

    await apiFetch('/patients', z.object({ ok: z.boolean() }), {
      method: 'POST',
      json: { name: 'Jane' },
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/v1/patients');
    expect(init).toMatchObject({ method: 'POST', body: '{"name":"Jane"}' });
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('turns problem details into a typed ApiError', async () => {
    respond(
      {
        type: 'urn:dcm:problem:visit.already_completed',
        title: 'Conflict',
        status: 409,
        code: 'visit.already_completed',
        requestId: 'req-1',
      },
      { status: 409, contentType: 'application/problem+json' },
    );

    const error = await apiFetch('/visits/v1/complete', z.unknown()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 409,
      code: 'visit.already_completed',
      requestId: 'req-1',
    });
  });

  it('still produces an ApiError for non-problem failures', async () => {
    respond('<html>Bad gateway</html>', {
      status: 502,
      contentType: 'text/html',
      headers: { 'x-request-id': 'req-9' },
    });

    const error = await apiFetch('/patients', z.unknown()).catch((e: unknown) => e);

    expect(error).toMatchObject({ status: 502, code: 'http_error', requestId: 'req-9' });
  });

  it('rejects responses that do not match the contract', async () => {
    respond({ id: 42 });
    await expect(apiFetch('/patients/p1', z.object({ id: z.string() }))).rejects.toThrow();
  });
});
