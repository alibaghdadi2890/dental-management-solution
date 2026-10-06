import {
  anatomicalName,
  type ChartMode,
  type ChartOrientation,
  type Jaw,
  type SurfaceKey,
  TENANT_DEFAULTS,
  type ToothCode,
  type ToothNotation,
  toothLabel,
} from '@dcm/contracts';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/features/auth/session';

export interface ChartSettings {
  mode: ChartMode;
  notation: ToothNotation;
  orientation: ChartOrientation;
}

/** The clinic's chart preferences from the session tenant (ADR-0021). Until the session loads —
 * or for a platform admin outside a clinic — the tenant defaults apply. */
export function useChartSettings(): ChartSettings {
  const { data } = useSession();
  const tenant = data?.tenant;
  return {
    mode: tenant?.chartMode ?? TENANT_DEFAULTS.chartMode,
    notation: tenant?.toothNotation ?? TENANT_DEFAULTS.toothNotation,
    orientation: tenant?.chartOrientation ?? TENANT_DEFAULTS.chartOrientation,
  };
}

/** `(code) => '#16'` (FDI) or `'#3'` / `'A'` (Universal): every tooth label in the app goes
 * through this, so it always follows the clinic's notation. */
export function useToothLabel(): (code: ToothCode) => string {
  const { notation } = useChartSettings();
  return useCallback((code: ToothCode) => toothLabel(code, notation), [notation]);
}

/** `(code) => 'Upper right first molar'`, translated: the quadrant and tooth parts are looked up
 * first, then placed by the locale's own `tooth.name` / `tooth.primaryName` word order. */
export function useToothName(): (code: ToothCode) => string {
  const { t } = useTranslation('clinical');
  return useCallback(
    (code: ToothCode) => {
      const { key, params } = anatomicalName(code);
      return t(key, {
        quadrant: t(`quadrant.${params.quadrant}`),
        tooth: t(`toothName.${params.tooth}`),
      });
    },
    [t],
  );
}

/** `(jaw) => 'Upper jaw' | 'Lower jaw'`, or `'Whole mouth'` without one: what a service or plan
 * that isn't on a tooth shows where the tooth label would be. */
export function useLevelLabel(): (jaw: Jaw | null | undefined) => string {
  const { t } = useTranslation('clinical');
  return useCallback((jaw: Jaw | null | undefined) => t(`level.${jaw ?? 'mouth'}`), [t]);
}

export interface SurfaceLabel {
  /** The letter shown for a surface, e.g. `B` (`V` in French). */
  short: (surface: SurfaceKey) => string;
  /** The full name, e.g. `Buccal / facial`. */
  name: (surface: SurfaceKey) => string;
  /** The letters joined with the POC separator, e.g. `O · D`; `''` for no surfaces. */
  format: (surfaces: readonly SurfaceKey[]) => string;
}

const SURFACE_SEPARATOR = ' · ';

/** The only way surface text is rendered (W25): surfaces are stored as M/D/B/L/O/I and displayed
 * per locale — French shows V (vestibulaire) for buccal, Arabic keeps the Latin letters. */
export function useSurfaceLabel(): SurfaceLabel {
  const { t } = useTranslation('clinical');
  return useMemo(() => {
    const short = (surface: SurfaceKey) => t(`surfaceShort.${surface}`);
    return {
      short,
      name: (surface: SurfaceKey) => t(`surface.${surface}`),
      format: (surfaces: readonly SurfaceKey[]) => surfaces.map(short).join(SURFACE_SEPARATOR),
    };
  }, [t]);
}
