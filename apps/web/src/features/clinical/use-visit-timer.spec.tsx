import type { LiveVisitRef } from '@dcm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatElapsed,
  type TimerClock,
  useElapsedText,
  useVisitTimer,
  visitElapsedSeconds,
} from './use-visit-timer';
import { visitKeys } from './visits-api';

const VISIT_ID = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d01';
const STARTED = '2026-09-30T09:00:00.000Z';

function clock(extra: Partial<TimerClock> = {}): TimerClock {
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

describe('useElapsedText', () => {
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
    const { result } = renderHook(() => useElapsedText(clock(), receivedAt));
    expect(result.current).toBe('05:00');

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current).toBe('05:03');
  });

  it('ticks on the elapsed second’s boundary, not the browser’s', () => {
    const receivedAt = Date.now();
    const { result } = renderHook(() =>
      useElapsedText(clock({ serverNow: '2026-09-30T09:05:00.400Z' }), receivedAt),
    );
    expect(result.current).toBe('05:00');

    act(() => {
      vi.advanceTimersByTime(599);
    });
    expect(result.current).toBe('05:00');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('05:01');
  });

  it('freezes while paused', () => {
    const receivedAt = Date.now();
    const paused = clock({ status: 'paused', pausedAt: '2026-09-30T09:04:10.000Z' });
    const { result } = renderHook(() => useElapsedText(paused, receivedAt));
    expect(result.current).toBe('04:10');

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe('04:10');
  });

  it('picks up from the server value on resume, without jumping back', () => {
    const { result, rerender } = renderHook(
      ({ value, receivedAt }: { value: TimerClock; receivedAt: number }) =>
        useElapsedText(value, receivedAt),
      {
        initialProps: {
          value: clock({ status: 'paused', pausedAt: '2026-09-30T09:04:10.000Z' }),
          receivedAt: Date.now(),
        },
      },
    );
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    // Resumed at server 09:06:00 after 110 s paused: 250 s of work so far.
    rerender({
      value: clock({ pausedSeconds: 110, serverNow: '2026-09-30T09:06:00.000Z' }),
      receivedAt: Date.now(),
    });
    expect(result.current).toBe('04:10');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe('04:11');
  });

  it('runs from a live-visit reference (the header pill)', () => {
    const ref: LiveVisitRef = {
      id: VISIT_ID,
      patientId: VISIT_ID,
      patientName: 'Nadia',
      dentistName: 'Dr. Reyes',
      status: 'in_progress',
      startedAt: STARTED,
      pausedAt: null,
      pausedSeconds: 0,
      serverNow: '2026-09-30T09:01:00.000Z',
    };
    const { result } = renderHook(() => useElapsedText(ref, Date.now()));
    expect(result.current).toBe('01:00');
  });

  it('is empty without a clock', () => {
    const { result } = renderHook(() => useElapsedText(undefined, 0));
    expect(result.current).toBe('');
  });
});

describe('useVisitTimer', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('reads the cached visit and when it arrived', () => {
    vi.useFakeTimers({ now: new Date('2026-09-30T09:03:00.000Z') });
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    client.setQueryData(visitKeys.detail(null, VISIT_ID), clock());
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useVisitTimer(VISIT_ID), { wrapper });
    expect(result.current).toBe('05:00');
  });
});
