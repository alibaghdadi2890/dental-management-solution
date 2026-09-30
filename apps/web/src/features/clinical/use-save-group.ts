import { useEffect, useId, useLayoutEffect, useSyncExternalStore } from 'react';
import { useSaveGroupsStore } from './save-groups-context';
import {
  type EqualsFn,
  isDirty,
  type SaveFn,
  type SameValueFn,
  type SaveGroupState,
  sameJson,
} from './save-groups-store';

export interface SaveGroup<T> {
  /** What the field shows: the local value, which only follows the server while clean. */
  value: T;
  setValue: (next: T) => void;
  /** Renders directly with `SaveState` (`components/ui/save-state.tsx`). */
  state: SaveGroupState;
  /** Local edits not yet saved: waiting for the debounce, in flight, or failed. */
  dirty: boolean;
  /** Re-sends the latest local value ("Failed to save — retry"). */
  retry: () => void;
}

export interface SaveGroupOptions<T> {
  /** One group per key in the workspace: `notes`, `discount`, `service:<id>` (one service's
   * price). Every component using the same key shares the value, state and save queue. */
  key: string;
  /** The group's value in the latest server data (the visit query). */
  serverValue: T;
  /** Sends one value; its promise settles the group's state. The first component to register a
   * key owns its `save` (see `SaveGroupEntry`). */
  save: SaveFn<T>;
  /** Whether two server values are the same; structural by default. */
  equals?: EqualsFn<T>;
  /** Whether the shown (local) value and a server value mean the same, however each is written:
   * then a server value arriving while the group is clean leaves what is shown alone. Structural
   * by default. */
  sameValue?: SameValueFn<T>;
}

/** One autosaved field group of the live visit (spec V6); the behaviour is `SaveGroupEntry`'s. */
export function useSaveGroup<T>({
  key,
  serverValue,
  save,
  equals = sameJson,
  sameValue = sameJson,
}: SaveGroupOptions<T>): SaveGroup<T> {
  const entry = useSaveGroupsStore().entry(key, serverValue, save, equals);
  const { value, state } = useSyncExternalStore(entry.subscribe, entry.getSnapshot);
  const consumerId = useId();

  useLayoutEffect(() => {
    entry.offer(consumerId, save, equals, sameValue);
    entry.receiveServerValue(serverValue);
  });

  useEffect(() => {
    entry.acquire(consumerId);
    return () => {
      entry.release(consumerId);
    };
  }, [entry, consumerId]);

  return { value, setValue: entry.setValue, state, dirty: isDirty(state), retry: entry.retry };
}
