import {
  anatomicalName,
  type ChartMode,
  type ChartOrientation,
  TENANT_DEFAULTS,
  type ToothCode,
  type ToothNotation,
  toothLabel,
} from '@dcm/contracts';
import { useCallback } from 'react';
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
