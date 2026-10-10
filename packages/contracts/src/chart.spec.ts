import { describe, expect, it } from 'vitest';
import { cellMark, currentPresence, deriveChart, type DeriveChartInput } from './chart.js';
import type { DiagnosisRecord, HistoryService, TreatmentPlan } from './clinical-records.js';
import type { CatalogMark } from './marks.js';
import type { ToothCode } from './tooth.js';
import type { VisitService } from './visits.js';

const ID = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6e';
const ID_2 = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d71';
const ID_3 = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d72';
const ID_4 = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d73';
const VISIT_ID = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d6f';
const DENTIST_ID = '01928c6e-7b8a-7cc2-9d7e-3f1a2b4c5d70';
const MONEY = { amount: '80.00', currency: 'USD' };

/** `deriveChart` without presence rows, which most cases here have nothing to do with. */
const derive = (
  input: Omit<DeriveChartInput, 'presence' | 'marks' | 'liveVisit'> & Partial<DeriveChartInput>,
) => deriveChart({ presence: [], marks: new Map(), liveVisit: null, ...input });

function diagnosis(
  overrides: Partial<DiagnosisRecord> & { toothCode: ToothCode },
): DiagnosisRecord {
  return {
    id: ID,
    patientId: ID,
    surfaces: [],
    diagnosisId: ID,
    code: 'K02.9',
    name: 'Dental caries',
    category: null,
    status: 'active',
    note: null,
    dentistId: DENTIST_ID,
    dentistName: 'Dr. Smith',
    recordedBy: ID,
    recordedInVisitId: VISIT_ID,
    recordedDate: '2026-09-30',
    recordedAt: '2026-09-30T10:00:00.000Z',
    resolvedInVisitId: null,
    resolvedAt: null,
    ...overrides,
  };
}

function plan(overrides: Partial<TreatmentPlan> & { toothCode: ToothCode | null }): TreatmentPlan {
  return {
    id: ID,
    patientId: ID,
    jaw: null,
    surfaces: [],
    procedureId: ID,
    code: 'D2740',
    name: 'Zircon Crown',
    category: null,
    chargeUnit: 'per_tooth',
    price: { amount: '500.00', currency: 'USD' },
    diagnosisRecordId: null,
    status: 'planned',
    note: null,
    dentistId: DENTIST_ID,
    dentistName: 'Dr. Smith',
    recordedBy: ID,
    recordedInVisitId: VISIT_ID,
    recordedAt: '2026-09-30T10:00:00.000Z',
    groupId: null,
    startedInVisitId: null,
    startedAt: null,
    sessions: [],
    performedInVisitId: null,
    performedAt: null,
    cancelledInVisitId: null,
    cancelledAt: null,
    ...overrides,
  };
}

function history(
  overrides: Partial<HistoryService> & { toothCode: ToothCode | null },
): HistoryService {
  return {
    id: ID,
    visitId: VISIT_ID,
    visitDate: '2026-09-01',
    dentistName: 'Dr. Smith',
    procedureId: ID,
    code: 'D2140',
    name: 'Amalgam Filling',
    jaw: null,
    surfaces: [],
    final: MONEY,
    planId: null,
    ...overrides,
  };
}

function liveService(
  overrides: Partial<VisitService> & { toothCode: ToothCode | null },
): VisitService {
  return {
    id: ID,
    procedureId: ID,
    code: 'D2140',
    name: 'Amalgam Filling',
    category: null,
    chargeUnit: 'per_tooth',
    jaw: null,
    surfaces: [],
    base: MONEY,
    discount: { amount: '0.00', currency: 'USD' },
    final: MONEY,
    planId: null,
    recordedBy: ID,
    createdAt: '2026-09-30T10:05:00.000Z',
    ...overrides,
  };
}

