import { createContext, useContext, useSyncExternalStore } from 'react';
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

/** For a preview over several groups (the financial bar's money): each key's local value while its
 * group has unsaved edits, else `undefined` (the server value is current). Re-renders on every
 * change of any group; unlike `useSaveGroup`, it neither creates nor joins a group. */
export function useUnsavedValues<T>(keys: readonly string[]): (T | undefined)[] {
  const store = useSaveGroupsStore();
  useSyncExternalStore(store.subscribeValues, store.valuesVersion);
  // One key, one value type: the group was created with a `T` (see `SaveGroupsStore.entry`).
  return keys.map((key) => store.unsavedValue(key) as T | undefined);
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
