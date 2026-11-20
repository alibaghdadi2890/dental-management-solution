import { useSyncExternalStore } from 'react';

/** How often the board's tickers move: minutes waited, "in 12 min", the timeline's now-line. */
export const NOW_TICK_MS = 15_000;

let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const notify of listeners) notify();
    }, NOW_TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

/** One clock for every ticker on screen, so they move together (epoch milliseconds). */
export function useNow(): number {
  return useSyncExternalStore(subscribe, snapshot);
}

/** Stable between calls (React compares them); refreshed when nothing ticks and it went stale. */
function snapshot() {
  if (!timer && Date.now() - now > 1000) now = Date.now();
  return now;
}
