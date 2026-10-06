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
const { clinicalKeys, visitKeys } = api;

const VISIT_ID = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d01';
const PATIENT_ID = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d02';
const RECORD_ID = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d03';

/** `queryOptions()`'s `queryFn` is typed to take a `QueryFunctionContext`; every `queryFn` here
 * ignores it, so tests call it with none. */
async function runQueryFn(options: { queryFn?: unknown }): Promise<unknown> {
  return (options.queryFn as () => Promise<unknown>)();
}

afterEach(() => {
  apiFetchMock.mockReset();
  sessionStorage.clear();
});

describe('query keys', () => {
  it('scopes every key under the tenant, distinct per tenant', () => {
    expect(visitKeys.detail('t1', VISIT_ID)).not.toEqual(visitKeys.detail('t2', VISIT_ID));
    expect(visitKeys.live('t1', {})).not.toEqual(visitKeys.live('t2', {}));
    expect(visitKeys.startDefaults('t1')).not.toEqual(visitKeys.startDefaults('t2'));
    expect(clinicalKeys.chart('t1', PATIENT_ID)).not.toEqual(clinicalKeys.chart('t2', PATIENT_ID));
  });

  it('nests each key under its umbrella, so one invalidation covers a tenant', () => {
    const under = (key: readonly unknown[], prefix: readonly unknown[]) => {
      expect(key.slice(0, prefix.length)).toEqual(prefix);
    };
    under(visitKeys.detail('t1', VISIT_ID), visitKeys.all('t1'));
    under(visitKeys.live('t1', { mine: true }), visitKeys.allLive('t1'));
    under(visitKeys.startDefaults('t1'), visitKeys.all('t1'));
    under(
      clinicalKeys.toothHistory('t1', PATIENT_ID, '16'),
      clinicalKeys.toothHistories('t1', PATIENT_ID),
    );
    under(clinicalKeys.summary('t1', PATIENT_ID), clinicalKeys.all('t1'));
    under(clinicalKeys.lastVisit('t1', PATIENT_ID), clinicalKeys.all('t1'));
  });

  it('is null-tenant for no acting tenant, not the literal string "null"', () => {
    expect(visitKeys.all(null)).toEqual(['visits', null]);
    expect(clinicalKeys.all(null)).toEqual(['clinical', null]);
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
    expect(apiFetchMock).toHaveBeenCalledWith(path, expect.anything(), {});
  });

  it('keys by the acting tenant when none is given explicitly', () => {
    sessionStorage.setItem('dcm.actingTenantId', 'tenant-1');
    expect(api.visitQuery(VISIT_ID).queryKey).toEqual(visitKeys.detail('tenant-1', VISIT_ID));
    expect(api.chartQuery(PATIENT_ID).queryKey).toEqual(clinicalKeys.chart('tenant-1', PATIENT_ID));
  });

  it('forwards an explicit tenant to both the key and the request', async () => {
    const options = api.visitQuery(VISIT_ID, 'tenant-2');
    expect(options.queryKey).toEqual(visitKeys.detail('tenant-2', VISIT_ID));
    apiFetchMock.mockResolvedValueOnce({});
    await runQueryFn(options);
    expect(apiFetchMock).toHaveBeenCalledWith(expect.any(String), expect.anything(), {
      tenantId: 'tenant-2',
    });
  });
});

