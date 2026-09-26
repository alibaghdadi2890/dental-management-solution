import { describe, expect, it } from 'vitest';
import { resolveRequestId } from './request-id';

describe('resolveRequestId', () => {
  it('keeps safe caller-supplied ids', () => {
    expect(resolveRequestId('req-2026-09-26.abc')).toBe('req-2026-09-26.abc');
  });

  it.each([undefined, '', 'short', 'has spaces in it', 'x'.repeat(129), '<script>alert(1)</script>'])(
    'replaces unsafe id %j with a generated uuid',
    (header) => {
      const id = resolveRequestId(header);
      expect(id).not.toBe(header);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    },
  );

  it('ignores repeated headers', () => {
    expect(resolveRequestId(['a-valid-id-1', 'a-valid-id-2'])).toMatch(/^[0-9a-f-]{36}$/);
  });
});
