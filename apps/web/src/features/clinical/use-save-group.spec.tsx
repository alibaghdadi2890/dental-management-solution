import { act, cleanup, render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAnyGroupDirty, useDropSaveGroup, useFlushSaveGroups } from './save-groups-context';
import { SaveGroupsProvider } from './save-groups-provider';
import { SAVE_DEBOUNCE_MS } from './save-groups-store';
import { type SaveGroup, useSaveGroup } from './use-save-group';

type Save = (value: string) => Promise<unknown>;

function wrapper({ children }: { children: ReactNode }) {
  return <SaveGroupsProvider>{children}</SaveGroupsProvider>;
}

/** A `notes` group plus what the provider reports, for one server value. */
function renderGroup(save: Save, serverValue = 'first') {
  return renderHook(
    ({ server }: { server: string }) => ({
      group: useSaveGroup({ key: 'notes', serverValue: server, save }),
      anyDirty: useAnyGroupDirty(),
      flush: useFlushSaveGroups(),
      drop: useDropSaveGroup(),
    }),
    { wrapper, initialProps: { server: serverValue } },
  );
}

/** A save whose calls stay in flight until the test settles them. */
function controlledSave() {
  const calls: { value: string; resolve: () => void; reject: () => void }[] = [];
  const save = vi.fn(
    (value: string) =>
      new Promise<void>((resolve, reject) => {
        calls.push({
          value,
          resolve,
          reject: () => {
            reject(new Error('offline'));
          },
        });
      }),
  );
  return { save, calls };
}

/** Lets the debounce fire and the save's promise settle. */
async function settle(ms = SAVE_DEBOUNCE_MS) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useSaveGroup', () => {
  it('starts idle and clean with the server value', () => {
    const { result } = renderGroup(vi.fn());
    expect(result.current.group).toMatchObject({ value: 'first', state: 'idle', dirty: false });
    expect(result.current.anyDirty).toBe(false);
  });

  it('needs a SaveGroupsProvider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() =>
      renderHook(() => useSaveGroup({ key: 'notes', serverValue: '', save: vi.fn() })),
    ).toThrow(/SaveGroupsProvider/);
  });

  it('debounces three edits into one call with the last value', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderGroup(save);

    act(() => {
      result.current.group.setValue('a');
    });
    await settle(300);
    act(() => {
      result.current.group.setValue('ab');
    });
    await settle(300);
    act(() => {
      result.current.group.setValue('abc');
    });
    expect(result.current.group).toMatchObject({ value: 'abc', state: 'saving', dirty: true });
    expect(save).not.toHaveBeenCalled();

    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('abc');
    expect(result.current.group).toMatchObject({ state: 'saved', dirty: false });
  });

  it('keeps the local value on failure, stays dirty, and retry re-sends it', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const { result } = renderGroup(save);

    act(() => {
      result.current.group.setValue('draft');
    });
    await settle();
    expect(result.current.group).toMatchObject({ value: 'draft', state: 'failed', dirty: true });
    expect(result.current.anyDirty).toBe(true);

    act(() => {
      result.current.group.retry();
    });
    expect(result.current.group.state).toBe('saving');
    await settle(0);
    expect(save).toHaveBeenNthCalledWith(2, 'draft');
    expect(result.current.group).toMatchObject({ value: 'draft', state: 'saved', dirty: false });
    expect(result.current.anyDirty).toBe(false);
  });

  it('after a failure, a new edit saves the newest value without a retry', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const { result } = renderGroup(save);

    act(() => {
      result.current.group.setValue('draft');
    });
    await settle();
    expect(result.current.group.state).toBe('failed');

    act(() => {
      result.current.group.setValue('draft, edited');
    });
    expect(result.current.group.state).toBe('saving');
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith('draft, edited');
    expect(result.current.group.state).toBe('saved');
  });

  it('never lets a refetched server value clobber a dirty or saving field', async () => {
    const { save, calls } = controlledSave();
    const { result, rerender } = renderGroup(save);

    act(() => {
      result.current.group.setValue('mine');
    });
    rerender({ server: 'theirs' });
    expect(result.current.group.value).toBe('mine');

    await settle();
    expect(result.current.group.state).toBe('saving');
    rerender({ server: 'theirs, again' });
    expect(result.current.group.value).toBe('mine');

    await act(async () => {
      calls[0]?.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.group).toMatchObject({ value: 'mine', state: 'saved' });
  });

  it('tracks the server value once saved and clean', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderGroup(save);
    rerender({ server: 'second' });
    expect(result.current.group.value).toBe('second');

    act(() => {
      result.current.group.setValue('mine');
    });
    await settle();
    rerender({ server: 'someone else' });
    expect(result.current.group).toMatchObject({ value: 'someone else', state: 'saved' });
  });

  it('sends saves one at a time, so an older one can never land last', async () => {
    const { save, calls } = controlledSave();
    const { result } = renderGroup(save);

    act(() => {
      result.current.group.setValue('one');
    });
    await settle();
    act(() => {
      result.current.group.setValue('two');
    });
    await settle();
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => {
      calls[0]?.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(save).toHaveBeenLastCalledWith('two');
    expect(result.current.group.state).toBe('saving');

    await act(async () => {
      calls[1]?.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.group.state).toBe('saved');
  });

  it('reports dirtiness to the provider until the save settles', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderGroup(save);

    act(() => {
      result.current.group.setValue('x');
    });
    expect(result.current.anyDirty).toBe(true);
    await settle();
    expect(result.current.anyDirty).toBe(false);
  });

  it('compares object values structurally by default', () => {
    const { result, rerender } = renderHook(
      ({ server }: { server: { mode: string; value: string } }) =>
        useSaveGroup({ key: 'discount', serverValue: server, save: vi.fn() }),
      { wrapper, initialProps: { server: { mode: 'percent', value: '10' } } },
    );
    const first = result.current.value;
    rerender({ server: { mode: 'percent', value: '10' } });
    expect(result.current.value).toBe(first);
  });
});

