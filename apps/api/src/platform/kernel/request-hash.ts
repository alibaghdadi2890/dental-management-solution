import { createHash } from 'node:crypto';

/** JSON with object keys in a fixed order, so two equal inputs always serialise alike. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`);
    return `{${entries.join(',')}}`;
  }
  // `JSON.stringify(undefined)` is undefined, whatever its type says.
  return value === undefined ? 'null' : JSON.stringify(value);
}

/**
 * The fingerprint stored beside an `Idempotency-Key` (CLAUDE.md §12): SHA-256 of the validated
 * request. A replay with the same key and the same fingerprint gets the first result; another
 * fingerprint under the key is a different request and is refused. Key order and absent
 * (`undefined`) fields don't matter; everything else does.
 */
export function requestHash(request: unknown): string {
  return createHash('sha256').update(canonical(request)).digest('hex');
}
