import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { SaveStatus } from '@/components/ui/save-state';
import { useReportDirty } from './save-groups-context';

/** One pending state for continuous typing (workspace spec §Loading, Saving & Error States). */
export const SAVE_DEBOUNCE_MS = 700;

export type SaveGroupState = 'idle' | 'saving' | 'saved' | 'failed';

export interface SaveGroup<T> {
  /** What the field shows: the local value, which only follows the server while clean. */
  value: T;
  setValue: (next: T) => void;
  state: SaveGroupState;
  /** Local edits not yet saved: waiting for the debounce, in flight, or failed. */
  dirty: boolean;
  /** Re-sends the latest local value ("Failed to save — retry"). */
  retry: () => void;
}

export interface SaveGroupOptions<T> {
  /** The field group's value in the latest server data (the visit query). */
  serverValue: T;
  /** Sends one value; its promise settles the group's state. */
  save: (value: T) => Promise<unknown>;
  /** Whether two server values are the same; structural by default, so an object rebuilt on each
   * render doesn't count as a new server value. */
  equals?: (a: T, b: T) => boolean;
}

const sameJson = (a: unknown, b: unknown) =>
  Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);

/** The group's state as the shared save-state indicator renders it. */
export function toSaveStatus(state: SaveGroupState): SaveStatus {
  return state === 'idle' ? 'clean' : state;
}

/**
 * One autosaved field group of the live visit (notes, the discount, one service's price; spec
 * V6): a debounced save with `idle | saving | saved | failed`.
 *
 * - An edit shows `saving` at once and is sent 700 ms after the last one, so three quick edits
 *   make one call with the last value.
 * - Saves go out one at a time; a value superseded while it waits is never sent, so an older
 *   save can't land after a newer one.
 * - A failure keeps the local value; `retry()` re-sends it.
 * - Last write wins per group (W6): a new server value replaces the local one only while the
 *   group is clean, never while it is dirty or saving.
 * - The group reports its dirtiness to the nearest `SaveGroupsProvider` (the visit query stops
 *   polling while any group is dirty), and a pending edit is still sent if the field unmounts
 *   before its debounce fires.
 */
export function useSaveGroup<T>({
  serverValue,
  save,
  equals = sameJson,
}: SaveGroupOptions<T>): SaveGroup<T> {
  const [value, setLocalValue] = useState(serverValue);
  const [seenServerValue, setSeenServerValue] = useState(serverValue);
  const [state, setState] = useState<SaveGroupState>('idle');
  const dirty = state === 'saving' || state === 'failed';

  if (!equals(seenServerValue, serverValue)) {
    setSeenServerValue(serverValue);
    if (!dirty) setLocalValue(serverValue);
  }

  const saveRef = useRef(save);
  useLayoutEffect(() => {
    saveRef.current = save;
  });
  const latest = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const attempt = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const send = useCallback((next: T) => {
    const current = ++attempt.current;
    const superseded = () => current !== attempt.current;
    setState('saving');
    const run = queue.current.then(() => (superseded() ? undefined : saveRef.current(next)));
    queue.current = run.catch(() => undefined);
    // Only the latest attempt settles the state, and only when no newer edit is waiting.
    const settle = (outcome: 'saved' | 'failed') => () => {
      if (!superseded() && timer.current === undefined) setState(outcome);
    };
    void run.then(settle('saved'), settle('failed'));
  }, []);

  const setValue = useCallback(
    (next: T) => {
      latest.current = next;
      setLocalValue(next);
      setState('saving');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = undefined;
        send(next);
      }, SAVE_DEBOUNCE_MS);
    },
    [send],
  );

  const retry = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    send(latest.current);
  }, [send]);

  const groupId = useId();
  const report = useReportDirty();
  useEffect(() => {
    report(groupId, dirty);
    return () => {
      report(groupId, false);
    };
  }, [report, groupId, dirty]);

  useEffect(
    () => () => {
      if (timer.current === undefined) return;
      clearTimeout(timer.current);
      const pending = latest.current;
      void queue.current.then(() => saveRef.current(pending)).catch(() => undefined);
    },
    [],
  );

  return { value, setValue, state, dirty, retry };
}
