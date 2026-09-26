import { type ProblemDetails, problemDetailsSchema } from '@dcm/contracts';
import type { z } from 'zod';

const API_BASE = '/api/v1';

/** A failed API call, carrying the RFC 7807 problem the server returned (CLAUDE.md §12). */
export class ApiError extends Error {
  constructor(readonly problem: ProblemDetails) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
  }

  get status(): number {
    return this.problem.status;
  }

  get code(): string {
    return this.problem.code;
  }

  get requestId(): string | undefined {
    return this.problem.requestId;
  }
}

export interface ApiRequestInit extends Omit<RequestInit, 'body'> {
  json?: unknown;
}

async function toApiError(response: Response): Promise<ApiError> {
  const requestId = response.headers.get('x-request-id') ?? undefined;
  if (response.headers.get('content-type')?.includes('application/problem+json')) {
    const parsed = problemDetailsSchema.safeParse(await response.json());
    if (parsed.success) {
      return new ApiError(parsed.data);
    }
  }
  return new ApiError({
    type: 'about:blank',
    title: response.statusText || 'Request failed',
    status: response.status,
    code: 'http_error',
    ...(requestId === undefined ? {} : { requestId }),
  });
}

/**
 * The only way the SPA talks to the API: same-origin cookie session, JSON in, and responses
 * validated against the shared contract schema so drift fails loudly.
 */
export async function apiFetch<TSchema extends z.ZodType>(
  path: string,
  schema: TSchema,
  init: ApiRequestInit = {},
): Promise<z.infer<TSchema>> {
  const { json, headers: initHeaders, ...rest } = init;
  const headers = new Headers(initHeaders);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  if (json !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'same-origin',
    ...rest,
    headers,
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });

  if (!response.ok) {
    throw await toApiError(response);
  }
  const body: unknown = response.status === 204 ? undefined : await response.json();
  return schema.parse(body);
}
