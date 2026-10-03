import { InvalidPaymentCursorError } from './payment-errors';

/**
 * Opaque list cursors (base64url JSON `[date, id]`, the shape of the visit cursor): Transactions
 * read newest first by (`paid_at`, id — uuid v7, so creation order); Outstanding oldest unpaid
 * first by (that date, patient id).
 */
export interface DateIdCursor {
  date: string;
  id: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function encodeDateIdCursor({ date, id }: DateIdCursor): string {
  return Buffer.from(JSON.stringify([date, id])).toString('base64url');
}

/** @throws InvalidPaymentCursorError (422) for anything `encodeDateIdCursor` did not produce. */
export function decodeDateIdCursor(cursor: string): DateIdCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidPaymentCursorError('Invalid cursor');
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) {
    throw new InvalidPaymentCursorError('Invalid cursor');
  }
  const [date, id] = parsed as unknown[];
  if (typeof date !== 'string' || !DATE.test(date) || typeof id !== 'string' || !UUID.test(id)) {
    throw new InvalidPaymentCursorError('Invalid cursor');
  }
  return { date, id };
}
