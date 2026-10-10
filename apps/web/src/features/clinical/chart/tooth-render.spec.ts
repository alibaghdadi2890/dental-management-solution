import type { ChartMode, ToothPresenceState } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import { renderOf, toothDiagnosis, toothService, toothState } from './chart.test-utils';
import { CHART_VIEWS, type ChartView, type Fill, type ToothRender } from './tooth-render';

/** `colour/tone` of each painted surface. */
const cellsOf = (render: ToothRender) =>
  Object.fromEntries(
    Object.entries(render.cells).map(([surface, fill]) => [surface, `${fill.color}/${fill.tone}`]),
  );
const fillOf = (fill: Fill | null) => (fill ? `${fill.color}/${fill.tone}` : null);
const chips = (render: ToothRender) => render.band.map((item) => `${item.kind}:${item.code}`);

const filling = toothService({ surfaces: ['O', 'D'] });
const crown = toothService({
  code: 'ZIR',
  name: 'Zircon crown',
  color: 'amber',
  icon: 'crown',
  date: '2025-01-10',
});
const caries = toothDiagnosis({ surfaces: ['M'] });
const tooth36 = toothState({ code: '36', services: [filling], diagnoses: [caries] });

describe('toToothRender: what each view paints (M5–M7)', () => {
  it('Services: services paint their surfaces; diagnoses show nothing', () => {
    const render = renderOf(tooth36, { view: 'services' });
    expect(cellsOf(render)).toEqual({ O: 'blue/past', D: 'blue/past' });
    expect(render.dots).toEqual([]);
    expect(render.band).toEqual([]);
  });

  it('Diagnoses: a surface diagnosis paints its cell; services paint nothing', () => {
    const render = renderOf(tooth36, { view: 'diagnoses' });
    // An active diagnosis is drawn at full strength.
    expect(cellsOf(render)).toEqual({ M: 'rose/today' });
    expect(render.dots).toEqual([]);
  });

  it('Both: services as in Services, diagnoses as dots that paint no cell', () => {
    const render = renderOf(tooth36);
    expect(cellsOf(render)).toEqual({ O: 'blue/past', D: 'blue/past' });
    expect(render.dots).toEqual([{ color: 'rose', label: 'Dental caries', ringed: false }]);
  });

  it('shows at most three dots and counts the rest', () => {
    const diagnoses = ['A', 'B', 'C', 'D', 'E'].map((code) => toothDiagnosis({ code }));
    const render = renderOf(toothState({ code: '36', diagnoses }));
    expect(render.dots).toHaveLength(3);
    expect(render.dotOverflow).toBe(2);
  });
});

describe('toToothRender: which item paints (M2–M4)', () => {
  it('tells work of today from earlier work by its tone', () => {
    const today = toothService({ surfaces: ['O'], status: 'treated_today' });
    const render = renderOf(toothState({ code: '46', services: [today] }));
    expect(cellsOf(render)).toEqual({ O: 'blue/today' });
  });

  it('gives a surface to the first item that names it: the list is in show-first order', () => {
    const newer = toothService({ code: 'NEW', color: 'green', surfaces: ['O'] });
    const older = toothService({ code: 'OLD', color: 'red', surfaces: ['O', 'M'] });
    const render = renderOf(toothState({ code: '36', services: [newer, older] }));
    expect(cellsOf(render)).toEqual({ O: 'green/past', M: 'red/past' });
    // Both won a surface: nothing is left for the band.
    expect(chips(render)).toEqual([]);
  });

  it('paints every surface for a whole-tooth item, and gives it a band chip too', () => {
    const render = renderOf(toothState({ code: '16', services: [crown] }));
    expect(cellsOf(render)).toEqual({
      M: 'amber/past',
      D: 'amber/past',
      B: 'amber/past',
      L: 'amber/past',
      O: 'amber/past',
    });
    expect(render.band).toEqual([
      {
        kind: 'service',
        id: 'ZIR',
        code: 'ZIR',
        color: 'amber',
        icon: 'crown',
        tone: 'past',
        label: 'Zircon crown',
        ringed: false,
      },
    ]);
  });

  it('lets a surface item ahead of a whole-tooth one keep its surfaces', () => {
    const render = renderOf(toothState({ code: '16', services: [filling, crown] }));
    expect(cellsOf(render)).toMatchObject({ O: 'blue/past', D: 'blue/past', M: 'amber/past' });
    expect(chips(render)).toEqual(['service:ZIR']);
  });

  it('puts a surface item that won no surface in the band, so it is not lost', () => {
    const under = toothService({ code: 'OLD', color: 'red', surfaces: ['O'] });
    const render = renderOf(
      toothState({ code: '36', services: [toothService({ surfaces: ['O'] }), under] }),
    );
    expect(cellsOf(render)).toEqual({ O: 'blue/past' });
    expect(chips(render)).toEqual(['service:OLD']);
  });

  it('shows three chips of five whole-tooth services, in order, and +2', () => {
    const services = ['A', 'B', 'C', 'D', 'E'].map((code) => toothService({ code }));
    const render = renderOf(toothState({ code: '16', services }));
    expect(chips(render)).toEqual(['service:A', 'service:B', 'service:C']);
    expect(render.bandOverflow).toBe(2);
  });

  it('simple mode: the first item is the body, every other one a chip', () => {
    const render = renderOf(toothState({ code: '16', services: [filling, crown] }), {
      mode: 'simple',
    });
    expect(fillOf(render.body)).toBe('blue/past');
    expect(render.cells).toEqual({});
    expect(chips(render)).toEqual(['service:ZIR']);
  });

  it('draws an item without a catalog colour as a plain fill that is still listed', () => {
    const unknown = toothService({ code: 'GONE', name: 'Old service', color: null, icon: null });
    const render = renderOf(toothState({ code: '16', services: [unknown] }));
    expect(cellsOf(render).O).toBe('none/past');
    expect(render.band[0]).toMatchObject({ color: null, label: 'Old service' });
    expect(render.title).toContain('Old service');
  });
});

