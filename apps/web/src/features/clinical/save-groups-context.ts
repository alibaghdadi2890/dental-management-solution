import { createContext, useContext, useEffect, useSyncExternalStore } from 'react';
import type { SaveGroupsStore } from './save-groups-store';

export const SaveGroupsContext = createContext<SaveGroupsStore | null>(null);

export function useSaveGroupsStore(): SaveGroupsStore {
  const store = useContext(SaveGroupsContext);
  if (!store) {
    throw new Error('useSaveGroup must be used inside <SaveGroupsProvider>');
  }
  return store;
}

const neverDirty = () => false;
const noSubscription = () => () => undefined;

/** True while any save group in the workspace has unsaved local edits (W6 pauses the refetch).
 * False outside a `SaveGroupsProvider`, where there are no groups. */
export function useAnyGroupDirty(): boolean {
  const store = useContext(SaveGroupsContext);
  return useSyncExternalStore(
    store?.subscribe ?? noSubscription,
    store?.isAnyDirty ?? neverDirty,
    neverDirty,
  );
}

/** For a preview over several groups (the financial bar's money): each key's local value unless its
 * group is idle (`SaveGroupsStore.localValue`), else `undefined` (the server value is current).
 * Re-renders on every change of any group; unlike `useSaveGroup`, it neither creates nor joins a
 * group. */
export function useLocalValues<T>(keys: readonly string[]): (T | undefined)[] {
  const store = useSaveGroupsStore();
  useSyncExternalStore(store.subscribeValues, store.valuesVersion);
  // One key, one value type: the group was created with a `T` (see `SaveGroupsStore.entry`).
  return keys.map((key) => store.localValue(key) as T | undefined);
}

/** Sends every group's unsaved value and resolves to whether all saved (Complete runs it first,
 * so the frozen money and notes include the last edits). */
export function useFlushSaveGroups(): () => Promise<boolean> {
  return useSaveGroupsStore().flushAll;
}

/** Forgets one group before its record is deleted (see `SaveGroupsStore.drop`): call it with
 * `service:<id>` right before every service DELETE. */
export function useDropSaveGroup(): (key: string) => void {
  return useSaveGroupsStore().drop;
}

/**
 * Drops the groups under `prefix` whose key isn't in `live`: records gone from the server (a
 * service another user removed). Their unsaved value has nowhere to go, and a failed one would
 * keep the workspace dirty — no refetch — and fail every flush, so Complete could never succeed.
 */
export function useDropOrphanedGroups(prefix: string, live: readonly string[]): void {
  const store = useSaveGroupsStore();
  // One string, so a list rebuilt on every render with the same keys doesn't re-run the effect.
  const liveKeys = live.join('\n');
  useEffect(() => {
    const keep = new Set(liveKeys.split('\n'));
    for (const key of store.keys()) {
      if (key.startsWith(prefix) && !keep.has(key)) store.drop(key);
    }
  }, [store, prefix, liveKeys]);
}
