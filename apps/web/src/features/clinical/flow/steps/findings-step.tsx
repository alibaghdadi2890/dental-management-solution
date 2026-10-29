import { type DiagnosisRecord, isOpenPlan, type PatientChart, type Visit } from '@dcm/contracts';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CardSkeleton } from '@/components/ui/card';
import { formatCalendarDate } from '@/lib/format';
import { useTargetLabel } from '../use-target-label';
import { useChartingActions } from '../../workspace/charting-actions';
import { SurfaceTag } from '../../workspace/tooth-panel/surface-tag';
import { EMPTY_LINE, STEP_BODY } from '../flow-styles';
import { inTodaysPlan, openFromBefore, recordedToday } from '../proposals';
import { SeenOnSelect } from '../seen-on-select';

const GRID =
  'grid grid-cols-[72px_minmax(180px,1.3fr)_minmax(180px,1fr)_minmax(150px,1fr)_88px] items-center gap-3 px-[18px]';
const GROUP =
  'm-0 px-[18px] pt-3.5 pb-2.5 text-[12px] leading-none font-semibold tracking-[.05em] text-ink-secondary uppercase [&:lang(ar)]:tracking-normal';
const LINK = 'cursor-pointer border-0 bg-transparent p-0 text-[12.5px] font-medium hover:underline';

/**
 * **Findings** (feature 10, V6): what the examination found, in two groups. **Recorded today** —
 * this visit's diagnoses, each with its Seen on, what is planned for it, and Remove; **Open from
 * before, not planned** — older active diagnoses no plan treats yet, each with **Plan treatment
 * →**, which carries it into the Plan step. A tooth label goes back to Examine with that tooth
 * selected.
 */