describe('deriveChart', () => {
  it('returns an empty map given no records', () => {
    const chart = derive({ diagnoses: [], plans: [], history: [], liveServices: [] });
    expect(chart.size).toBe(0);
  });

  it('marks a tooth with an open plan as planned', () => {
    const chart = derive({
      diagnoses: [],
      plans: [plan({ toothCode: '16' })],
      history: [],
      liveServices: [],
    });
    const tooth = chart.get('16');
    expect(tooth?.state).toBe('planned');
    expect(tooth?.openPlanIds).toEqual([ID]);
    expect(tooth?.titleParts.plans).toEqual(['Zircon Crown']);
  });

  it('a whole-tooth history service tints wholeTooth as treated, and state as treated', () => {
    const chart = derive({
      diagnoses: [],
      plans: [],
      history: [history({ toothCode: '16', surfaces: [] })],
      liveServices: [],
    });
    const tooth = chart.get('16');
    expect(tooth?.wholeTooth).toBe('treated');
    expect(tooth?.state).toBe('treated');
    expect(tooth?.surfaces).toEqual({});
  });

  it('treated (history) outranks planned', () => {
    const chart = derive({
      diagnoses: [],
      plans: [plan({ toothCode: '16' })],
      history: [history({ toothCode: '16', surfaces: [] })],
      liveServices: [],
    });
    expect(chart.get('16')?.state).toBe('treated');
  });

  it('treated_today (live) outranks treated (history)', () => {
    const chart = derive({
      diagnoses: [],
      plans: [],
      history: [history({ toothCode: '16', surfaces: [] })],
      liveServices: [liveService({ toothCode: '16', surfaces: [] })],
    });
    expect(chart.get('16')?.state).toBe('treated_today');
    expect(chart.get('16')?.wholeTooth).toBe('treated_today');
  });

  it('a started plan shows as in progress, above earlier treatment and below today’s', () => {
    const started = plan({ toothCode: '16', status: 'in_progress' });
    const tooth = (extra: Partial<Parameters<typeof deriveChart>[0]> = {}) =>
      derive({ diagnoses: [], plans: [started], history: [], liveServices: [], ...extra }).get(
        '16',
      );
    expect(tooth()?.state).toBe('in_progress');
    expect(tooth()?.openPlanIds).toEqual([started.id]);
    expect(tooth({ history: [history({ toothCode: '16' })] })?.state).toBe('in_progress');
    expect(tooth({ liveServices: [liveService({ toothCode: '16' })] })?.state).toBe(
      'treated_today',
    );
    // One started plan among several open ones is enough.
    expect(tooth({ plans: [plan({ toothCode: '16', id: ID_2 }), started] })?.state).toBe(
      'in_progress',
    );
  });

  it('planned outranks none (no other records)', () => {
    const chart = derive({
      diagnoses: [],
      plans: [plan({ toothCode: '24' })],
      history: [],
      liveServices: [],
    });
    expect(chart.get('24')?.state).toBe('planned');
  });

  it('a tooth with nothing recorded is absent from the map', () => {
    const chart = derive({
      diagnoses: [],
      plans: [plan({ toothCode: '24' })],
      history: [],
      liveServices: [],
    });
    expect(chart.has('25')).toBe(false);
  });

  it('a surface-scoped service marks only that surface, leaving wholeTooth null', () => {
    const chart = derive({
      diagnoses: [],
      plans: [],
      history: [history({ toothCode: '16', surfaces: ['M', 'O'] })],
      liveServices: [],
    });
    const tooth = chart.get('16');
    expect(tooth?.wholeTooth).toBeNull();
    expect(tooth?.surfaces).toEqual({ M: 'treated', O: 'treated' });
  });

  it('a live service overrides a historic one on the same surface', () => {
    const chart = derive({
      diagnoses: [],
      plans: [],
      history: [history({ toothCode: '16', surfaces: ['M'] })],
      liveServices: [liveService({ toothCode: '16', surfaces: ['M'] })],
    });
    expect(chart.get('16')?.surfaces).toEqual({ M: 'treated_today' });
  });

  it('a live service on a different surface leaves the historic surface mark untouched', () => {
    const chart = derive({
      diagnoses: [],
      plans: [],
      history: [history({ toothCode: '16', surfaces: ['M'] })],
      liveServices: [liveService({ toothCode: '16', surfaces: ['D'] })],
    });
    expect(chart.get('16')?.surfaces).toEqual({ M: 'treated', D: 'treated_today' });
  });

  it('a performed plan does not count as planned', () => {
    const chart = derive({
      diagnoses: [],
      plans: [
        plan({ toothCode: '16', status: 'performed', performedAt: '2026-09-30T10:00:00.000Z' }),
      ],
      history: [],
      liveServices: [],
    });
    expect(chart.has('16')).toBe(false);
  });

  it('a cancelled plan does not count as planned', () => {
    const chart = derive({
      diagnoses: [],
      plans: [
        plan({ toothCode: '16', status: 'cancelled', cancelledAt: '2026-09-30T10:00:00.000Z' }),
      ],
      history: [],
      liveServices: [],
    });
    expect(chart.has('16')).toBe(false);
  });

  it('a resolved diagnosis does not set hasActiveDiagnosis', () => {
    const chart = derive({
      diagnoses: [
        diagnosis({ toothCode: '16', status: 'resolved', resolvedAt: '2026-09-30T10:00:00.000Z' }),
      ],
      plans: [],
      history: [],
      liveServices: [],
    });
    expect(chart.has('16')).toBe(false);
  });

  it('an active diagnosis sets hasActiveDiagnosis and titleParts.diagnoses, without affecting state', () => {
    const chart = derive({
      diagnoses: [diagnosis({ toothCode: '16' })],
      plans: [],
      history: [],
      liveServices: [],
    });
    const tooth = chart.get('16');
    expect(tooth?.hasActiveDiagnosis).toBe(true);
    expect(tooth?.state).toBe('none');
    expect(tooth?.titleParts.diagnoses).toEqual(['Dental caries']);
  });

  it('jaw-level history and live services (toothCode null) touch no tooth', () => {
    const chart = derive({
      diagnoses: [],
      plans: [],
      history: [history({ toothCode: null })],
      liveServices: [liveService({ toothCode: null })],
    });
    expect(chart.size).toBe(0);
  });

  it('a jaw-level plan (toothCode null) touches no tooth', () => {
    const chart = derive({
      diagnoses: [],
      plans: [plan({ toothCode: null })],
      history: [],
      liveServices: [],
    });
    expect(chart.size).toBe(0);
  });

  it('counts historyCount from completed services only, not live ones', () => {
    const chart = derive({
      diagnoses: [],
      plans: [],
      history: [
        history({ toothCode: '16', surfaces: ['M'] }),
        history({ toothCode: '16', surfaces: ['D'] }),
      ],
      liveServices: [liveService({ toothCode: '16', surfaces: ['B'] })],
    });
    const tooth = chart.get('16');
    expect(tooth?.historyCount).toBe(2);
    expect(tooth?.titleParts.historyCount).toBe(2);
  });

  it('a surface-scoped plan leaves surfaces empty and sets state planned', () => {
    const chart = derive({
      diagnoses: [],
      plans: [plan({ toothCode: '16', surfaces: ['O'] })],
      history: [],
      liveServices: [],
    });
    const tooth = chart.get('16');
    expect(tooth?.state).toBe('planned');
    expect(tooth?.surfaces).toEqual({});
    expect(tooth?.wholeTooth).toBeNull();
  });

  it('treated_today (live service) outranks planned (open plan)', () => {
    const chart = derive({
      diagnoses: [],
      plans: [plan({ toothCode: '16' })],
      history: [],
      liveServices: [liveService({ toothCode: '16', surfaces: [] })],
    });
    expect(chart.get('16')?.state).toBe('treated_today');
  });

  it(
    'a whole-tooth history service plus a live surface service: state treated_today, ' +
      'wholeTooth treated, the live surface treated_today',
    () => {
      const chart = derive({
        diagnoses: [],
        plans: [],
        history: [history({ toothCode: '16', surfaces: [] })],
        liveServices: [liveService({ toothCode: '16', surfaces: ['M'] })],
      });
      expect(chart.get('16')).toMatchObject({
        state: 'treated_today',
        wholeTooth: 'treated',
        surfaces: { M: 'treated_today' },
      });
    },
  );

  it(
    'a whole-tooth open plan on a tooth with treated surfaces: state stays treated, the plan ' +
      'still counts as open',
    () => {
      const chart = derive({
        diagnoses: [],
        plans: [plan({ toothCode: '16', surfaces: [] })],
        history: [history({ toothCode: '16', surfaces: ['O'] })],
        liveServices: [],
      });
      const tooth = chart.get('16');
      expect(tooth?.state).toBe('treated');
      expect(tooth?.openPlanIds).toEqual([ID]);
      expect(tooth?.surfaces).toEqual({ O: 'treated' });
      expect(tooth?.wholeTooth).toBeNull();
    },
  );

  it('multiple open plans and active diagnoses on one tooth are each kept, in order', () => {
    const chart = derive({
      diagnoses: [
        diagnosis({ toothCode: '16', id: ID, diagnosisId: ID, name: 'Dental caries' }),
        diagnosis({ toothCode: '16', id: ID_2, diagnosisId: ID_2, name: 'Cracked tooth' }),
      ],
      plans: [
        plan({ toothCode: '16', id: ID_3, name: 'Composite Filling' }),
        plan({ toothCode: '16', id: ID_4, name: 'Zircon Crown' }),
      ],
      history: [],
      liveServices: [],
    });
    const tooth = chart.get('16');
    expect(tooth?.openPlanIds).toEqual([ID_3, ID_4]);
    expect(tooth?.titleParts.plans).toEqual(['Composite Filling', 'Zircon Crown']);
    expect(tooth?.titleParts.diagnoses).toEqual(['Dental caries', 'Cracked tooth']);
  });
});

