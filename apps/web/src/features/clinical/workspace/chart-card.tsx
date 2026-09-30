import { deriveChart, type Patient, type PatientChart, type Visit } from '@dcm/contracts';
import { type ReactNode, useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChartLegend } from '../chart/chart-legend';
import { DentalChart } from '../chart/dental-chart';
import { useChartSettings } from '../chart/use-chart-settings';
import { DentitionSelect, type ResolvedDentition } from './dentition-select';
import { useToothSelection } from './tooth-selection';

/** The chart card's frame (spec §Visit Workspace → Body 1): white, 10px radius, 18/18/16px
 * padding, the 600/14px "Dental chart" title over its subtitle, and whatever sits beside it. */
export function ChartCardFrame({
  aside,
  subtitle,
  children,
}: {
  aside?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation('clinical');
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="mb-4 rounded-xl border border-border bg-surface px-[18px] pt-[18px] pb-4"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id={titleId} className="m-0 mb-[3px] text-[14px] leading-none font-semibold">
            {t('chartCard.title')}
          </h2>
          <p className="m-0 text-[12.5px] leading-[1.4] text-ink-muted">{t('chartCard.hint')}</p>
          {subtitle}
        </div>
        {aside && <div className="max-w-[420px]">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/**
 * The workspace's dental chart card: the title, the hint, the dentition selector and how the
 * clinic charts (surfaces or whole teeth), the legend, then the full chart at 12px cells. The
 * chart draws the patient's records plus this visit's services as they stand in the visit cache
 * (`deriveChart`, the same derivation the API runs), so a service added here marks its tooth at
 * once. Clicking a tooth selects it (`useToothSelection`), which clears the pending surfaces.
 */
export function ChartCard({
  visit,
  chart,
  patient,
  dentition,
  canWrite,
}: {
  visit: Visit;
  chart: PatientChart;
  patient: Patient;
  dentition: ResolvedDentition;
  canWrite: boolean;
}) {
  const { t } = useTranslation('clinical');
  const { mode } = useChartSettings();
  const selection = useToothSelection();
  const teeth = useMemo(
    () =>
      deriveChart({
        diagnoses: chart.diagnoses,
        plans: chart.plans,
        history: chart.history,
        liveServices: visit.services,
      }),
    [chart.diagnoses, chart.plans, chart.history, visit.services],
  );

  return (
    <ChartCardFrame
      subtitle={
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <DentitionSelect patient={patient} dentition={dentition} canWrite={canWrite} />
          <span className="text-[12.5px] leading-none text-ink-muted">
            {t(`chartCard.mode.${mode}`)}
          </span>
        </div>
      }
      aside={<ChartLegend dentition={dentition.stage} />}
    >
      <DentalChart
        teeth={teeth}
        dentition={dentition.stage}
        toothStatus={chart.toothStatus}
        size={12}
        selected={selection.tooth}
        onToothClick={selection.select}
      />
    </ChartCardFrame>
  );
}