describe('useSaveGroup — unmounting', () => {
  interface Seen {
    group: SaveGroup<string> | null;
    anyDirty: boolean;
  }

  function NotesField({
    save,
    report,
  }: {
    save: Save;
    report: (group: SaveGroup<string>) => void;
  }) {
    report(useSaveGroup({ key: 'notes', serverValue: '', save }));
    return null;
  }

  function DirtyReader({ report }: { report: (anyDirty: boolean) => void }) {
    report(useAnyGroupDirty());
    return null;
  }

  /** The provider stays mounted while the notes field comes and goes. */
  function renderWorkspace(save: Save) {
    const seen: Seen = { group: null, anyDirty: false };
    const tree = (shown: boolean) => (
      <SaveGroupsProvider>
        <DirtyReader
          report={(anyDirty) => {
            seen.anyDirty = anyDirty;
          }}
        />
        {shown && (
          <NotesField
            save={save}
            report={(group) => {
              seen.group = group;
            }}
          />
        )}
      </SaveGroupsProvider>
    );
    const view = render(tree(true));
    return {
      seen,
      show: (shown: boolean) => {
        view.rerender(tree(shown));
      },
    };
  }

  it('sends a pending edit when the field unmounts before the debounce fires', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { seen, show } = renderWorkspace(save);
    act(() => {
      seen.group?.setValue('typed');
    });
    show(false);
    await settle(0);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('typed');
    expect(seen.anyDirty).toBe(false);
  });

  it('shows a failed unmount save as failed when the field comes back', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const { seen, show } = renderWorkspace(save);
    act(() => {
      seen.group?.setValue('typed');
    });
    show(false);
    await settle(0);
    expect(save).toHaveBeenCalledWith('typed');
    expect(seen.anyDirty).toBe(true);

    show(true);
    expect(seen.group).toMatchObject({ value: 'typed', state: 'failed' });
  });

  it('keeps an in-flight save going when the field unmounts', async () => {
    const { save, calls } = controlledSave();
    const { seen, show } = renderWorkspace(save);
    act(() => {
      seen.group?.setValue('typed');
    });
    await settle();
    show(false);
    expect(seen.anyDirty).toBe(true);

    await act(async () => {
      calls[0]?.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(seen.anyDirty).toBe(false);
    show(true);
    expect(seen.group).toMatchObject({ value: 'typed', state: 'idle' });
  });
});

