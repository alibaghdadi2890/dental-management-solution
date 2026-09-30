/**
 * The autosaved field groups of one live visit (spec V6, W6), kept outside React so that two
 * components showing the same group (the tooth panel's price inputs and the summary dialog's, the
 * footer's discount and the dialog's) edit one value with one save queue. `use-save-group.ts` is
 * the React side; `SaveGroupsProvider` owns one store per workspace.
 */

/** One pending state for continuous typing (workspace spec §Loading, Saving & Error States). */
export const SAVE_DEBOUNCE_MS = 700;

export type SaveGroupState = 'idle' | 'saving' | 'saved' | 'failed';
export type SaveOutcome = 'saved' | 'failed';

export interface SaveGroupSnapshot<T> {
  value: T;
  state: SaveGroupState;
}

export type SaveFn<T> = (value: T) => Promise<unknown>;
export type EqualsFn<T> = (a: T, b: T) => boolean;
/** Whether a local value and a server value mean the same, however each is written (`10.` typed,
 * `10.00` stored). */
export type SameValueFn<T> = (local: T, server: T) => boolean;

/** Structural, so an object rebuilt on every render doesn't count as a new server value. */
export const sameJson = (a: unknown, b: unknown): boolean =>
  Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);

export const isDirty = (state: SaveGroupState): boolean => state === 'saving' || state === 'failed';

/**
 * One field group.
 *
 * - An edit shows `saving` at once and is sent 700 ms after the last one, so quick edits make
 *   one call with the last value.
 * - Saves go out one at a time; a value superseded while it waits is never sent, so an older save
 *   can't land after a newer one.
 * - A failure keeps the local value; `retry()` re-sends the latest one.
 * - Last write wins per group (W6): a new server value replaces the local one only while the group
 *   is clean, never while it is dirty or saving — and not when it means the same as what is shown
 *   (`sameValue`), so the refetch after a save never rewrites what is being typed (`10.` stays
 *   `10.`, not the stored `10.00` read back as `10`).
 * - The first consumer to register owns the `save` function (and `equals`, `sameValue`); when
 *   it unmounts, the next consumer takes over. Every consumer of one key must therefore save the
 *   same way.
 * - When the last consumer leaves with an edit still waiting for its debounce, the edit is sent
 *   anyway; if that fails, the group stays `failed` (and dirty) for whoever mounts it next.
 */
export class SaveGroupEntry<T> {
  private snapshot: SaveGroupSnapshot<T>;
  private seenServerValue: T;
  private latest: T;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private attempt = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private lastSend: Promise<SaveOutcome> = Promise.resolve('saved');
  private owner: string | undefined;
  private readonly consumers = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private sameValue: SameValueFn<T> = sameJson;

  constructor(
    serverValue: T,
    private save: SaveFn<T>,
    private equals: EqualsFn<T>,
    /** Called on every change of value or state (the store's value listeners, its dirty flag). */
    private readonly onChange: () => void,
  ) {
    this.snapshot = { value: serverValue, state: 'idle' };
    this.seenServerValue = serverValue;
    this.latest = serverValue;
  }

  get dirty(): boolean {
    return isDirty(this.snapshot.state);
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): SaveGroupSnapshot<T> => this.snapshot;

