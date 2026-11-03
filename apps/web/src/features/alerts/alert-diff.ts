import type { AlertInRoom, AlertKey, AlertTray, AlertWaiting } from '@dcm/contracts';

/** One row of the tray, keyed the way it alerts: once per arrival, once per start. */
export type TrayItem =
  | { key: AlertKey; kind: 'arrived'; item: AlertWaiting }
  | { key: AlertKey; kind: 'started'; item: AlertInRoom };

export function trayItems(tray: AlertTray): TrayItem[] {
  return [
    ...tray.inRoom.map((item): TrayItem => ({
      key: `started:${item.visitId}`,
      kind: 'started',
      item,
    })),
    ...tray.waiting.map((item): TrayItem => ({
      key: `arrived:${item.appointmentId}`,
      kind: 'arrived',
      item,
    })),
  ];
}

/**
 * What alerts now (spec §Alerts): the items this browser has not seen. With nothing seen yet (the
 * first load on this browser), nothing alerts: what is there is only recorded. A visit the caller
 * started never alerts. `seen` comes back as the keys of this tray, so an item that leaves and
 * comes back (an undone check-in, checked in again) alerts again, and the set never grows past
 * the tray.
 */
export function diffTray(
  seen: ReadonlySet<string> | null,
  tray: AlertTray,
  userId: string,
): { alerts: TrayItem[]; seen: Set<string> } {
  const items = trayItems(tray);
  const next = new Set(items.map((entry) => entry.key));
  if (seen === null) return { alerts: [], seen: next };
  const alerts = items.filter(
    (entry) =>
      !seen.has(entry.key) && !(entry.kind === 'started' && entry.item.startedBy === userId),
  );
  return { alerts, seen: next };
}

/** The keys not yet looked at: in the tray, not in what the list showed when last opened. */
export function unreadKeys(tray: AlertTray, opened: ReadonlySet<string>, userId: string): string[] {
  return trayItems(tray)
    .filter(
      (entry) =>
        !opened.has(entry.key) && !(entry.kind === 'started' && entry.item.startedBy === userId),
    )
    .map((entry) => entry.key);
}

/** A set of keys kept per user in `localStorage`; `null` when there is none yet. */
export function readKeys(storageKey: string): Set<string> | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((key): key is string => typeof key === 'string'))
      : null;
  } catch {
    return null;
  }
}

export function writeKeys(storageKey: string, keys: ReadonlySet<string>): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify([...keys]));
  } catch {
    // Private mode or a full store: alerts then only last as long as the tab.
  }
}
