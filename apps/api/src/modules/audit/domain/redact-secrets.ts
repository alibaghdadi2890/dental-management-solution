const SECRET_KEY = /password|secret|token/i;

/**
 * Defence in depth for before/after snapshots: callers should never pass credentials, but if one
 * slips through it is dropped rather than stored forever in an append-only table.
 */
export function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSecrets);
  }
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SECRET_KEY.test(key))
        .map(([key, nested]) => [key, redactSecrets(nested)]),
    );
  }
  return value;
}
