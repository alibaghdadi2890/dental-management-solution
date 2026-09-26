import { DomainError } from '../../../platform/kernel/domain-error';

export class InvalidAuditCursorError extends DomainError {
  readonly code = 'audit.invalid_cursor';
  readonly kind = 'invalid';
}

/** Position of the last row of a page: the log is read newest first by (occurred_at, id). */
export interface AuditCursorPosition {
  occurredAt: Date;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function encodeAuditCursor({ occurredAt, id }: AuditCursorPosition): string {
  return Buffer.from(JSON.stringify([occurredAt.toISOString(), id])).toString('base64url');
}

export function decodeAuditCursor(cursor: string): AuditCursorPosition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidAuditCursorError('Invalid cursor');
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) {
    throw new InvalidAuditCursorError('Invalid cursor');
  }
  const [at, id] = parsed as unknown[];
  const occurredAt = typeof at === 'string' ? new Date(at) : new Date(Number.NaN);
  if (Number.isNaN(occurredAt.getTime()) || typeof id !== 'string' || !UUID.test(id)) {
    throw new InvalidAuditCursorError('Invalid cursor');
  }
  return { occurredAt, id };
}