describe('deriveChart: marks (feature 9)', () => {
  const mark = (overrides: Partial<CatalogMark> = {}): CatalogMark => ({
    color: 'blue',
    icon: null,
    priority: 5,
    name: 'Catalog name',
    code: 'CAT',
    active: true,
    ...overrides,
  });

  it('lists the active diagnoses of a tooth with the colour of their catalog item', () => {
    const chart = derive({
      diagnoses: [
        diagnosis({ toothCode: '46', id: ID, diagnosisId: ID_2, surfaces: ['M'] }),
        diagnosis({ toothCode: '46', id: ID_3, diagnosisId: ID_2, status: 'resolved' }),
      ],
      plans: [],
      history: [],
      liveServices: [],
      marks: new Map([[ID_2, mark({ color: 'rose', priority: 7 })]]),
    });
    expect(chart.get('46')?.diagnoses).toEqual([
      {
        recordId: ID,
        diagnosisId: ID_2,
        // The record's own snapshot, not the catalog's current name.
        code: 'K02.9',
        name: 'Dental caries',
        color: 'rose',
        priority: 7,
        surfaces: ['M'],
        recordedDate: '2026-09-30',
        dentistName: 'Dr. Smith',
      },
    ]);
    expect(chart.get('46')?.hasActiveDiagnosis).toBe(true);
  });

  it('lists finished and live services, the live visit dating its own', () => {
    const chart = derive({
      diagnoses: [],
      plans: [],
      history: [history({ toothCode: '36', id: ID, procedureId: ID_2, surfaces: ['O', 'D'] })],
      liveServices: [liveService({ toothCode: '36', id: ID_3, procedureId: ID_2, planId: ID_4 })],
      marks: new Map([[ID_2, mark({ icon: 'filling' })]]),
      liveVisit: { date: '2026-10-08', dentistName: 'Dr. Rami' },
    });
    expect(chart.get('36')?.services).toEqual([
      {
        recordId: ID_3,
        procedureId: ID_2,
        code: 'D2140',
        name: 'Amalgam Filling',
        color: 'blue',
        icon: 'filling',
        priority: 5,
        surfaces: [],
        status: 'treated_today',
        date: '2026-10-08',
        dentistName: 'Dr. Rami',
        planId: ID_4,
      },
      {
        recordId: ID,
        procedureId: ID_2,
        code: 'D2140',
        name: 'Amalgam Filling',
        color: 'blue',
        icon: 'filling',
        priority: 5,
        surfaces: ['O', 'D'],
        status: 'treated',
        date: '2026-09-01',
        dentistName: 'Dr. Smith',
        planId: null,
      },
    ]);
  });

  it('orders by priority, then the most recent, then the record made last', () => {
    const chart = derive({
      diagnoses: [],
      plans: [],
      history: [
        history({ toothCode: '16', id: ID, procedureId: ID, visitDate: '2026-01-10' }),
        history({ toothCode: '16', id: ID_2, procedureId: ID_2, visitDate: '2024-03-01' }),
        history({ toothCode: '16', id: ID_3, procedureId: ID, visitDate: '2026-05-02' }),
        history({ toothCode: '16', id: ID_4, procedureId: ID, visitDate: '2026-05-02' }),
      ],
      liveServices: [],
      marks: new Map([
        [ID, mark()],
        [ID_2, mark({ priority: 8 })],
      ]),
    });
    expect(chart.get('16')?.services.map((service) => service.recordId)).toEqual([
      ID_2,
      ID_4,
      ID_3,
      ID,
    ]);
  });

  it('keeps the mark of an inactive catalog item', () => {
    const chart = derive({
      diagnoses: [],
      plans: [],
      history: [history({ toothCode: '26', procedureId: ID_2 })],
      liveServices: [],
      marks: new Map([[ID_2, mark({ color: 'amber', icon: 'crown', active: false })]]),
    });
    expect(chart.get('26')?.services[0]).toMatchObject({ color: 'amber', icon: 'crown' });
  });

  it('derives a record whose catalog item is unknown, without a colour', () => {
    const chart = derive({
      diagnoses: [diagnosis({ toothCode: '11' })],
      plans: [],
      history: [history({ toothCode: '11' })],
      liveServices: [liveService({ toothCode: '11', id: ID_2 })],
    });
    const tooth = chart.get('11');
    expect(tooth?.diagnoses[0]).toMatchObject({ color: null, priority: 5 });
    expect(tooth?.services[0]).toMatchObject({ color: null, icon: null, priority: 5, date: null });
    expect(tooth?.services).toHaveLength(2);
  });

  it('says a plan is in progress even on a tooth treated today', () => {
    const chart = derive({
      diagnoses: [],
      plans: [plan({ toothCode: '21', status: 'in_progress' })],
      history: [],
      liveServices: [liveService({ toothCode: '21' })],
    });
    expect(chart.get('21')).toMatchObject({ state: 'treated_today', planInProgress: true });
    const planned = derive({
      diagnoses: [],
      plans: [plan({ toothCode: '21' })],
      history: [],
      liveServices: [],
    });
    expect(planned.get('21')?.planInProgress).toBe(false);
  });

  it('leaves jaw and mouth services out of every tooth', () => {
    const chart = derive({
      diagnoses: [],
      plans: [],
      history: [history({ toothCode: null, jaw: 'upper' })],
      liveServices: [],
    });
    expect(chart.size).toBe(0);
  });
});

