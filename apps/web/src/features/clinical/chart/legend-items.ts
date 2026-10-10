import type { MarkColor, MarkIcon, ToothCode, ToothState } from '@dcm/contracts';
import type { ChartView } from './tooth-render';

/** One line of the legend: a catalog diagnosis or service that is on this patient's chart. */
export interface LegendEntry {
  kind: 'diagnosis' | 'service';
  /** The catalog item's id. */
  id: string;
  name: string;
  color: MarkColor | null;
  icon: MarkIcon | null;
  /** How many teeth of the chart on screen carry it. */
  teeth: number;
}

export interface LegendGroups {
  diagnoses: LegendEntry[];
  services: LegendEntry[];
}

/** How many lines a group shows before "+N more". */
export const LEGEND_GROUP_LIMIT = 8;

function collect(
  teeth: readonly ToothState[],
  kind: LegendEntry['kind'],
  itemsOf: (tooth: ToothState) => readonly {
    id: string;
    name: string;
    color: MarkColor | null;
    icon: MarkIcon | null;
  }[],
): LegendEntry[] {
  const entries = new Map<string, LegendEntry>();
  for (const tooth of teeth) {
    // An item twice on one tooth is still one tooth.
    for (const id of new Set(itemsOf(tooth).map((item) => item.id))) {
      const item = itemsOf(tooth).find((candidate) => candidate.id === id);
      if (!item) continue;
      const entry = entries.get(id);
      if (entry) entry.teeth += 1;
      // The name the item was recorded under most recently: a tooth lists its newest first.
      else
        entries.set(id, {
          kind,
          id,
          name: item.name,
          color: item.color,
          icon: item.icon,
          teeth: 1,
        });
    }
  }
  return [...entries.values()].sort(
    (a, b) => b.teeth - a.teeth || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
}

/**
 * The legend's dynamic groups (feature 9, M11): the diagnoses and the services actually on the
 * chart on screen, in the current view, each with the number of teeth that carry it — the most
 * widespread first. `codes` are the positions of that chart (primary or permanent). A group
 * with nothing in it is empty, and the legend leaves it out. Pure.
 */
export function legendGroups(
  teeth: ReadonlyMap<ToothCode, ToothState>,
  view: ChartView,
  codes: readonly ToothCode[],
): LegendGroups {
  const onChart = codes.flatMap((code) => teeth.get(code) ?? []);
  return {
    diagnoses:
      view === 'services'
        ? []
        : collect(onChart, 'diagnosis', (tooth) =>
            tooth.diagnoses.map((item) => ({
              id: item.diagnosisId,
              name: item.name,
              color: item.color,
              icon: null,
            })),
          ),
    services:
      view === 'diagnoses'
        ? []
        : collect(onChart, 'service', (tooth) =>
            tooth.services.map((item) => ({
              id: item.procedureId,
              name: item.name,
              color: item.color,
              icon: item.icon,
            })),
          ),
  };
}
