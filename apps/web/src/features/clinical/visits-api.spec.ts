import type { Visit } from '@dcm/contracts';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.fn();

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    apiFetch: (...args: unknown[]): Promise<unknown> => apiFetchMock(...args) as Promise<unknown>,
  };
});

const api = await import('./visits-api');
const { clinicalKeys, visitKeys, visitMutations, startVisitMutation } = api;

const VISIT_ID = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d01';
const PATIENT_ID = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d02';
const RECORD_ID = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d03';

const visit = { id: VISIT_ID, patientId: PATIENT_ID, status: 'in_progress' } as Visit;

/** `queryOptions()`'s `queryFn` is typed to take a `QueryFunctionContext`; every `queryFn` here
 * ignores it, so tests call it with none. */
async function runQueryFn(options: { queryFn?: unknown }): Promise<unknown> {
  return (options.queryFn as () => Promise<unknown>)();
}

/** Runs a mutation option set the way `useMutation` would: the function, then `onSuccess`. */
async function runMutation<TVariables>(
  options: {
    mutationFn?: (variables: TVariables, context: never) => Promise<unknown>;
    onSuccess?: (data: never, variables: TVariables, result: never, context: never) => unknown;
  },
  variables: TVariables,
): Promise<void> {
  const data = await options.mutationFn?.(variables, undefined as never);
  await options.onSuccess?.(data as never, variables, undefined as never, undefined as never);
}

