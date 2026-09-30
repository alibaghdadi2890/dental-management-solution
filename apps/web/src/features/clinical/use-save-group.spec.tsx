import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAnyGroupDirty } from './save-groups-context';
import { SaveGroupsProvider } from './save-groups-provider';
import { SAVE_DEBOUNCE_MS, toSaveStatus, useSaveGroup } from './use-save-group';

function wrapper({ children }: { children: ReactNode }) {
  return <SaveGroupsProvider>{children}</SaveGroupsProvider>;
}

/** A save group plus what the provider reports, for one server value. */
function renderGroup(save: (value: string) => Promise<unknown>, serverValue = 'first') {
  return renderHook(
    ({ server }: { server: string }) => ({
      group: useSaveGroup({ serverValue: server, save }),
      anyDirty: useAnyGroupDirty(),
    }),
    { wrapper, initialProps: { server: serverValue } },
  );
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

  it('keeps the local value on failure, and retry re-sends it', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const { result } = renderGroup(save);

    act(() => {
      result.current.group.setValue('draft');
    });
    await settle();
    expect(result.current.group).toMatchObject({ value: 'draft', state: 'failed', dirty: true });

    act(() => {
      result.current.group.retry();
    });
    expect(result.current.group.state).toBe('saving');
    await settle(0);
    expect(save).toHaveBeenNthCalledWith(2, 'draft');
    expect(result.current.group).toMatchObject({ value: 'draft', state: 'saved', dirty: false });
  });

  it('never lets a refetched server value clobber a dirty or saving field', async () => {
    let finish: () => void = () => undefined;
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
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
      finish();
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
    const resolvers: (() => void)[] = [];
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );
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
      resolvers[0]?.();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(save).toHaveBeenLastCalledWith('two');
    expect(result.current.group.state).toBe('saving');

    await act(async () => {
      resolvers[1]?.();
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

  it('saves a pending edit when it unmounts before the debounce fires', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderGroup(save);
    act(() => {
      result.current.group.setValue('typed');
    });
    unmount();
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('typed');
  });

  it('compares object values structurally by default', () => {
    const { result, rerender } = renderHook(
      ({ server }: { server: { mode: string; value: string } }) =>
        useSaveGroup({ serverValue: server, save: vi.fn() }),
      { initialProps: { server: { mode: 'percent', value: '10' } } },
    );
    const first = result.current.value;
    rerender({ server: { mode: 'percent', value: '10' } });
    expect(result.current.value).toBe(first);
  });
});

describe('toSaveStatus', () => {
  it('maps the group state onto the save-state indicator', () => {
    expect(toSaveStatus('idle')).toBe('clean');
    expect(toSaveStatus('saving')).toBe('saving');
    expect(toSaveStatus('saved')).toBe('saved');
    expect(toSaveStatus('failed')).toBe('failed');
  });
});
