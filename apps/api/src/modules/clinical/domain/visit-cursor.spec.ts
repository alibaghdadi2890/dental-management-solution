import { describe, expect, it } from 'vitest';
import { decodeVisitCursor, encodeVisitCursor, InvalidVisitCursorError } from './visit-cursor';

const ID = '0192f3a0-0000-7000-8000-000000000001';

describe('visit cursor', () => {
  it('round-trips a position', () => {
    const position = { startedAt: new Date('2026-10-01T08:30:00.000Z'), id: ID };
    expect(decodeVisitCursor(encodeVisitCursor(position))).toEqual(position);
  });

  it.each([
    'not base64 json',
    Buffer.from('[1,2,3]').toString('base64url'),
    Buffer.from(JSON.stringify(['nope', ID])).toString('base64url'),
    Buffer.from(JSON.stringify(['2026-10-01T08:30:00.000Z', 'x'])).toString('base64url'),
  ])('refuses %s', (cursor) => {
    expect(() => decodeVisitCursor(cursor)).toThrow(InvalidVisitCursorError);
  });
});
