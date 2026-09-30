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

/** Sends every group's unsaved value and resolves to whether all saved (Complete runs it first,
 * so the frozen money and notes include the last edits). */
export function useFlushSaveGroups(): () => Promise<boolean> {
  return useSaveGroupsStore().flushAll;
}
