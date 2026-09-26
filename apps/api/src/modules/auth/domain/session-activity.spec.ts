import { describe, expect, it } from 'vitest';
import { IDLE_TIMEOUT_MS, sessionActivity, TOUCH_INTERVAL_MS } from './session-activity';

const now = new Date('2026-09-26T10:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms);

describe('session activity (D11)', () => {
  it('never idles a session on a trusted workstation', () => {
    expect(sessionActivity({ trusted: true, lastActiveAt: ago(IDLE_TIMEOUT_MS * 10) }, now)).toBe(
      'fresh',
    );
  });

  it('expires an untrusted session idle for more than 15 minutes', () => {
    expect(IDLE_TIMEOUT_MS).toBe(15 * 60_000);
    expect(sessionActivity({ trusted: false, lastActiveAt: ago(IDLE_TIMEOUT_MS + 1) }, now)).toBe(
      'expired',
    );
    expect(sessionActivity({ trusted: false, lastActiveAt: ago(IDLE_TIMEOUT_MS) }, now)).toBe(
      'touch',
    );
  });

  it('records activity at most once a minute', () => {
    expect(TOUCH_INTERVAL_MS).toBe(60_000);
    expect(sessionActivity({ trusted: false, lastActiveAt: ago(59_000) }, now)).toBe('fresh');
    expect(sessionActivity({ trusted: false, lastActiveAt: ago(61_000) }, now)).toBe('touch');
  });
});
