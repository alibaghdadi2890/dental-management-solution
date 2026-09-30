import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    apiFetch: (...args: unknown[]): Promise<unknown> => apiFetchMock(...args) as Promise<unknown>,
  };
});

const { SaveGroupsProvider } = await import('./save-groups-provider');
const { useSaveGroup } = await import('./use-save-group');
const { useVisit, VISIT_REFETCH_MS } = await import('./use-visit');

const VISIT_ID = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d01';

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <SaveGroupsProvider>{children}</SaveGroupsProvider>
    </QueryClientProvider>
  );
}

const visitFetches = () =>
  apiFetchMock.mock.calls.filter(([path]) => path === `/visits/${VISIT_ID}`).length;

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  apiFetchMock.mockResolvedValue({ id: VISIT_ID, notes: '' });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.useRealTimers();
  apiFetchMock.mockReset();
});

describe('useVisit', () => {
  it('polls every 10 s, and stops while a save group is dirty', async () => {
    let finishSave: () => void = () => undefined;
    const save = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    const { result } = renderHook(
      () => ({
        visit: useVisit(VISIT_ID),
        notes: useSaveGroup({ key: 'notes', serverValue: '', save }),
      }),
      { wrapper },
    );
    await advance(0);
    expect(visitFetches()).toBe(1);

    await advance(VISIT_REFETCH_MS);
    expect(visitFetches()).toBe(2);

    act(() => {
      result.current.notes.setValue('typing');
    });
    await advance(3 * VISIT_REFETCH_MS);
    expect(save).toHaveBeenCalledTimes(1);
    expect(visitFetches()).toBe(2);

    await act(async () => {
      finishSave();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.notes.dirty).toBe(false);
    await advance(VISIT_REFETCH_MS);
    expect(visitFetches()).toBe(3);
  });

  it('refetches on window focus even while a group is dirty', async () => {
    const save = vi.fn(() => new Promise<void>(() => undefined));
    const { result } = renderHook(
      () => ({
        visit: useVisit(VISIT_ID),
        notes: useSaveGroup({ key: 'notes', serverValue: '', save }),
      }),
      { wrapper },
    );
    await advance(0);
    act(() => {
      result.current.notes.setValue('typing');
    });
    await advance(0);
    expect(visitFetches()).toBe(1);

    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(visitFetches()).toBe(2);
    expect(result.current.notes.value).toBe('typing');
    focusManager.setFocused(undefined);
  });
});
