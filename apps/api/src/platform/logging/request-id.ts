import type { NextFunction, Request, Response } from 'express';
import { newId } from '../kernel/id';

export const REQUEST_ID_HEADER = 'x-request-id';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/** Keeps a caller-supplied request id only if it is safe to log; otherwise generates one. */
export function resolveRequestId(header: unknown): string {
  return typeof header === 'string' && SAFE_REQUEST_ID.test(header) ? header : newId();
}

/**
 * First middleware of the app: normalises `x-request-id` so CLS, pino and the response all agree.
 */
export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
  req.headers[REQUEST_ID_HEADER] = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}
