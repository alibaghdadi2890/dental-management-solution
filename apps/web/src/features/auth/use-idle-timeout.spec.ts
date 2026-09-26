import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIdleTimeout } from './use-idle-timeout';

const LIMIT = 15 * 60;

describe('useIdleTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = (idleSeconds: number | null = LIMIT) => {
    const touch = vi.fn();
    const expire = vi.fn();
    const hook = renderHook(() => useIdleTimeout(idleSeconds, { touch, expire }));
    return { ...hook, touch, expire };
  };

  it('warns 60 seconds before the limit and counts down', () => {
    const { result } = setup();
    act(() => {
      vi.advanceTimersByTime((LIMIT - 61) * 1_000);
    });
    expect(result.current.secondsLeft).toBeNull();
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current.secondsLeft).toBe(59);
  });

  it('signs out when the countdown ends', () => {
    const { expire } = setup();
    act(() => {
      vi.advanceTimersByTime(LIMIT * 1_000);
    });
    expect(expire).toHaveBeenCalledOnce();
  });

  it('resets on activity and reports it to the server at most once a minute', () => {
    const { result, touch, expire } = setup();
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
      window.dispatchEvent(new Event('keydown'));
      window.dispatchEvent(new Event('mousemove'));
    });
    expect(touch).toHaveBeenCalledOnce();
    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(result.current.secondsLeft).toBeNull();
    expect(expire).not.toHaveBeenCalled();
  });

  it('ignores activity while warning; only "Stay signed in" dismisses it', () => {
    const { result, touch } = setup();
    act(() => {
      vi.advanceTimersByTime((LIMIT - 30) * 1_000);
      window.dispatchEvent(new Event('mousemove'));
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.secondsLeft).not.toBeNull();

    act(() => {
      result.current.stay();
    });
    expect(result.current.secondsLeft).toBeNull();
    expect(touch).toHaveBeenCalled();
  });

  it('does nothing on a trusted workstation', () => {
    const { result, expire } = setup(null);
    act(() => {
      vi.advanceTimersByTime(LIMIT * 2_000);
    });
    expect(result.current.secondsLeft).toBeNull();
    expect(expire).not.toHaveBeenCalled();
  });
});