describe('toToothRender: plans, rings and presence', () => {
  const planned = toothState({
    code: '11',
    openPlanIds: ['p1'],
    titleParts: { diagnoses: [], plans: ['Zircon crown'], historyCount: 0 },
  });

  it.each(CHART_VIEWS)('washes a planned tooth and rings it in the %s view', (view) => {
    const render = renderOf(planned, { view });
    expect(new Set(Object.values(cellsOf(render)))).toEqual(new Set(['planned/wash']));
    expect(Object.keys(render.cells)).toHaveLength(5);
    expect(render.rings).toEqual({ selected: false, planned: true, inProgress: false });
  });

  it('rings a started plan as in progress, and keeps the ring on a tooth with services', () => {
    const render = renderOf(
      toothState({ ...planned, code: '36', planInProgress: true, services: [filling] }),
    );
    expect(render.rings).toEqual({ selected: false, planned: false, inProgress: true });
    // The mark keeps its surfaces; the wash takes the others.
    expect(cellsOf(render)).toMatchObject({ O: 'blue/past', M: 'planned/wash' });
  });

  it('washes the simple body of a planned tooth, and leaves a plain one plain', () => {
    expect(fillOf(renderOf(planned, { mode: 'simple' }).body)).toBe('planned/wash');
    expect(renderOf(undefined, { mode: 'simple' }).body?.color).toBe('none');
  });

  it('passes the selection through', () => {
    expect(renderOf(undefined, { selected: true }).rings.selected).toBe(true);
  });

  const presences: ToothPresenceState[] = ['missing', 'not_erupted'];
  const modes: ChartMode[] = ['surface', 'simple'];
  const absentCases = presences.flatMap((presence) =>
    modes.flatMap((mode) => CHART_VIEWS.map((view) => [presence, mode, view] as const)),
  );
  it.each(absentCases)(
    'draws nothing on a %s position (%s mode, %s view) but keeps its rings',
    (presence, mode, view) => {
      const render = renderOf(
        toothState({
          code: '18',
          presence,
          services: [crown],
          diagnoses: [caries],
          openPlanIds: ['p1'],
        }),
        { mode, view },
      );
      expect(render.body).toBeNull();
      expect(render.cells).toEqual({});
      expect(render.band).toEqual([]);
      expect(render.dots).toEqual([]);
      expect(render.rings.planned).toBe(true);
      expect(render.presence).toBe(presence);
    },
  );

  it('draws an implant like any tooth', () => {
    const render = renderOf(toothState({ code: '24', presence: 'implant', services: [crown] }));
    expect(render.presence).toBe('implant');
    expect(chips(render)).toEqual(['service:ZIR']);
  });
});

