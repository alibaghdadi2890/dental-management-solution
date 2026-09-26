import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';

/** Headers better-auth needs from the browser request: cookies, origin, user agent, client IP. */
export function forwardedHeaders(req: ExpressRequest): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (name === 'content-length' || name === 'content-type' || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      headers.append(name, item);
    }
  }
  return headers;
}

/** better-auth sets and clears the session cookies; only those cross back to the browser. */
export function copySetCookies(from: Headers, to: ExpressResponse): void {
  for (const cookie of from.getSetCookie()) {
    to.append('Set-Cookie', cookie);
  }
}