describe('useSaveGroup — shared keys', () => {
  it('gives two consumers of one key the same value, state and queue', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const other = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(
      () => ({
        panel: useSaveGroup({ key: 'service:1', serverValue: '10.00', save }),
        dialog: useSaveGroup({ key: 'service:1', serverValue: '10.00', save: other }),
      }),
      { wrapper },
    );

    act(() => {
      result.current.panel.setValue('12');
    });
    expect(result.current.dialog).toMatchObject({ value: '12', state: 'saving' });
    await settle(300);
    act(() => {
      result.current.dialog.setValue('12.5');
    });
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('12.5');
    expect(other).not.toHaveBeenCalled();
    expect(result.current.panel).toMatchObject({ value: '12.5', state: 'saved' });
    expect(result.current.dialog).toMatchObject({ value: '12.5', state: 'saved' });
  });

  it('keeps different keys independent', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(
      () => ({
        one: useSaveGroup({ key: 'service:1', serverValue: '1', save }),
        two: useSaveGroup({ key: 'service:2', serverValue: '2', save }),
      }),
      { wrapper },
    );
    act(() => {
      result.current.one.setValue('10');
    });
    expect(result.current.two).toMatchObject({ value: '2', state: 'idle' });
    await settle();
  });
});

describe('useFlushSaveGroups', () => {
  it('sends pending edits at once and resolves true when all saved', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderGroup(save);
    act(() => {
      result.current.group.setValue('last words');
    });

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.flush();
    });
    expect(saved).toBe(true);
    expect(save).toHaveBeenCalledWith('last words');
    expect(result.current.group.state).toBe('saved');
  });

  it('waits for a save in flight, and resolves false when one fails', async () => {
    const { save, calls } = controlledSave();
    const { result } = renderGroup(save);
    act(() => {
      result.current.group.setValue('x');
    });
    await settle();

    let saved: boolean | undefined;
    const flushing = result.current.flush().then((outcome) => {
      saved = outcome;
    });
    await settle(0);
    expect(saved).toBeUndefined();

    await act(async () => {
      calls[0]?.reject();
      await flushing;
    });
    expect(saved).toBe(false);
    expect(result.current.group.state).toBe('failed');
  });

  it('retries a failed group and resolves true with nothing to send', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const { result } = renderGroup(save);
    act(() => {
      result.current.group.setValue('x');
    });
    await settle();
    expect(result.current.group.state).toBe('failed');

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.flush();
    });
    expect(saved).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);

    await act(async () => {
      saved = await result.current.flush();
    });
    expect(saved).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
  });
});

describe('useDropSaveGroup', () => {
  it('forgets a pending edit: nothing is sent and the workspace is clean', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderGroup(save);
    act(() => {
      result.current.group.setValue('edited price');
    });
    expect(result.current.anyDirty).toBe(true);

    act(() => {
      result.current.drop('notes');
    });
    expect(result.current.anyDirty).toBe(false);

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.flush();
    });
    await settle();
    expect(saved).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it('lets a save already in flight settle as a no-op', async () => {
    const { save, calls } = controlledSave();
    const { result } = renderGroup(save);
    act(() => {
      result.current.group.setValue('edited price');
    });
    await settle();
    expect(save).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.drop('notes');
    });
    expect(result.current.anyDirty).toBe(false);
    await act(async () => {
      calls[0]?.reject();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.anyDirty).toBe(false);
    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.flush();
    });
    expect(saved).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('ignores an unknown key', () => {
    const { result } = renderGroup(vi.fn());
    act(() => {
      result.current.drop('service:unknown');
    });
    expect(result.current.anyDirty).toBe(false);
  });
});
