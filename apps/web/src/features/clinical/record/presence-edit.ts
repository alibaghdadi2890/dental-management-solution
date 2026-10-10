import type { ToothCode, ToothPresenceState, ToothState } from '@dcm/contracts';

/**
 * The record's Edit presence mode (feature 7): a new patient with several gaps or implants is
 * marked in one go — pick a brush, click the teeth, save once — instead of one menu per tooth.
 * Pure: the chart tab holds the state.
 */
export interface PresenceEdit {
  /** The state a click paints. */
  brush: ToothPresenceState;
  /** The teeth painted so far, each with the presence it will be given. */
  changes: ReadonlyMap<ToothCode, ToothPresenceState>;
}

/** The brushes, in the toolbar's order: what a new patient is usually missing first. */
export const PRESENCE_BRUSHES: readonly ToothPresenceState[] = [
  'missing',
  'not_erupted',
  'implant',
  'present',
];

export const startPresenceEdit = (): PresenceEdit => ({ brush: 'missing', changes: new Map() });

/**
 * A click on a tooth with the current brush. Painting a tooth with what the chart already says
 * is no change, so it clears any pending one; painting it again with the same brush takes the
 * paint off; anything else sets it.
 */
export function paintTooth(
  edit: PresenceEdit,
  code: ToothCode,
  recorded: ToothPresenceState,
): PresenceEdit {
  const changes = new Map(edit.changes);
  if (edit.brush === recorded || changes.get(code) === edit.brush) changes.delete(code);
  else changes.set(code, edit.brush);
  return { ...edit, changes };
}

/** The chart's teeth with the pending changes drawn on them, so the dentist sees what Done saves. */
export function withPendingPresence(
  teeth: ReadonlyMap<ToothCode, ToothState>,
  changes: ReadonlyMap<ToothCode, ToothPresenceState>,
): ReadonlyMap<ToothCode, ToothState> {
  if (changes.size === 0) return teeth;
  const shown = new Map(teeth);
  for (const [code, presence] of changes) {
    const recorded = teeth.get(code);
    shown.set(
      code,
      recorded
        ? { ...recorded, presence }
        : {
            code,
            presence,
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
          },
    );
  }
  return shown;
}
