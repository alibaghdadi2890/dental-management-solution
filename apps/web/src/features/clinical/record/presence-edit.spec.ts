import type { ToothCode, ToothState } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import { paintTooth, startPresenceEdit, withPendingPresence } from './presence-edit';

const state = (code: ToothCode, patch: Partial<ToothState> = {}): ToothState => ({
  code,
  presence: 'present',
  state: 'none',
  surfaces: {},
  wholeTooth: null,
  hasActiveDiagnosis: false,
  openPlanIds: [],
  historyCount: 0,
  titleParts: { diagnoses: [], plans: [], historyCount: 0 },
  ...patch,
});

describe('Edit presence: painting teeth', () => {
  it('starts on the Missing brush with nothing marked', () => {
    expect(startPresenceEdit()).toEqual({ brush: 'missing', changes: new Map() });
  });

  it('marks the teeth an intake needs: four wisdom teeth missing, one implant', () => {
    let edit = startPresenceEdit();
    for (const code of ['18', '28', '38', '48'] as const) edit = paintTooth(edit, code, 'present');
    edit = paintTooth({ ...edit, brush: 'implant' }, '36', 'present');
    expect([...edit.changes]).toEqual([
      ['18', 'missing'],
      ['28', 'missing'],
      ['38', 'missing'],
      ['48', 'missing'],
      ['36', 'implant'],
    ]);
  });

  it('takes the paint off on a second click with the same brush, and repaints with another', () => {
    let edit = paintTooth(startPresenceEdit(), '18', 'present');
    edit = paintTooth(edit, '18', 'present');
    expect(edit.changes.size).toBe(0);
    edit = paintTooth(edit, '18', 'present');
    edit = paintTooth({ ...edit, brush: 'not_erupted' }, '18', 'present');
    expect([...edit.changes]).toEqual([['18', 'not_erupted']]);
  });

  it('counts no change for a tooth painted with what the chart already says', () => {
    // 46 is recorded missing: the Missing brush has nothing to do, and clears a pending change.
    let edit = paintTooth(startPresenceEdit(), '46', 'missing');
    expect(edit.changes.size).toBe(0);
    edit = paintTooth({ ...edit, brush: 'implant' }, '46', 'missing');
    edit = paintTooth({ ...edit, brush: 'missing' }, '46', 'missing');
    expect(edit.changes.size).toBe(0);
    // The Present brush corrects it.
    edit = paintTooth({ ...edit, brush: 'present' }, '46', 'missing');
    expect([...edit.changes]).toEqual([['46', 'present']]);
  });
});

describe('withPendingPresence', () => {
  it('draws the pending changes on the chart without touching what is recorded on the teeth', () => {
    const treated = state('16', { state: 'treated', historyCount: 2 });
    const teeth = new Map<ToothCode, ToothState>([['16', treated]]);
    const shown = withPendingPresence(
      teeth,
      new Map<ToothCode, 'missing' | 'implant'>([
        ['16', 'implant'],
        ['18', 'missing'],
      ]),
    );
    expect(shown.get('16')).toEqual({ ...treated, presence: 'implant' });
    expect(shown.get('18')).toMatchObject({ presence: 'missing', state: 'none', historyCount: 0 });
    expect(teeth.get('16')?.presence).toBe('present');
    expect(teeth.has('18')).toBe(false);
  });

  it('is the same map when nothing is pending', () => {
    const teeth = new Map<ToothCode, ToothState>();
    expect(withPendingPresence(teeth, new Map())).toBe(teeth);
  });
});