describe('writes', () => {
  it.each([
    [
      'start',
      () => api.startVisit({ patientId: PATIENT_ID, dentistId: RECORD_ID }),
      'POST',
      '/visits',
      { patientId: PATIENT_ID, dentistId: RECORD_ID },
    ],
    ['pause', () => api.pauseVisit(VISIT_ID), 'POST', `/visits/${VISIT_ID}/pause`],
    ['resume', () => api.resumeVisit(VISIT_ID), 'POST', `/visits/${VISIT_ID}/resume`],
    ['discard', () => api.discardVisit(VISIT_ID), 'POST', `/visits/${VISIT_ID}/discard`],
    ['complete', () => api.completeVisit(VISIT_ID), 'POST', `/visits/${VISIT_ID}/complete`],
    [
      'notes',
      () => api.updateVisitNotes(VISIT_ID, { notes: 'x' }),
      'PATCH',
      `/visits/${VISIT_ID}/notes`,
      { notes: 'x' },
    ],
    [
      'discount',
      () => api.setVisitDiscount(VISIT_ID, { mode: 'percent', value: '10' }),
      'PATCH',
      `/visits/${VISIT_ID}/discount`,
      { mode: 'percent', value: '10' },
    ],
    [
      'add service',
      () => api.addService(VISIT_ID, { procedureId: RECORD_ID, surfaces: [] }),
      'POST',
      `/visits/${VISIT_ID}/services`,
      { procedureId: RECORD_ID, surfaces: [] },
    ],
    [
      'update service',
      () => api.updateService(VISIT_ID, RECORD_ID, { baseAmount: '12.00' }),
      'PATCH',
      `/visits/${VISIT_ID}/services/${RECORD_ID}`,
      { baseAmount: '12.00' },
    ],
    [
      'remove service',
      () => api.removeService(VISIT_ID, RECORD_ID),
      'DELETE',
      `/visits/${VISIT_ID}/services/${RECORD_ID}`,
    ],
    [
      'record diagnosis',
      () =>
        api.recordDiagnosis(VISIT_ID, {
          diagnosisId: RECORD_ID,
          toothCode: '16',
          surfaces: [],
          note: null,
        }),
      'POST',
      `/visits/${VISIT_ID}/diagnoses`,
      { diagnosisId: RECORD_ID, toothCode: '16', surfaces: [], note: null },
    ],
    [
      'resolve diagnosis',
      () => api.resolveDiagnosis(VISIT_ID, RECORD_ID),
      'POST',
      `/visits/${VISIT_ID}/diagnoses/${RECORD_ID}/resolve`,
    ],
    [
      'reopen diagnosis',
      () => api.reopenDiagnosis(VISIT_ID, RECORD_ID),
      'POST',
      `/visits/${VISIT_ID}/diagnoses/${RECORD_ID}/reopen`,
    ],
    [
      'remove diagnosis',
      () => api.removeDiagnosis(VISIT_ID, RECORD_ID),
      'DELETE',
      `/visits/${VISIT_ID}/diagnoses/${RECORD_ID}`,
    ],
    [
      'plan treatment',
      () => api.planTreatment(VISIT_ID, { procedureId: RECORD_ID, surfaces: [], note: null }),
      'POST',
      `/visits/${VISIT_ID}/plans`,
      { procedureId: RECORD_ID, surfaces: [], note: null },
    ],
    [
      'perform plan',
      () => api.performPlan(VISIT_ID, RECORD_ID),
      'POST',
      `/visits/${VISIT_ID}/plans/${RECORD_ID}/perform`,
    ],
    [
      'cancel plan',
      () => api.cancelPlan(VISIT_ID, RECORD_ID),
      'POST',
      `/visits/${VISIT_ID}/plans/${RECORD_ID}/cancel`,
    ],
    [
      'remove plan',
      () => api.removePlan(VISIT_ID, RECORD_ID),
      'DELETE',
      `/visits/${VISIT_ID}/plans/${RECORD_ID}`,
    ],
  ] as [string, () => Promise<unknown>, string, string, unknown?][])(
    '%s calls its route',
    async (_name, call, method, path, json) => {
      apiFetchMock.mockResolvedValueOnce({});
      await call();
      expect(apiFetchMock).toHaveBeenCalledWith(
        path,
        expect.anything(),
        json === undefined ? { method } : { method, json },
      );
    },
  );
});

describe('writes — tenant', () => {
  it('forwards an explicit tenant with the request', async () => {
    apiFetchMock.mockResolvedValue({});
    await api.addService(VISIT_ID, { procedureId: RECORD_ID, surfaces: [] }, 'tenant-2');
    await api.pauseVisit(VISIT_ID, 'tenant-2');
    await api.startVisit({ patientId: PATIENT_ID, dentistId: RECORD_ID }, 'tenant-2');
    expect(apiFetchMock).toHaveBeenNthCalledWith(
      1,
      `/visits/${VISIT_ID}/services`,
      expect.anything(),
      {
        method: 'POST',
        json: { procedureId: RECORD_ID, surfaces: [] },
        tenantId: 'tenant-2',
      },
    );
    expect(apiFetchMock).toHaveBeenNthCalledWith(
      2,
      `/visits/${VISIT_ID}/pause`,
      expect.anything(),
      {
        method: 'POST',
        tenantId: 'tenant-2',
      },
    );
    expect(apiFetchMock).toHaveBeenNthCalledWith(3, '/visits', expect.anything(), {
      method: 'POST',
      json: { patientId: PATIENT_ID, dentistId: RECORD_ID },
      tenantId: 'tenant-2',
    });
  });
});
