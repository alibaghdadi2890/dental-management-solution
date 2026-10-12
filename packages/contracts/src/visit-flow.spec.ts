import { describe, expect, it } from 'vitest';
import {
  doneSteps,
  firstStep,
  hasStep,
  isOptionalStep,
  NO_FLOW_FACTS,
  stepLabelKey,
  stepsOf,
  suggestVisitType,
  VISIT_TYPES,
  type VisitFlowFacts,
} from './visit-flow.js';

const facts = (patch: Partial<VisitFlowFacts> = {}): VisitFlowFacts => ({
  ...NO_FLOW_FACTS,
  ...patch,
});

describe('stepsOf', () => {
  it('gives each type its steps', () => {
    const examination = ['intake', 'examine', 'findings', 'plan', 'perform', 'complete'];
    expect(stepsOf('examination')).toEqual(examination);
    expect(stepsOf('consultation')).toEqual(examination);
    expect(stepsOf('emergency')).toEqual(['complaint', 'examine', 'perform', 'complete']);
    expect(stepsOf('treatment')).toEqual(['today', 'perform', 'complete']);
    expect(stepsOf('hygiene')).toEqual(['perform', 'complete']);
  });

  it('ends every type on Complete and starts it on its first step', () => {
    for (const type of VISIT_TYPES) {
      const steps = stepsOf(type);
      expect(steps.at(-1)).toBe('complete');
      expect(firstStep(type)).toBe(steps[0]);
    }
  });
});

describe('hasStep', () => {
  it('knows the steps a type can ever show', () => {
    expect(hasStep('examination', 'perform')).toBe(true);
    expect(hasStep('hygiene', 'intake')).toBe(false);
    expect(hasStep('treatment', 'today')).toBe(true);
    expect(hasStep('emergency', 'plan')).toBe(false);
  });
});

describe('isOptionalStep', () => {
  it('marks Perform optional where the visit is not about treating', () => {
    expect(isOptionalStep('examination', 'perform')).toBe(true);
    expect(isOptionalStep('consultation', 'perform')).toBe(true);
    expect(isOptionalStep('examination', 'plan')).toBe(false);
    for (const type of ['emergency', 'treatment', 'hygiene'] as const) {
      expect(isOptionalStep(type, 'perform')).toBe(false);
    }
  });
});

describe('stepLabelKey', () => {
  it('names a step by its type', () => {
    expect(stepLabelKey('examination', 'plan')).toBe('plan');
    expect(stepLabelKey('consultation', 'plan')).toBe('proposal');
    expect(stepLabelKey('emergency', 'perform')).toBe('treatNow');
    expect(stepLabelKey('examination', 'perform')).toBe('perform');
    expect(stepLabelKey('treatment', 'perform')).toBe('perform');
    expect(stepLabelKey('hygiene', 'perform')).toBe('perform');
  });
});

describe('doneSteps', () => {
  it('ticks nothing in a visit that holds nothing', () => {
    for (const type of VISIT_TYPES) expect(doneSteps(type, facts())).toEqual([]);
  });

  it('ticks Intake once the history is confirmed or a reason is entered', () => {
    expect(doneSteps('examination', facts({ historyConfirmed: true }))).toEqual(['intake']);
    expect(doneSteps('examination', facts({ hasReason: true }))).toEqual(['intake']);
  });

  it('ticks Complaint on a reason, a pain score or a since', () => {
    expect(doneSteps('emergency', facts({ hasComplaint: true }))).toEqual(['complaint']);
    expect(doneSteps('emergency', facts({ hasReason: true }))).toEqual(['complaint']);
  });

  it('ticks Examine on a diagnosis, a presence change or a file; Findings on a diagnosis only', () => {
    expect(doneSteps('examination', facts({ files: 1 }))).toEqual(['examine']);
    expect(doneSteps('examination', facts({ presenceChanges: 1 }))).toEqual(['examine']);
    expect(doneSteps('examination', facts({ diagnoses: 1 }))).toEqual(['examine', 'findings']);
  });

  it('ticks Plan on a plan made here, and Perform on work', () => {
    expect(doneSteps('consultation', facts({ plans: 1 }))).toEqual(['plan']);
    expect(doneSteps('examination', facts({ work: 1 }))).toEqual(['perform']);
  });

  it("ticks Today's work once an item of the list was performed or continued", () => {
    expect(doneSteps('treatment', facts({ worklistTouched: 1 }))).toEqual(['today']);
    expect(doneSteps('treatment', facts({ worklistTouched: 1, work: 1 }))).toEqual([
      'today',
      'perform',
    ]);
  });

  it('removes a tick when what earned it is undone, and never ticks Complete', () => {
    const recorded = facts({ diagnoses: 1 });
    expect(doneSteps('examination', recorded)).toContain('findings');
    expect(doneSteps('examination', { ...recorded, diagnoses: 0 })).toEqual([]);
    expect(doneSteps('hygiene', facts({ work: 3 }))).toEqual(['perform']);
  });
});

describe('suggestVisitType', () => {
  it('suggests Treatment while the patient has open plans', () => {
    expect(suggestVisitType({ openPlans: 1, countedVisits: 0, firstVisitType: 'hygiene' })).toBe(
      'treatment',
    );
  });

  it('suggests what a new patient was registered for on their first visit', () => {
    expect(suggestVisitType({ openPlans: 0, countedVisits: 0, firstVisitType: 'emergency' })).toBe(
      'emergency',
    );
  });

  it('otherwise suggests an examination', () => {
    expect(suggestVisitType({ openPlans: 0, countedVisits: 0, firstVisitType: null })).toBe(
      'examination',
    );
    expect(suggestVisitType({ openPlans: 0, countedVisits: 3, firstVisitType: 'hygiene' })).toBe(
      'examination',
    );
  });
});
