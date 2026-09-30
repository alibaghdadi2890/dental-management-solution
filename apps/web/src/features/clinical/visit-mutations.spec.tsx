import type { Visit } from '@dcm/contracts';
import {
  MutationObserver,
  type MutationOptions,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    apiFetch: (...args: unknown[]): Promise<unknown> => apiFetchMock(...args) as Promise<unknown>,
  };
});

const { clinicalKeys, visitKeys, visitQuery } = await import('./visits-api');
const { startVisitMutation, useVisitMutations, visitMutations } = await import('./visit-mutations');

const VISIT_ID = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d01';
const PATIENT_ID = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d02';
const RECORD_ID = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d03';
const TENANT = null;

const visit = (extra: Partial<Visit> = {}) =>
  ({ id: VISIT_ID, patientId: PATIENT_ID, status: 'in_progress', notes: '', ...extra }) as Visit;

const detailKey = visitKeys.detail(TENANT, VISIT_ID);

/** Runs mutation options through the client's mutation cache, as `useMutation` would. */
function run<TData, TVariables, TContext>(
  client: QueryClient,
  options: MutationOptions<TData, Error, TVariables, TContext>,
  variables: TVariables,
): Promise<TData> {
  return new MutationObserver(client, options).mutate(variables);
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** A client holding a visit and every read a mutation may make stale. */
function seededClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const keys = {
    chart: clinicalKeys.chart(TENANT, PATIENT_ID),
    history: clinicalKeys.toothHistory(TENANT, PATIENT_ID, '16'),
    summary: clinicalKeys.summary(TENANT, PATIENT_ID),
    lastVisit: clinicalKeys.lastVisit(TENANT, PATIENT_ID),
    live: visitKeys.live(TENANT, { mine: true }),
    patients: ['patients', TENANT, 'detail', PATIENT_ID],
    balance: ['billing', TENANT, 'balance', PATIENT_ID],
  };
  for (const key of Object.values(keys)) client.setQueryData(key, {});
  client.setQueryData(detailKey, visit());
  const stale = (key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated ?? false;
  const cached = () => client.getQueryData<Visit>(detailKey);
  return { client, keys, stale, cached };
}

afterEach(() => {
  apiFetchMock.mockReset();
});

describe('visitMutations — cache effects', () => {
  it('writes the returned visit into its cache without a refetch', async () => {
    const { client, keys, stale, cached } = seededClient();
    apiFetchMock.mockResolvedValueOnce({ visit: visit({ notes: 'saved' }) });
    await run(client, visitMutations(client, VISIT_ID).updateNotes, { notes: 'saved' });
    expect(cached()?.notes).toBe('saved');
    expect(stale(detailKey)).toBe(false);
    expect(stale(keys.chart)).toBe(false);
  });

  it('a record change also invalidates the chart, tooth histories and summary', async () => {
    const { client, keys, stale, cached } = seededClient();
    apiFetchMock.mockResolvedValueOnce({ visit: visit({ notes: 'new' }), record: {} });
    await run(client, visitMutations(client, VISIT_ID).resolveDiagnosis, RECORD_ID);
    expect(cached()?.notes).toBe('new');
    expect(stale(keys.chart)).toBe(true);
    expect(stale(keys.history)).toBe(true);
    expect(stale(keys.summary)).toBe(true);
    expect(stale(keys.live)).toBe(false);
  });

  it('adding a service invalidates the chart (a treated-today tooth); a price edit does not', async () => {
    const { client, keys, stale } = seededClient();
    const mutations = visitMutations(client, VISIT_ID);
    apiFetchMock.mockResolvedValue({ visit: visit(), record: {} });
    await run(client, mutations.updateService, {
      serviceId: RECORD_ID,
      patch: { baseAmount: '12.00' },
    });
    expect(stale(keys.chart)).toBe(false);
    await run(client, mutations.addService, { procedureId: RECORD_ID, surfaces: [] });
    expect(stale(keys.chart)).toBe(true);
  });

  it('pausing refreshes the live-visit pill only', async () => {
    const { client, keys, stale, cached } = seededClient();
    apiFetchMock.mockResolvedValueOnce({ visit: visit({ status: 'paused' }) });
    await run(client, visitMutations(client, VISIT_ID).pause, undefined);
    expect(cached()?.status).toBe('paused');
    expect(stale(keys.live)).toBe(true);
    expect(stale(keys.chart)).toBe(false);
  });

  it('discarding drops the visit from the cache', async () => {
    const { client, keys, stale } = seededClient();
    apiFetchMock.mockResolvedValueOnce({ visit: visit({ status: 'discarded' }) });
    await run(client, visitMutations(client, VISIT_ID).discard, undefined);
    expect(client.getQueryState(detailKey)).toBeUndefined();
    expect(stale(keys.live)).toBe(true);
    expect(stale(keys.chart)).toBe(true);
  });

  it('completing refreshes every read the completed visit changes, patients and balances too', async () => {
    const { client, keys, stale, cached } = seededClient();
    apiFetchMock.mockResolvedValueOnce({ visit: visit({ status: 'completed' }) });
    await run(client, visitMutations(client, VISIT_ID).complete, undefined);
    expect(cached()?.status).toBe('completed');
    for (const key of Object.values(keys)) expect(stale(key)).toBe(true);
  });

  it('startVisitMutation posts, caches the (new or resumed) visit and refreshes the live lists', async () => {
    const { client, keys, stale, cached } = seededClient();
    client.removeQueries({ queryKey: detailKey });
    apiFetchMock.mockResolvedValueOnce({ visit: visit(), resumed: true });
    await run(client, startVisitMutation(client), {
      patientId: PATIENT_ID,
      dentistId: RECORD_ID,
    });
    expect(cached()).toEqual(visit());
    expect(stale(keys.live)).toBe(true);
    expect(stale(keys.chart)).toBe(true);
  });
});

describe('visitMutations — stale refetches', () => {
  /** The visit GET answers `pendingGet`; every other call answers `mutationAnswer`. */
  function routeFetches(pendingGet: Promise<unknown>, mutationAnswer: Promise<unknown>) {
    apiFetchMock.mockImplementation((path: string) =>
      path === `/visits/${VISIT_ID}` ? pendingGet : mutationAnswer,
    );
  }

  it('keeps the mutation’s visit when a refetch in flight resolves after it', async () => {
    const { client, cached } = seededClient();
    const get = deferred<Visit>();
    routeFetches(get.promise, Promise.resolve({ visit: visit({ notes: 'mutated' }) }));

    const refetch = client.query({ ...visitQuery(VISIT_ID), staleTime: 0 }).catch(() => undefined);
    await run(client, visitMutations(client, VISIT_ID).updateNotes, { notes: 'mutated' });
    get.resolve(visit({ notes: 'before the mutation' }));
    await refetch;

    expect(cached()?.notes).toBe('mutated');
  });

  it('also cancels a refetch that started while the mutation was in flight', async () => {
    const { client, cached } = seededClient();
    const get = deferred<Visit>();
    const answer = deferred<unknown>();
    routeFetches(get.promise, answer.promise);

    const mutation = run(client, visitMutations(client, VISIT_ID).updateNotes, {
      notes: 'mutated',
    });
    const refetch = client.query({ ...visitQuery(VISIT_ID), staleTime: 0 }).catch(() => undefined);
    answer.resolve({ visit: visit({ notes: 'mutated' }) });
    await mutation;
    get.resolve(visit({ notes: 'before the mutation' }));
    await refetch;

    expect(cached()?.notes).toBe('mutated');
  });

  it('refetches instead of writing while another mutation of the visit is in flight', async () => {
    const { client, cached, stale } = seededClient();
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    apiFetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const mutations = visitMutations(client, VISIT_ID);

    const notes = run(client, mutations.updateNotes, { notes: 'first' });
    const pause = run(client, mutations.pause, undefined);
    first.resolve({ visit: visit({ notes: 'first' }) });
    await notes;
    expect(cached()?.notes).toBe('');
    expect(stale(detailKey)).toBe(true);

    second.resolve({ visit: visit({ notes: 'first', status: 'paused' }) });
    await pause;
    expect(cached()).toMatchObject({ notes: 'first', status: 'paused' });
  });
});

describe('useVisitMutations', () => {
  it('is stable across renders', () => {
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(() => useVisitMutations(VISIT_ID), { wrapper });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    expect(first.pause.mutationKey).toEqual(detailKey);
  });
});