describe('cellMark', () => {
  it('is none for a tooth absent from the chart', () => {
    expect(cellMark(undefined, 'M')).toBe('none');
  });

  it('is none for a recorded tooth with no mark on that surface and no whole-tooth mark', () => {
    const chart = derive({
      diagnoses: [diagnosis({ toothCode: '16' })],
      plans: [],
      history: [],
      liveServices: [],
    });
    expect(cellMark(chart.get('16'), 'M')).toBe('none');
  });

  it('falls back to the whole-tooth mark when the surface has none of its own', () => {
    const chart = derive({
      diagnoses: [],
      plans: [],
      history: [history({ toothCode: '16', surfaces: [] })],
      liveServices: [],
    });
    expect(cellMark(chart.get('16'), 'M')).toBe('treated');
  });

  it('prefers a surface mark over the whole-tooth mark', () => {
    const chart = derive({
      diagnoses: [],
      plans: [],
      history: [history({ toothCode: '16', surfaces: [] })],
      liveServices: [liveService({ toothCode: '16', surfaces: ['M'] })],
    });
    // The live surface service outranks the whole-tooth history mark on M; every other surface
    // still falls back to the whole-tooth 'treated' mark.
    expect(cellMark(chart.get('16'), 'M')).toBe('treated_today');
    expect(cellMark(chart.get('16'), 'D')).toBe('treated');
  });

  it('washes a cell in progress when the tooth state is, and the cell has no service mark', () => {
    const chart = derive({
      diagnoses: [],
      plans: [plan({ toothCode: '16', status: 'in_progress' })],
      history: [history({ toothCode: '16', surfaces: ['O'] })],
      liveServices: [],
    });
    expect(cellMark(chart.get('16'), 'M')).toBe('in_progress');
    expect(cellMark(chart.get('16'), 'O')).toBe('treated');
  });

  it('washes a cell planned when the tooth state is planned and the cell has no service mark', () => {
    const chart = derive({
      diagnoses: [],
      plans: [plan({ toothCode: '16', surfaces: ['O'] })],
      history: [],
      liveServices: [],
    });
    expect(cellMark(chart.get('16'), 'O')).toBe('planned');
    expect(cellMark(chart.get('16'), 'M')).toBe('planned');
  });
});

