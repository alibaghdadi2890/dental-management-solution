import { useCallback, useEffect, useRef, useState } from 'react';

/** The POC's countdown dialog appears this long before the server-side limit. */
export const WARNING_SECONDS = 60;
/** Activity is reported to the server at most this often (it records at most once a minute). */
export const TOUCH_INTERVAL_MS = 60_000;

const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click'] as const;

export interface IdleTimeout {
  /** Seconds until sign-out while the warning is shown; null otherwise. */
  secondsLeft: number | null;
  stay: () => void;
}

/**
 * Mirrors the server's idle timeout (D11, ADR-0013). User activity resets the timer and is
 * reported through `touch`; the warning opens `WARNING_SECONDS` before the limit and, once open,
 * only "Stay signed in" dismisses it. `idleSeconds === null` (trusted workstation) disables it.
 */
export function useIdleTimeout(
  idleSeconds: number | null,
  { touch, expire }: { touch: () => void; expire: () => void },
): IdleTimeout {
  const lastActivity = useRef(0);
  const lastTouch = useRef(0);
  const warning = useRef(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const record = useCallback(() => {
    const now = Date.now();
    lastActivity.current = now;
    if (now - lastTouch.current >= TOUCH_INTERVAL_MS) {
      lastTouch.current = now;
      touch();
    }
  }, [touch]);

  useEffect(() => {
    if (idleSeconds === null) return undefined;
    lastActivity.current = Date.now();
    lastTouch.current = Date.now();
    const onActivity = () => {
      if (!warning.current) record();
    };
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, onActivity);

    const timer = window.setInterval(() => {
      const left = idleSeconds - Math.floor((Date.now() - lastActivity.current) / 1_000);
      if (left <= 0) {
        window.clearInterval(timer);
        expire();
      } else if (left <= WARNING_SECONDS) {
        warning.current = true;
        setSecondsLeft(left);
      }
    }, 1_000);

    return () => {
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, onActivity);
      window.clearInterval(timer);
    };
  }, [idleSeconds, record, expire]);

  const stay = useCallback(() => {
    warning.current = false;
    setSecondsLeft(null);
    lastTouch.current = 0;
    record();
  }, [record]);

  return { secondsLeft, stay };
}