export function FindingsStep({
  visit,
  chart,
  canWrite,
  carried,
  onPlan,
  onTooth,
}: {
  visit: Visit;
  chart: PatientChart | undefined;
  canWrite: boolean;
  carried: ReadonlySet<string>;
  /** Opens the Plan step on this diagnosis's card (carrying it there when it is an older one). */
  onPlan: (record: DiagnosisRecord) => void;
  onTooth: (record: DiagnosisRecord) => void;
}) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const actions = useChartingActions();
  const placeLabel = useTargetLabel();
  if (chart === undefined) {
    return (
      <div data-step="findings" className={STEP_BODY}>
        <section className="rounded-xl border border-border bg-surface px-[18px] py-4">
          <CardSkeleton label={t('workspace.loading')} />
        </section>
      </div>
    );
  }
  const today = recordedToday(chart, visit.id);
  const older = openFromBefore(chart, visit.id);
  const plansFor = (record: DiagnosisRecord) =>
    chart.plans.filter((plan) => plan.diagnosisRecordId === record.id && isOpenPlan(plan));

  const tooth = (record: DiagnosisRecord) => (
    <span role="cell" className="justify-self-start">
      <button
        type="button"
        dir="ltr"
        aria-label={t('flow.findings.examine', { tooth: placeLabel(record) })}
        onClick={() => {
          onTooth(record);
        }}
        className="cursor-pointer border-0 bg-transparent p-0 font-mono text-[14px] leading-none font-bold text-primary hover:underline"
      >
        {placeLabel(record)}
      </button>
    </span>
  );
  /** A line across the table: a group's heading, or that the group is empty. */
  const across = (content: ReactNode, className?: string) => (
    <div role="row" className={className}>
      <span role="cell" className="block">
        {content}
      </span>
    </div>
  );
  const row = (record: DiagnosisRecord, cells: ReactNode) => (
    <div
      key={record.id}
      role="row"
      data-record={record.id}
      className={`${GRID} min-h-[54px] border-t border-row-divider py-2`}
    >
      {tooth(record)}
      {cells}
    </div>
  );

  return (
    <div data-step="findings" className={STEP_BODY}>
      <section className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="overflow-x-auto">
          <div role="table" aria-label={t('flow.findings.title')} className="min-w-[760px]">
            <div
              role="row"
              className={`${GRID} h-10 border-b border-border bg-faint text-[11.5px] leading-none font-medium tracking-[.05em] text-ink-muted uppercase [&:lang(ar)]:tracking-normal`}
            >
              <span role="columnheader">{t('flow.findings.tooth')}</span>
              <span role="columnheader">{t('flow.findings.diagnosis')}</span>
              <span role="columnheader">{t('flow.seenOn.label')}</span>
              <span role="columnheader">{t('flow.findings.plan')}</span>
              <span role="columnheader" />
            </div>
            {across(<h3 className={GROUP}>{t('flow.findings.today')}</h3>)}
            {today.map((record) => {
              const plans = plansFor(record);
              return row(
                record,
                <>
                  <span role="cell" className="min-w-0">
                    <span className="text-[13px] leading-[1.35] font-semibold text-danger">
                      {record.name}
                    </span>
                    <SurfaceTag surfaces={record.surfaces} className="ms-[7px] text-danger" />
                  </span>
                  <span role="cell" className="min-w-0">
                    <SeenOnSelect record={record} canWrite={canWrite} />
                  </span>
                  <span role="cell" className="min-w-0 text-[12.5px] leading-[1.4]">
                    {plans.length > 0 ? (
                      <span className="font-medium text-warning">
                        {plans.map((plan) => plan.name).join(t('title.listSeparator'))}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          onPlan(record);
                        }}
                        className={`${LINK} text-primary`}
                      >
                        {t('flow.findings.planTreatment')}
                        <span aria-hidden className="ms-1 inline-block rtl:-scale-x-100">
                          {'→'}
                        </span>
                      </button>
                    )}
                  </span>
                  <span role="cell" className="justify-self-end">
                    {canWrite && (
                      <button
                        type="button"
                        aria-label={t('panel.removeNamed', { name: record.name })}
                        onClick={() => {
                          actions.removeDiagnosis(record.id);
                        }}
                        className={`${LINK} text-danger`}
                      >
                        {t('panel.remove')}
                      </button>
                    )}
                  </span>
                </>,
              );
            })}
            {today.length === 0 &&
              across(
                <p className={`${EMPTY_LINE} px-[18px] pt-1 pb-[18px]`}>
                  {t('flow.findings.noneToday')}
                </p>,
              )}
            {across(
              <h3 className={GROUP}>{t('flow.findings.older')}</h3>,
              'mt-1.5 border-t border-border',
            )}
            {older.map((record) => {
              const included = inTodaysPlan(chart, record, carried);
              return row(
                record,
                <>
                  <span role="cell" className="flex min-w-0 flex-col gap-[3px]">
                    <span className="text-[13px] leading-[1.35] font-semibold text-danger">
                      {record.name}
                    </span>
                    <span className="text-[12px] leading-none text-ink-muted">
                      {t('flow.findings.recorded', {
                        date: formatCalendarDate(record.recordedDate, locale),
                      })}
                    </span>
                  </span>
                  <span
                    role="cell"
                    className="min-w-0 text-[12.5px] leading-[1.4] text-ink-secondary"
                  >
                    {record.note}
                  </span>
                  <span role="cell" className="min-w-0">
                    <button
                      type="button"
                      onClick={() => {
                        onPlan(record);
                      }}
                      className={`${LINK} ${included ? 'text-warning' : 'text-primary'}`}
                    >
                      {t(included ? 'flow.findings.inPlan' : 'flow.findings.planTreatment')}
                      <span aria-hidden className="ms-1 inline-block rtl:-scale-x-100">
                        {'→'}
                      </span>
                    </button>
                  </span>
                  <span role="cell" />
                </>,
              );
            })}
            {older.length === 0 &&
              across(
                <p className={`${EMPTY_LINE} px-[18px] pt-1 pb-[18px]`}>
                  {t('flow.findings.noneOlder')}
                </p>,
              )}
          </div>
        </div>
      </section>
    </div>
  );
}
