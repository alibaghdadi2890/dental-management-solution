import { DomainError } from '../../../platform/kernel/domain-error';

export class InvalidVisitCursorError extends DomainError {
  readonly code = 'visit.invalid_cursor';
  readonly kind = 'invalid';
}

/** Position of the last row of a page: lists are read newest first by (started_at, id). */
export interface VisitCursorPosition {
  startedAt: Date;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Opaque to clients: base64url JSON `[startedAtIso, id]`, the shape of the audit cursor. */
export function encodeVisitCursor({ startedAt, id }: VisitCursorPosition): string {
  return Buffer.from(JSON.stringify([startedAt.toISOString(), id])).toString('base64url');
}

/** @throws InvalidVisitCursorError (422) for anything `encodeVisitCursor` did not produce. */
export function decodeVisitCursor(cursor: string): VisitCursorPosition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidVisitCursorError('Invalid cursor');
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) {
    throw new InvalidVisitCursorError('Invalid cursor');
  }
  const [at, id] = parsed as unknown[];
  const startedAt = typeof at === 'string' ? new Date(at) : new Date(Number.NaN);
  if (Number.isNaN(startedAt.getTime()) || typeof id !== 'string' || !UUID.test(id)) {
    throw new InvalidVisitCursorError('Invalid cursor');
  }
  return { startedAt, id };
}