describe('tooth presence in the chart (feature 7, H1)', () => {
  const none = { diagnoses: [], plans: [], history: [], liveServices: [] };

  it('takes the row recorded last for a tooth, whatever came before', () => {
    const current = currentPresence([
      { toothCode: '46', presence: 'missing' },
      { toothCode: '18', presence: 'not_erupted' },
      { toothCode: '46', presence: 'implant' },
    ]);
    expect([...current]).toEqual([
      ['46', 'implant'],
      ['18', 'not_erupted'],
    ]);
  });

  it('gives a tooth that is not present an entry, even with nothing else on it', () => {
    const chart = derive({ ...none, presence: [{ toothCode: '36', presence: 'missing' }] });
    expect(chart.get('36')).toMatchObject({ presence: 'missing', state: 'none', historyCount: 0 });
    expect(chart.size).toBe(1);
  });

  it('leaves a tooth marked present again out, like any tooth with nothing recorded', () => {
    const chart = derive({
      ...none,
      presence: [
        { toothCode: '36', presence: 'missing' },
        { toothCode: '36', presence: 'present' },
      ],
    });
    expect(chart.has('36')).toBe(false);
  });

  it('keeps treatment and diagnoses on an implant: every state stays chartable (H3)', () => {
    const chart = derive({
      ...none,
      diagnoses: [diagnosis({ toothCode: '46' })],
      history: [history({ toothCode: '46' })],
      presence: [{ toothCode: '46', presence: 'implant' }],
    });
    expect(chart.get('46')).toMatchObject({
      presence: 'implant',
      state: 'treated',
      hasActiveDiagnosis: true,
      historyCount: 1,
    });
    expect(chart.get('46')?.presence).toBe('implant');
  });
});
