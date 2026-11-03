import { useSyncExternalStore } from 'react';

/** Per device (D7): the sound and the Windows notifications. */
export interface AlertPreferences {
  sound: boolean;
  desktop: boolean;
}

const KEY = 'dcm.alerts.preferences';
const DEFAULTS: AlertPreferences = { sound: true, desktop: false };
const listeners = new Set<() => void>();
let cached: AlertPreferences | null = null;

function read(): AlertPreferences {
  if (cached) return cached;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    cached =
      typeof parsed === 'object' && parsed !== null
        ? { ...DEFAULTS, ...(parsed as Partial<AlertPreferences>) }
        : DEFAULTS;
  } catch {
    cached = DEFAULTS;
  }
  return cached;
}

export function setAlertPreferences(patch: Partial<AlertPreferences>): void {
  cached = { ...read(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // Kept for this tab only.
  }
  for (const listener of listeners) listener();
}

/** Also when another tab changes them: the tab that alerts may not be the one clicked. */
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    cached = null;
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
};

export function useAlertPreferences(): AlertPreferences {
  return useSyncExternalStore(subscribe, read, () => DEFAULTS);
}

/** Windows (system) notifications: what the browser allows. */
export type DesktopPermission = 'unsupported' | NotificationPermission;

export function desktopPermission(): DesktopPermission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/**
 * A system notification while the app is not in front (spec §Alerts): silent, since the chime
 * plays; one per item (`tag`); a click brings the window forward and opens the target.
 */
export function notifyDesktop(title: string, body: string, tag: string, onClick: () => void): void {
  if (desktopPermission() !== 'granted' || !document.hidden) return;
  const notification = new Notification(title, { body, tag, silent: true });
  notification.addEventListener('click', () => {
    window.focus();
    onClick();
    notification.close();
  });
}
