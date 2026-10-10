import type { ToothCode, ToothDiagnosis, ToothService, ToothState } from '@dcm/contracts';
import i18n from '@/lib/i18n';
import {
  type ChartText,
  type ToothRender,
  type ToothRenderOptions,
  toToothRender,
} from './tooth-render';

/** A tooth's derived state with nothing on it, plus the overrides. */
export function toothState(overrides: Partial<ToothState> & Pick<ToothState, 'code'>): ToothState {
  return {
    presence: 'present',
    state: 'none',
    surfaces: {},
    wholeTooth: null,
    hasActiveDiagnosis: false,
    diagnoses: [],
    services: [],
    openPlanIds: [],
    planInProgress: false,
    historyCount: 0,
    titleParts: { diagnoses: [], plans: [], historyCount: 0 },
    ...overrides,
  };
}

/** A finished composite filling, blue with the filling icon; the catalog id is its code. */
export function toothService(overrides: Partial<ToothService> = {}): ToothService {
  const code = overrides.code ?? 'CMP';
  return {
    recordId: `record-${code}`,
    procedureId: code,
    code,
    name: 'Composite filling',
    color: 'blue',
    icon: 'filling',
    priority: 5,
    surfaces: [],
    status: 'treated',
    date: '2026-03-12',
    dentistName: 'Dr Rami',
    planId: null,
    ...overrides,
  };
}

/** An active caries, rose; the catalog id is its code. */
export function toothDiagnosis(overrides: Partial<ToothDiagnosis> = {}): ToothDiagnosis {
  const code = overrides.code ?? 'DX-CAR';
  return {
    recordId: `record-${code}`,
    diagnosisId: code,
    code,
    name: 'Dental caries',
    color: 'rose',
    priority: 5,
    surfaces: [],
    recordedDate: '2026-02-01',
    dentistName: 'Dr Rami',
    ...overrides,
  };
}

export const teethOf = (...states: ToothState[]) =>
  new Map<ToothCode, ToothState>(states.map((state) => [state.code, state]));

/** English words, FDI labels and dates as written: a title a test can read. */
export const TEXT: ChartText = {
  t: i18n.getFixedT('en', 'clinical'),
  label: (code) => `#${code}`,
  name: (code) => `tooth ${code}`,
  date: (iso) => iso,
  surfaces: (surfaces) => surfaces.join(' · '),
};

/** `toToothRender` in surface mode and the Both view, unless told otherwise. */
export function renderOf(
  tooth: ToothState | undefined,
  options: Partial<ToothRenderOptions> = {},
): ToothRender {
  return toToothRender(tooth, {
    code: tooth?.code ?? '16',
    view: 'both',
    mode: 'surface',
    presence: tooth?.presence ?? 'present',
    text: TEXT,
    ...options,
  });
}
