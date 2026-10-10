import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { CHART_VIEWS } from './tooth-render';
import { useChartView } from './use-chart-view';

/**
 * The chart card's **Diagnoses · Services · Both** switch (feature 9), beside the chart toggle
 * and styled like it. A radio group: the checked option is the one Tab stop, and the arrows move
 * to the next option and select it, mirrored in a right-to-left layout. The choice is this
 * browser's (`useChartView`), so every chart on screen follows it.
 */
export function ChartViewSwitch() {
  const { t, i18n } = useTranslation('clinical');
  const [view, setView] = useChartView();

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const forward = i18n.dir() === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const backward = i18n.dir() === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    const step =
      event.key === forward || event.key === 'ArrowDown'
        ? 1
        : event.key === backward || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const index = (CHART_VIEWS.indexOf(view) + step + CHART_VIEWS.length) % CHART_VIEWS.length;
    const next = CHART_VIEWS[index];
    if (!next) return;
    setView(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-view-option="${next}"]`)?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={t('chartView.label')}
      onKeyDown={onKeyDown}
      className="inline-flex gap-0.5 rounded-[7px] border border-border bg-subtle p-0.5"
    >
      {CHART_VIEWS.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={option === view}
          tabIndex={option === view ? 0 : -1}
          data-view-option={option}
          onClick={() => {
            setView(option);
          }}
          className={cn(
            'h-[22px] cursor-pointer rounded-[5px] border-0 px-2 text-[12px] leading-none font-medium',
            option === view
              ? 'bg-surface font-semibold text-primary shadow-[0_1px_2px_rgba(27,26,31,.08)]'
              : 'bg-transparent text-ink-secondary hover:text-ink',
          )}
        >
          {t(`chartView.${option}`)}
        </button>
      ))}
    </div>
  );
}
