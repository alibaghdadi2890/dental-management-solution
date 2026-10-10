import type { ChartMode, ToothCode, ToothPresenceState, ToothState } from '@dcm/contracts';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatCalendarDate } from '@/lib/format';
import {
  type ChartHighlight,
  type ChartText,
  type ChartView,
  type ToothRender,
  toToothRender,
} from './tooth-render';
import {
  useChartSettings,
  useSurfaceLabel,
  useToothLabel,
  useToothName,
} from './use-chart-settings';
import { useChartView } from './use-chart-view';

export interface RenderToothOptions {
  /** What is at the position when the chart knows better than the record (a tooth its
   * dentition has not reached); the tooth's own presence otherwise. */
  presence?: ToothPresenceState;
  selected?: boolean;
  compact?: boolean;
  highlight?: ChartHighlight | null;
  /** Instead of the clinic's chart mode and this browser's view: the Settings previews, which
   * show what a mode looks like before it is chosen. */
  mode?: ChartMode;
  view?: ChartView;
}

/**
 * `(code, tooth, options) => ToothRender` for the chart on screen: `toToothRender` with the
 * clinic's chart mode, this browser's chart view and the locale's words filled in. Every place
 * that draws a tooth goes through it, so they all follow the same view.
 */
export function useToothRender(): (
  code: ToothCode,
  tooth: ToothState | undefined,
  options?: RenderToothOptions,
) => ToothRender {
  const { t, i18n } = useTranslation('clinical');
  const { mode } = useChartSettings();
  const [view] = useChartView();
  const label = useToothLabel();
  const name = useToothName();
  const surfaceLabel = useSurfaceLabel();
  const locale = i18n.resolvedLanguage ?? 'en';

  const text = useMemo(
    (): ChartText => ({
      t,
      label,
      name,
      date: (iso) => formatCalendarDate(iso, locale),
      surfaces: surfaceLabel.format,
    }),
    [t, label, name, locale, surfaceLabel],
  );

  return useCallback(
    (code, tooth, options = {}) =>
      toToothRender(tooth, {
        code,
        view: options.view ?? view,
        mode: options.mode ?? mode,
        presence: options.presence ?? tooth?.presence ?? 'present',
        selected: options.selected ?? false,
        compact: options.compact ?? false,
        highlight: options.highlight ?? null,
        text,
      }),
    [view, mode, text],
  );
}