  readonly setValue = (next: T): void => {
    this.latest = next;
    this.update({ value: next, state: 'saving' });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.send(next);
    }, SAVE_DEBOUNCE_MS);
  };

  readonly retry = (): void => {
    void this.send(this.latest);
  };

  /** A value from the server (a refetch, or another group's save). */
  receiveServerValue(serverValue: T): void {
    if (this.equals(this.seenServerValue, serverValue)) return;
    this.seenServerValue = serverValue;
    if (this.dirty || this.sameValue(this.snapshot.value, serverValue)) return;
    this.latest = serverValue;
    this.update({ ...this.snapshot, value: serverValue });
  }

  /** Called on every render of a consumer: the owner keeps its latest `save`, `equals` and
   * `sameValue`. */
  offer(consumerId: string, save: SaveFn<T>, equals: EqualsFn<T>, sameValue: SameValueFn<T>): void {
    this.owner ??= consumerId;
    if (this.owner !== consumerId) return;
    this.save = save;
    this.equals = equals;
    this.sameValue = sameValue;
  }

  acquire(consumerId: string): void {
    this.consumers.add(consumerId);
    this.owner ??= consumerId;
  }

  release(consumerId: string): void {
    this.consumers.delete(consumerId);
    if (this.owner === consumerId) {
      const [next] = this.consumers;
      this.owner = next;
    }
    if (this.consumers.size > 0) return;
    if (this.timer !== undefined) void this.send(this.latest);
    else if (this.snapshot.state === 'saved') this.update({ ...this.snapshot, state: 'idle' });
  }

  /**
   * Forgets the group's unsaved value because its record is going away (a removed service): the
   * debounced edit is never sent, a queued send is skipped and one in flight settles as a no-op.
   */
  discard(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.attempt++;
    this.lastSend = Promise.resolve('saved');
    this.update({ ...this.snapshot, state: 'idle' });
  }

  /** Sends whatever is unsaved now and waits until the group settles (before Complete). */
  async flush(): Promise<SaveOutcome> {
    if (this.timer !== undefined || this.snapshot.state === 'failed') void this.send(this.latest);
    for (;;) {
      const pending = this.lastSend;
      await pending;
      if (this.timer !== undefined) void this.send(this.latest);
      else if (pending === this.lastSend) break;
    }
    return this.snapshot.state === 'failed' ? 'failed' : 'saved';
  }

  private send(next: T): Promise<SaveOutcome> {
    clearTimeout(this.timer);
    this.timer = undefined;
    const current = ++this.attempt;
    const superseded = () => current !== this.attempt;
    this.update({ ...this.snapshot, state: 'saving' });
    const run = this.queue.then(() => (superseded() ? undefined : this.save(next)));
    this.queue = run.catch(() => undefined);
    // Only the latest attempt settles the state, and only when no newer edit is waiting.
    const outcome = run.then(
      () => this.settle(current, 'saved'),
      () => this.settle(current, 'failed'),
    );
    this.lastSend = outcome;
    return outcome;
  }

  private settle(attempt: number, outcome: SaveOutcome): SaveOutcome {
    if (attempt !== this.attempt || this.timer !== undefined) return outcome;
    const idleAfterSave = outcome === 'saved' && this.consumers.size === 0;
    this.update({ ...this.snapshot, state: idleAfterSave ? 'idle' : outcome });
    return outcome;
  }

  private update(next: SaveGroupSnapshot<T>): void {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
    this.onChange();
  }
}

/** The registry: one entry per key for the life of the workspace. */
export class SaveGroupsStore {
  private readonly entries = new Map<string, SaveGroupEntry<unknown>>();
  private readonly listeners = new Set<() => void>();
  private readonly valueListeners = new Set<() => void>();
  private anyDirty = false;
  private version = 0;

  /** The group for `key`, created from the first consumer's values. One key, one value type. */
  entry<T>(key: string, serverValue: T, save: SaveFn<T>, equals: EqualsFn<T>): SaveGroupEntry<T> {
    let entry = this.entries.get(key) as SaveGroupEntry<T> | undefined;
    if (!entry) {
      entry = new SaveGroupEntry(serverValue, save, equals, this.changed);
      this.entries.set(key, entry as SaveGroupEntry<unknown>);
    }
    return entry;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** True while any group has unsaved local edits (W6 pauses the visit refetch). */
  readonly isAnyDirty = (): boolean => this.anyDirty;

  /** Listens to every change of any group's value or state, for a preview computed over several
   * groups (the financial bar's money, `useLocalValues`). */
  readonly subscribeValues = (listener: () => void): (() => void) => {
    this.valueListeners.add(listener);
    return () => {
      this.valueListeners.delete(listener);
    };
  };

  /** Bumped on every change `subscribeValues` reports. */
  readonly valuesVersion = (): number => this.version;

  /**
   * The group's local value unless it is `idle`: being edited, failed, or just `saved` — a saved
   * group has a consumer mounted that keeps it in step with the server (`receiveServerValue`),
   * and it may be ahead of a cache that hasn't caught up yet. `undefined` for an idle group (or
   * none): the server value is the current one. Reading never creates a group.
   */
  readonly localValue = (key: string): unknown => {
    const snapshot = this.entries.get(key)?.getSnapshot();
    return snapshot && snapshot.state !== 'idle' ? snapshot.value : undefined;
  };

  /**
   * Removes a group before its record is deleted (`service:<id>` before the service's DELETE),
   * so a pending or failed price edit neither reaches the deleted row nor keeps the workspace
   * dirty. A consumer still mounted gets a fresh group from the server value on its next render.
   * If the DELETE then fails, the record stays but its unsaved edit is lost: the field shows the
   * server value again.
   */
  readonly drop = (key: string): void => {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    entry.discard();
    this.refreshDirty();
  };

  /** Flushes every group; true when all of them saved. */
  readonly flushAll = async (): Promise<boolean> => {
    const outcomes = await Promise.all([...this.entries.values()].map((entry) => entry.flush()));
    return outcomes.every((outcome) => outcome === 'saved');
  };

  private readonly changed = (): void => {
    this.version++;
    for (const listener of this.valueListeners) listener();
    this.refreshDirty();
  };

  private readonly refreshDirty = (): void => {
    const anyDirty = [...this.entries.values()].some((entry) => entry.dirty);
    if (anyDirty === this.anyDirty) return;
    this.anyDirty = anyDirty;
    for (const listener of this.listeners) listener();
  };
}