function seededClient() {
  const client = new QueryClient();
  const keys = {
    chart: clinicalKeys.chart(PATIENT_ID),
    history: clinicalKeys.toothHistory(PATIENT_ID, '16'),
    summary: clinicalKeys.summary(PATIENT_ID),
    lastVisit: clinicalKeys.lastVisit(PATIENT_ID),
    live: visitKeys.live({ mine: true }),
  };
  for (const key of Object.values(keys)) client.setQueryData(key, {});
  const stale = (key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated ?? false;
  return { client, keys, stale };
}

afterEach(() => {
  apiFetchMock.mockReset();
});

describe('query keys', () => {
  it('uses the plan’s keys', () => {
    expect(visitKeys.detail(VISIT_ID)).toEqual(['visit', VISIT_ID]);
    expect(visitKeys.live({ mine: true })).toEqual(['visits', 'live', { mine: true }]);
    expect(clinicalKeys.chart(PATIENT_ID)).toEqual(['clinical', 'chart', PATIENT_ID]);
  });

  it('nests every tooth history of a patient under one prefix', () => {
    expect(clinicalKeys.toothHistory(PATIENT_ID, '16').slice(0, 3)).toEqual(
      clinicalKeys.toothHistories(PATIENT_ID),
    );
  });
});

describe('queries', () => {
  it.each([
    ['visit', () => api.visitQuery(VISIT_ID), `/visits/${VISIT_ID}`],
    ['live (no filter)', () => api.liveVisitsQuery({}), '/visits/live'],
    [
      'live (filtered)',
      () => api.liveVisitsQuery({ patientId: PATIENT_ID, mine: true }),
      `/visits/live?patientId=${PATIENT_ID}&mine=true`,
    ],
    ['start defaults', () => api.startDefaultsQuery(), '/visits/start-defaults'],
    ['chart', () => api.chartQuery(PATIENT_ID), `/clinical/patients/${PATIENT_ID}/chart`],
    [
      'tooth history',
      () => api.toothHistoryQuery(PATIENT_ID, '16'),
      `/clinical/patients/${PATIENT_ID}/teeth/16/history`,
    ],
    [
      'last visit',
      () => api.lastVisitQuery(PATIENT_ID),
      `/clinical/patients/${PATIENT_ID}/last-visit`,
    ],
    [
      'summary',
      () => api.clinicalSummaryQuery(PATIENT_ID),
      `/clinical/patients/${PATIENT_ID}/summary`,
    ],
  ])('%s requests its route', async (_name, build, path) => {
    apiFetchMock.mockResolvedValueOnce({});
    await runQueryFn(build());
    expect(apiFetchMock).toHaveBeenCalledWith(path, expect.anything());
  });
});

describe('visit mutations', () => {
  const service = RECORD_ID;
  const cases: [
    string,
    keyof ReturnType<typeof visitMutations>,
    unknown,
    string,
    string,
    unknown?,
  ][] = [
    ['pause', 'pause', undefined, 'POST', `/visits/${VISIT_ID}/pause`],
    ['resume', 'resume', undefined, 'POST', `/visits/${VISIT_ID}/resume`],
    ['discard', 'discard', undefined, 'POST', `/visits/${VISIT_ID}/discard`],
    ['complete', 'complete', undefined, 'POST', `/visits/${VISIT_ID}/complete`],
    ['notes', 'updateNotes', { notes: 'x' }, 'PATCH', `/visits/${VISIT_ID}/notes`, { notes: 'x' }],
    [
      'discount',
      'setDiscount',
      { mode: 'percent', value: '10' },
      'PATCH',
      `/visits/${VISIT_ID}/discount`,
      { mode: 'percent', value: '10' },
    ],
    [
      'add service',
      'addService',
      { procedureId: RECORD_ID, surfaces: [] },
      'POST',
      `/visits/${VISIT_ID}/services`,
      { procedureId: RECORD_ID, surfaces: [] },
    ],
    [
      'update service',
      'updateService',
      { serviceId: service, patch: { baseAmount: '12.00' } },
      'PATCH',
      `/visits/${VISIT_ID}/services/${service}`,
      { baseAmount: '12.00' },
    ],
    [
      'remove service',
      'removeService',
      service,
      'DELETE',
      `/visits/${VISIT_ID}/services/${service}`,
    ],
    [
      'record diagnosis',
      'recordDiagnosis',
      { diagnosisId: RECORD_ID, toothCode: '16', surfaces: [], note: null },
      'POST',
      `/visits/${VISIT_ID}/diagnoses`,
      { diagnosisId: RECORD_ID, toothCode: '16', surfaces: [], note: null },
    ],
    [
      'resolve diagnosis',
      'resolveDiagnosis',
      RECORD_ID,
      'POST',
      `/visits/${VISIT_ID}/diagnoses/${RECORD_ID}/resolve`,
    ],
    [
      'reopen diagnosis',
      'reopenDiagnosis',
      RECORD_ID,
      'POST',
      `/visits/${VISIT_ID}/diagnoses/${RECORD_ID}/reopen`,
    ],
    [
      'remove diagnosis',
      'removeDiagnosis',
      RECORD_ID,
      'DELETE',
      `/visits/${VISIT_ID}/diagnoses/${RECORD_ID}`,
    ],
    [
      'plan treatment',
      'planTreatment',
      { procedureId: RECORD_ID, surfaces: [], note: null },
      'POST',
      `/visits/${VISIT_ID}/plans`,
      { procedureId: RECORD_ID, surfaces: [], note: null },
    ],
    [
      'perform plan',
      'performPlan',
      RECORD_ID,
      'POST',
      `/visits/${VISIT_ID}/plans/${RECORD_ID}/perform`,
    ],
    [
      'cancel plan',
      'cancelPlan',
      RECORD_ID,
      'POST',
      `/visits/${VISIT_ID}/plans/${RECORD_ID}/cancel`,
    ],
    ['remove plan', 'removePlan', RECORD_ID, 'DELETE', `/visits/${VISIT_ID}/plans/${RECORD_ID}`],
    [
      'tooth presence',
      'setToothPresence',
      { position: '14', present: 'primary' },
      'PUT',
      `/visits/${VISIT_ID}/teeth/14`,
      { present: 'primary' },
    ],
  ];

  it.each(cases)('%s calls its route', async (_name, key, variables, method, path, json) => {
    apiFetchMock.mockResolvedValueOnce({ visit });
    const options = visitMutations(new QueryClient(), VISIT_ID)[key];
    await runMutation(options as Parameters<typeof runMutation>[0], variables);
    expect(apiFetchMock).toHaveBeenCalledWith(
      path,
      expect.anything(),
      json === undefined ? { method } : { method, json },
    );
  });

  it('writes the returned visit into its cache without a refetch', async () => {
    const { client, stale } = seededClient();
    apiFetchMock.mockResolvedValueOnce({ visit: { ...visit, notes: 'saved' } });
    await runMutation(visitMutations(client, VISIT_ID).updateNotes, { notes: 'saved' });
    expect(client.getQueryData<Visit>(visitKeys.detail(VISIT_ID))?.notes).toBe('saved');
    expect(stale(clinicalKeys.chart(PATIENT_ID))).toBe(false);
  });

  it('a record change also invalidates the patient’s chart, tooth histories and summary', async () => {
    const { client, keys, stale } = seededClient();
    apiFetchMock.mockResolvedValueOnce({ visit, record: {} });
    await runMutation(visitMutations(client, VISIT_ID).resolveDiagnosis, RECORD_ID);
    expect(client.getQueryData(visitKeys.detail(VISIT_ID))).toEqual(visit);
    expect(stale(keys.chart)).toBe(true);
    expect(stale(keys.history)).toBe(true);
    expect(stale(keys.summary)).toBe(true);
    expect(stale(keys.live)).toBe(false);
  });

  it('adding a service invalidates the chart (a treated-today tooth)', async () => {
    const { client, keys, stale } = seededClient();
    apiFetchMock.mockResolvedValueOnce({ visit });
    await runMutation(visitMutations(client, VISIT_ID).addService, {
      procedureId: RECORD_ID,
      surfaces: [],
    });
    expect(stale(keys.chart)).toBe(true);
  });

  it('pausing refreshes the live-visit pill', async () => {
    const { client, keys, stale } = seededClient();
    apiFetchMock.mockResolvedValueOnce({ visit: { ...visit, status: 'paused' } });
    await runMutation(visitMutations(client, VISIT_ID).pause, undefined);
    expect(stale(keys.live)).toBe(true);
    expect(stale(keys.chart)).toBe(false);
  });

  it('completing refreshes every read the completed visit changes', async () => {
    const { client, keys, stale } = seededClient();
    client.setQueryData(['billing', null, 'balance', PATIENT_ID], {});
    apiFetchMock.mockResolvedValueOnce({ visit: { ...visit, status: 'completed' } });
    await runMutation(visitMutations(client, VISIT_ID).complete, undefined);
    for (const key of Object.values(keys)) expect(stale(key)).toBe(true);
    expect(stale(['billing', null, 'balance', PATIENT_ID])).toBe(true);
  });
});

describe('startVisitMutation', () => {
  it('posts the start and caches the (new or resumed) visit', async () => {
    const { client, keys, stale } = seededClient();
    apiFetchMock.mockResolvedValueOnce({ visit, resumed: true });
    const input = { patientId: PATIENT_ID, dentistId: RECORD_ID };
    await runMutation(startVisitMutation(client), input);
    expect(apiFetchMock).toHaveBeenCalledWith('/visits', expect.anything(), {
      method: 'POST',
      json: input,
    });
    expect(client.getQueryData(visitKeys.detail(VISIT_ID))).toEqual(visit);
    expect(stale(keys.live)).toBe(true);
    expect(stale(keys.chart)).toBe(true);
  });
});
