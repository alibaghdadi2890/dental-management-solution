import { useState } from 'react';

/** Sent with a mutation the client may retry (CLAUDE.md §12). */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

/**
 * Keys for one form: the same key for the same payload, so a double click, a lost response or
 * "Try again" resends the submission the server already knows; a new key once the payload
 * changes, because an edited form is another submission.
 */
export function idempotencyKeys(): (payload: unknown) => string {
  let last: { payload: string; key: string } | null = null;
  return (payload) => {
    const text = JSON.stringify(payload);
    if (last?.payload !== text) last = { payload: text, key: crypto.randomUUID() };
    return last.key;
  };
}

/** `idempotencyKeys` for the lifetime of the component: a form that reopens starts afresh. */
export function useIdempotencyKeys(): (payload: unknown) => string {
  const [keyFor] = useState(idempotencyKeys);
  return keyFor;
}
