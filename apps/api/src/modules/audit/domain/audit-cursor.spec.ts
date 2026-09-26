import { describe, expect, it } from 'vitest';
import { decodeAuditCursor, encodeAuditCursor, InvalidAuditCursorError } from './audit-cursor';

describe('audit cursor', () => {
  const position = {
    occurredAt: new Date('2026-09-26T10:00:00.123Z'),
    id: '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e',
  };

  it('round-trips the last row position as an opaque string', () => {
    const cursor = encodeAuditCursor(position);
    expect(cursor).not.toContain(position.id);
    expect(decodeAuditCursor(cursor)).toEqual(position);
  });

  it.each(['garbage', encodeURIComponent('["x","y"]'), Buffer.from('[1,2]').toString('base64url')])(
    'rejects tampered cursor %j',
    (cursor) => {
      expect(() => decodeAuditCursor(cursor)).toThrow(InvalidAuditCursorError);
    },
  );
});
