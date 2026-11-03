import { describe, expect, it, vi } from 'vitest';
import { AlertHub } from './alert-hub';

describe('AlertHub', () => {
  it("pings only the tenant's streams, and forgets a closed one", () => {
    const hub = new AlertHub();
    const a1 = vi.fn();
    const a2 = vi.fn();
    const b = vi.fn();
    const stopA1 = hub.subscribe('a', a1);
    hub.subscribe('a', a2);
    hub.subscribe('b', b);

    hub.ping('a');
    expect([a1.mock.calls.length, a2.mock.calls.length, b.mock.calls.length]).toEqual([1, 1, 0]);

    stopA1();
    hub.ping('a');
    expect([a1.mock.calls.length, a2.mock.calls.length]).toEqual([1, 2]);
    expect(hub.size('a')).toBe(1);
    hub.ping('nobody');
  });

  it('lets a listener unsubscribe while being pinged', () => {
    const hub = new AlertHub();
    const later = vi.fn();
    const stop = hub.subscribe('a', () => {
      stop();
    });
    hub.subscribe('a', later);
    hub.ping('a');
    expect(later).toHaveBeenCalledOnce();
    expect(hub.size('a')).toBe(1);
  });
});
