import type { ToothState } from '@dcm/contracts';
import { describe, expect, it } from 'vitest';
import i18n from '@/lib/i18n';
import { toothTitle } from './tooth-title';

const t = i18n.getFixedT('en', 'clinical');

function tooth(overrides: Partial<ToothState> & Pick<ToothState, 'code'>): ToothState {
  return {
    presence: 'present',
    state: 'none',
    surfaces: {},
    wholeTooth: null,
    hasActiveDiagnosis: false,
    openPlanIds: [],
    historyCount: 0,
    titleParts: { diagnoses: [], plans: [], historyCount: 0 },
    ...overrides,
  };
}

const base = {
  label: '#3',
  name: 'Upper right first molar',
  primary: false,
  presence: 'present',
} as const;

describe('toothTitle', () => {
  it('assembles the POC tooltip from the diagnosis, the plan and the history', () => {
    const state = tooth({
      code: '16',
      state: 'treated',
      hasActiveDiagnosis: true,
      historyCount: 2,
      titleParts: { diagnoses: ['Dental caries'], plans: ['Zircon Crown'], historyCount: 2 },
    });

    expect(toothTitle(t, { ...base, tooth: state })).toBe(
      '#3 · Upper right first molar · Dental caries · planned: Zircon Crown · 2 recorded services',
    );
  });

  it('joins several diagnoses and plans with commas and uses the singular for one service', () => {
    const state = tooth({
      code: '16',
      titleParts: {
        diagnoses: ['Dental caries', 'Fracture'],
        plans: ['Composite', 'Crown'],
        historyCount: 1,
      },
    });

    expect(toothTitle(t, { ...base, tooth: state })).toBe(
      '#3 · Upper right first molar · Dental caries, Fracture · planned: Composite, Crown · 1 recorded service',
    );
  });

  it('says "no recorded treatment" for a tooth with nothing on it', () => {
    expect(toothTitle(t, { ...base, tooth: undefined })).toBe(
      '#3 · Upper right first molar · no recorded treatment',
    );
  });

  it('mentions this visit’s treatment instead of "no recorded treatment"', () => {
    const state = tooth({ code: '16', state: 'treated_today', wholeTooth: 'treated_today' });

    expect(toothTitle(t, { ...base, tooth: state })).toBe(
      '#3 · Upper right first molar · treated in this visit',
    );
  });

  it('says what is at a position that is not a plain natural tooth (feature 7)', () => {
    expect(toothTitle(t, { ...base, presence: 'missing', tooth: undefined })).toBe(
      '#3 · Upper right first molar · missing · no recorded treatment',
    );
    // An implant is charted like any tooth: its diagnosis and treatment follow its state.
    const state = tooth({
      code: '16',
      presence: 'implant',
      state: 'treated',
      hasActiveDiagnosis: true,
      historyCount: 1,
      titleParts: { diagnoses: ['Peri-implantitis'], plans: [], historyCount: 1 },
    });
    expect(toothTitle(t, { ...base, presence: 'implant', tooth: state })).toBe(
      '#3 · Upper right first molar · implant · Peri-implantitis · 1 recorded service',
    );
  });

  it('flags primary and not-yet-erupted teeth first', () => {
    expect(
      toothTitle(t, {
        label: 'A',
        name: 'Upper right primary second molar',
        primary: true,
        presence: 'present',
        tooth: undefined,
      }),
    ).toBe('A · Upper right primary second molar · primary tooth · no recorded treatment');

    expect(
      toothTitle(t, {
        label: '#17',
        name: 'Upper right second molar',
        primary: false,
        presence: 'not_erupted',
        tooth: undefined,
      }),
    ).toBe('#17 · Upper right second molar · not erupted · no recorded treatment');
  });
});
