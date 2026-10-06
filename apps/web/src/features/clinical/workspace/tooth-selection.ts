import type { SurfaceKey, ToothCode } from '@dcm/contracts';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

/** What the chart selects beside a tooth: a jaw, or the whole mouth. */
export const CHART_AREAS = ['upper', 'lower', 'mouth'] as const;
export type ChartArea = (typeof CHART_AREAS)[number];

export interface ToothSelection {
  /** The selected tooth, as the chart shows it (a primary code in a child's chart). */
  tooth: ToothCode | null;
  /** The selected jaw or whole mouth; never set together with a tooth. */
  area: ChartArea | null;
  /** The pending surface scope for the next diagnosis, plan or service (spec V5). */
  surfaces: readonly SurfaceKey[];
  /** Selects a tooth (or deselects with `null`); either way the pending surfaces are cleared
   * (spec invariant 9). */
  select: (tooth: ToothCode | null) => void;
  /** Selects a jaw or the whole mouth, deselecting any tooth; the same one again deselects. */
  selectArea: (area: ChartArea) => void;
  /** Selects `tooth` unless it already is selected, in which case its pending surfaces stay
   * (the diagnosis toast's Plan treatment, which plans on the diagnosed surfaces). */
  ensureSelected: (tooth: ToothCode) => void;
  toggleSurface: (surface: SurfaceKey) => void;
}

/** The workspace page's selection state: local to the page, shared through
 * `ToothSelectionContext` with the chart card and the tooth panel. */
export function useToothSelectionState(): ToothSelection {
  const [state, setState] = useState<{
    tooth: ToothCode | null;
    area: ChartArea | null;
    surfaces: SurfaceKey[];
  }>({ tooth: null, area: null, surfaces: [] });
  const select = useCallback((tooth: ToothCode | null) => {
    setState({ tooth, area: null, surfaces: [] });
  }, []);
  const selectArea = useCallback((area: ChartArea) => {
    setState((current) => ({
      tooth: null,
      area: current.area === area ? null : area,
      surfaces: [],
    }));
  }, []);
  const ensureSelected = useCallback((tooth: ToothCode) => {
    setState((current) =>
      current.tooth === tooth ? current : { tooth, area: null, surfaces: [] },
    );
  }, []);
  const toggleSurface = useCallback((surface: SurfaceKey) => {
    setState((current) => ({
      ...current,
      surfaces: current.surfaces.includes(surface)
        ? current.surfaces.filter((pending) => pending !== surface)
        : [...current.surfaces, surface],
    }));
  }, []);
  return useMemo(
    () => ({
      tooth: state.tooth,
      area: state.area,
      surfaces: state.surfaces,
      select,
      selectArea,
      ensureSelected,
      toggleSurface,
    }),
    [state, select, selectArea, ensureSelected, toggleSurface],
  );
}

export const ToothSelectionContext = createContext<ToothSelection | null>(null);

export function useToothSelection(): ToothSelection {
  const selection = useContext(ToothSelectionContext);
  if (!selection) {
    throw new Error('useToothSelection must be used inside a charting provider');
  }
  return selection;
}
