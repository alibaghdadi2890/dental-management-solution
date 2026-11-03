import { useEffect, useState } from 'react';

const LOCK = 'dcm-alerts';

/**
 * Whether this tab is the one that alerts (spec §Alerts): the holder of a Web Lock, so several
 * open tabs chime once. The tab last focused takes it (`steal`): the one in use, whose sound a
 * click has unlocked and whose toasts are seen. When the holder closes, a waiting tab takes it.
 * Without Web Locks every tab alerts.
 */
export function useAlertLeader(enabled: boolean): boolean {
  const supported = typeof navigator !== 'undefined' && 'locks' in navigator;
  const [leader, setLeader] = useState(!supported);
  useEffect(() => {
    if (!enabled || !supported) return;
    let release: (() => void) | undefined;
    let closed = false;
    let holding = false;
    // Each request, so a lost one doesn't undo a later one.
    let request = 0;
    const acquire = (steal: boolean) => {
      if (holding) return;
      request += 1;
      const mine = request;
      navigator.locks
        .request(LOCK, steal ? { steal: true } : {}, () => {
          if (closed || mine !== request) return undefined;
          holding = true;
          setLeader(true);
          return new Promise<void>((resolve) => {
            release = resolve;
          });
        })
        // Stolen by another tab: no longer the one that alerts, and in line to be again when
        // that tab closes.
        .catch(() => undefined)
        .finally(() => {
          if (mine !== request || closed) return;
          holding = false;
          setLeader(false);
          acquire(false);
        });
    };
    const onFocus = () => {
      acquire(true);
    };
    acquire(document.hasFocus());
    window.addEventListener('focus', onFocus);
    return () => {
      closed = true;
      window.removeEventListener('focus', onFocus);
      release?.();
      setLeader(false);
    };
  }, [enabled, supported]);
  return enabled && leader;
}
