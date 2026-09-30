import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatElapsed,
  useVisitTimer,
  visitElapsedSeconds,
  type VisitClock,
} from './use-visit-timer';

const STARTED = '2026-09-30T09:00:00.000Z';

function clock(extra: Partial<VisitClock> = {}): VisitClock {
  return {
    status: 'in_progress',
    startedAt: STARTED,
    pausedAt: null,
    pausedSeconds: 0,
    completedAt: null,
    serverNow: '2026-09-30T09:05:00.000Z',
    ...extra,
  };
}

describe('formatElapsed', () => {
  it('shows mm:ss under an hour and hh:mm:ss from an hour', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(65)).toBe('01:05');
    expect(formatElapsed(3599)).toBe('59:59');
    expect(formatElapsed(3600)).toBe('01:00:00');
    expect(formatElapsed(3600 + 23 * 60 + 7)).toBe('01:23:07');
  });
});

describe('visitElapsedSeconds', () => {
  const now = Date.parse('2026-09-30T09:10:00.000Z');

  it('runs to now, less the paused time', () => {
    expect(visitElapsedSeconds(clock({ pausedSeconds: 60 }), now)).toBe(540);
  });

  it('stops at the pause, then at the completion', () => {
    expect(visitElapsedSeconds(clock({ pausedAt: '2026-09-30T09:02:00.000Z' }), now)).toBe(120);
    expect(
      visitElapsedSeconds(
        clock({
          pausedAt: '2026-09-30T09:02:00.000Z',
          completedAt: '2026-09-30T09:03:30.000Z',
          pausedSeconds: 30,
        }),
        now,
      ),
    ).toBe(180);
  });

  it('is never negative', () => {
    expect(visitElapsedSeconds(clock({ pausedSeconds: 10_000 }), now)).toBe(0);
  });
});

describe('useVisitTimer', () => {
  beforeEach(() => {
    // The browser's clock is 2 minutes behind the server's.
    vi.useFakeTimers({ now: new Date('2026-09-30T09:03:00.000Z') });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('uses the server offset captured when the data arrived, and ticks every second', () => {
    const receivedAt = Date.now();
    const { result } = renderHook(() => useVisitTimer(clock(), receivedAt));
    expect(result.current).toBe('05:00');

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current).toBe('05:03');
  });

  it('freezes while paused', () => {
    const receivedAt = Date.now();
    const paused = clock({ status: 'paused', pausedAt: '2026-09-30T09:04:10.000Z' });
    const { result } = renderHook(() => useVisitTimer(paused, receivedAt));
    expect(result.current).toBe('04:10');

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe('04:10');
  });

  it('picks up from the server value on resume, without jumping back', () => {
    const { result, rerender } = renderHook(
      ({ visit, receivedAt }: { visit: VisitClock; receivedAt: number }) =>
        useVisitTimer(visit, receivedAt),
      {
        initialProps: {
          visit: clock({ status: 'paused', pausedAt: '2026-09-30T09:04:10.000Z' }),
          receivedAt: Date.now(),
        },
      },
    );
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    // Resumed at server 09:06:00 after 110 s paused: 250 s of work so far.
    rerender({
      visit: clock({ pausedSeconds: 110, serverNow: '2026-09-30T09:06:00.000Z' }),
      receivedAt: Date.now(),
    });
    expect(result.current).toBe('04:10');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe('04:11');
  });

  it('is empty without a visit', () => {
    const { result } = renderHook(() => useVisitTimer(undefined, 0));
    expect(result.current).toBe('');
  });
});
