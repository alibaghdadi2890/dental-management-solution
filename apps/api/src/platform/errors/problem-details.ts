import type { ProblemDetails } from '@dcm/contracts';
import { HttpException } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import { DomainError, type DomainErrorKind } from '../kernel/domain-error';

const STATUS_BY_KIND: Record<DomainErrorKind, number> = {
  invalid: 422,
  not_found: 404,
  conflict: 409,
  forbidden: 403,
  unauthenticated: 401,
};

const CODE_BY_STATUS: Readonly<Record<number, string>> = {
  400: 'bad_request',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  405: 'method_not_allowed',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  422: 'unprocessable',
  429: 'rate_limited',
};

const TITLE_BY_STATUS: Readonly<Record<number, string>> = {
  400: 'Bad request',
  401: 'Authentication required',
  403: 'Forbidden',
  404: 'Not found',
  405: 'Method not allowed',
  409: 'Conflict',
  413: 'Payload too large',
  415: 'Unsupported media type',
  422: 'Unprocessable request',
  429: 'Too many requests',
  500: 'Internal server error',
};

interface ZodIssueLike {
  path: readonly PropertyKey[];
  code: string;
  message: string;
}

function isZodErrorLike(value: unknown): value is { issues: ZodIssueLike[] } {
  return (
    value instanceof Error &&
    value.name === 'ZodError' &&
    'issues' in value &&
    Array.isArray(value.issues)
  );
}

function problem(
  status: number,
  code: string,
  requestId?: string,
  detail?: string,
): ProblemDetails {
  return {
    type: `urn:dcm:problem:${code}`,
    title: TITLE_BY_STATUS[status] ?? 'Error',
    status,
    code,
    ...(detail === undefined ? {} : { detail }),
    ...(requestId === undefined ? {} : { requestId }),
  };
}

function validationProblem(error: { issues: ZodIssueLike[] }, requestId?: string): ProblemDetails {
  return {
    ...problem(400, 'validation_failed', requestId),
    title: 'Validation failed',
    errors: error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      code: issue.code,
      message: issue.message,
    })),
  };
}

/**
 * Single mapping from anything thrown to RFC 7807 (CLAUDE.md §12). Internal errors never expose
 * their message: it may contain SQL, stack details or PII.
 */
export function toProblemDetails(error: unknown, requestId?: string): ProblemDetails {
  if (error instanceof DomainError) {
    return {
      ...error.extensions,
      ...problem(STATUS_BY_KIND[error.kind], error.code, requestId, error.message),
    };
  }
  if (error instanceof ZodValidationException) {
    const zodError = error.getZodError();
    return validationProblem(isZodErrorLike(zodError) ? zodError : { issues: [] }, requestId);
  }
  if (isZodErrorLike(error)) {
    return validationProblem(error, requestId);
  }
  if (error instanceof HttpException && error.getStatus() < 500) {
    const status = error.getStatus();
    return problem(status, CODE_BY_STATUS[status] ?? 'http_error', requestId);
  }
  return problem(500, 'internal_error', requestId);
}