describe('toToothRender: the compact chart (M9)', () => {
  it('keeps up to three band items, counts no overflow and drops the diagnosis dots', () => {
    const services = ['A', 'B', 'C', 'D'].map((code) => toothService({ code }));
    const render = renderOf(toothState({ code: '16', services, diagnoses: [caries] }), {
      compact: true,
    });
    expect(render.compact).toBe(true);
    expect(render.band).toHaveLength(3);
    expect(render.bandOverflow).toBe(0);
    expect(render.dots).toEqual([]);
    expect(render.dotOverflow).toBe(0);
  });
});

describe('toToothRender: the legend highlight (M11)', () => {
  const tooth = toothState({ code: '16', services: [filling, crown], diagnoses: [caries] });

  it('rings the cells and the chip of the highlighted item, and does not fade its tooth', () => {
    const render = renderOf(tooth, { highlight: { kind: 'service', id: 'ZIR' } });
    expect(render.faded).toBe(false);
    expect(render.cells.M?.ringed).toBe(true);
    expect(render.cells.O?.ringed).toBe(false);
    expect(render.band[0]?.ringed).toBe(true);
  });

  it('rings a highlighted diagnosis dot', () => {
    const render = renderOf(tooth, { highlight: { kind: 'diagnosis', id: 'DX-CAR' } });
    expect(render.faded).toBe(false);
    expect(render.dots[0]?.ringed).toBe(true);
  });

  it('fades a tooth that does not carry the item, or carries it out of view', () => {
    expect(renderOf(tooth, { highlight: { kind: 'service', id: 'OTHER' } }).faded).toBe(true);
    expect(renderOf(undefined, { highlight: { kind: 'service', id: 'ZIR' } }).faded).toBe(true);
    // A diagnosis id never matches a service of the same id, and the reverse.
    expect(renderOf(tooth, { highlight: { kind: 'diagnosis', id: 'ZIR' } }).faded).toBe(true);
    expect(
      renderOf(tooth, { view: 'services', highlight: { kind: 'diagnosis', id: 'DX-CAR' } }).faded,
    ).toBe(true);
  });

  it('fades nothing without a highlight', () => {
    expect(renderOf(undefined).faded).toBe(false);
  });
});

describe('toToothRender: the title (M14)', () => {
  const views: [ChartView, string[]][] = [
    [
      'both',
      [
        'Dental caries · M · 2026-02-01 · Dr Rami',
        'Composite filling · O · D · 2026-03-12 · Dr Rami',
      ],
    ],
    ['diagnoses', ['Dental caries · M · 2026-02-01 · Dr Rami']],
    ['services', ['Composite filling · O · D · 2026-03-12 · Dr Rami']],
  ];
  it.each(views)('lists what the %s view shows, with surfaces, date and dentist', (view, lines) => {
    expect(renderOf(tooth36, { view }).title.split('\n')).toEqual(['#36 · tooth 36', ...lines]);
  });

  it('says today for the live visit, then the open plans', () => {
    const tooth = toothState({
      code: '46',
      services: [toothService({ status: 'treated_today', date: '2026-10-08' })],
      openPlanIds: ['p1'],
      titleParts: { diagnoses: [], plans: ['Zircon crown', 'Onlay'], historyCount: 0 },
    });
    expect(renderOf(tooth).title.split('\n')).toEqual([
      '#46 · tooth 46',
      'Composite filling · today · Dr Rami',
      'planned: Zircon crown, Onlay',
    ]);
    expect(renderOf({ ...tooth, planInProgress: true }).title).toContain(
      'not finished: Zircon crown, Onlay',
    );
  });

  it('says a primary tooth, what is at the position, and when nothing is recorded', () => {
    expect(renderOf(undefined, { code: '55', presence: 'not_erupted' }).title).toBe(
      '#55 · tooth 55 · primary tooth · not erupted · no recorded treatment',
    );
    expect(renderOf(undefined).title).toBe('#16 · tooth 16 · no recorded treatment');
  });

  it('still names what was done on a missing tooth', () => {
    const render = renderOf(
      toothState({
        code: '18',
        presence: 'missing',
        services: [toothService({ name: 'Extraction' })],
      }),
    );
    expect(render.title.split('\n')).toEqual([
      '#18 · tooth 18 · missing',
      'Extraction · 2026-03-12 · Dr Rami',
    ]);
  });
});
