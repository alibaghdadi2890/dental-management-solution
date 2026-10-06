import type { PatientChart, Visit, VisitService } from '@dcm/contracts';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMoney } from '@/lib/format';
import { useLevelLabel, useToothLabel } from '../chart/use-chart-settings';
import { ServiceMenu } from './row-menu';
import { useToothSelection } from './tooth-selection';
import { unfinishedWork } from './unfinished';
import { UnfinishedRow } from './unfinished-row';

const SUB_HEAD =
  'm-0 border-b border-warning-border bg-warning-bg px-4 py-2 text-[11.5px] leading-none font-semibold tracking-[.05em] text-warning uppercase [&:lang(ar)]:tracking-normal';

/**
 * Today's services: what this visit works on, whatever its level — a tooth, a jaw or the whole
 * mouth. First **To continue**, the patient's unfinished services (ADR-0032) this visit has not
 * worked on, so they are seen as the visit opens; then the visit's services in the order added,
 * and the unfinished services it did work on. A row's target selects it on the chart; a service's
 * three-dot menu holds **Not finished** and **Remove**. The header counts and totals what the
 * visit charges; the footer sets that beside what is carried forward. Nothing is shown while the
 * visit has no service and the patient no unfinished one.
 */
export function TodaysServices({
  visit,
  chart,
  canWrite,
}: {
  visit: Visit;
  /** For the unfinished services; none are shown until it loads. */
  chart: PatientChart | undefined;
  canWrite: boolean;
}) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const titleId = useId();
  const { toContinue, workedHere, carried } = unfinishedWork(chart?.plans ?? [], visit.id);
  if (visit.services.length === 0 && carried === null) return null;
  const charged = formatMoney({ amount: visit.money.subtotal, currency: visit.currency }, locale);
  return (
    <section
      aria-labelledby={titleId}
      className="mb-4 overflow-hidden rounded-xl border border-primary-tint-border bg-surface"
    >
      <div className="flex flex-wrap items-baseline gap-[9px] border-b border-primary-tint-border bg-selected px-4 py-3.5">
        <h2 id={titleId} className="m-0 text-[14px] leading-none font-semibold text-primary">
          {t('todayServices.title')}
        </h2>
        <span className="ms-auto text-[12.5px] leading-none text-ink-muted">
          {t('todayServices.count', { count: visit.services.length })}
        </span>
        <span dir="ltr" className="font-mono text-[15px] leading-none font-bold tabular-nums">
          {charged}
        </span>
      </div>
      {toContinue.length > 0 && (
        <>
          <h3 className={SUB_HEAD}>{t('unfinished.toContinue', { count: toContinue.length })}</h3>
          <ul data-to-continue className="m-0 list-none p-0">
            {toContinue.map((plan) => (
              <li key={plan.id} className="border-b border-warning-border">
                <UnfinishedRow plan={plan} canWrite={canWrite} target className="px-4 py-3" />
              </li>
            ))}
          </ul>
        </>
      )}
      <ul className="m-0 list-none p-0">
        {visit.services.map((service) => (
          <ServiceRow key={service.id} service={service} canWrite={canWrite} />
        ))}
        {workedHere.map((plan) => (
          <li key={plan.id} className="border-b border-row-divider last:border-b-0">
            <UnfinishedRow plan={plan} canWrite={canWrite} target className="px-4 py-3" />
          </li>
        ))}
      </ul>
      {carried && (
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-t border-row-divider bg-sunken px-4 py-2.5 text-[12.5px] leading-none text-ink-muted">
          <span>
            {t('todayServices.charged')}{' '}
            <b dir="ltr" className="font-mono font-semibold text-ink tabular-nums">
              {charged}
            </b>
          </span>
          <span>
            {t('todayServices.carried')}{' '}
            <b dir="ltr" className="font-mono font-semibold text-ink tabular-nums">
              {formatMoney(carried, locale)}
            </b>
          </span>
        </div>
      )}
    </section>
  );
}

function ServiceRow({ service, canWrite }: { service: VisitService; canWrite: boolean }) {
  const { i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const { select, selectArea } = useToothSelection();
  const toothLabel = useToothLabel();
  const levelLabel = useLevelLabel();
  const { toothCode } = service;
  return (
    <li
      data-service={service.id}
      className="flex items-center gap-3 border-b border-row-divider px-4 py-3 last:border-b-0"
    >
      <button
        type="button"
        dir={toothCode === null ? undefined : 'ltr'}
        onClick={() => {
          if (toothCode === null) selectArea(service.jaw ?? 'mouth');
          else select(toothCode);
        }}
        className="min-w-[72px] flex-none cursor-pointer border-0 bg-transparent p-0 text-start font-mono text-[13px] leading-none font-semibold text-primary hover:underline"
      >
        {toothCode === null ? levelLabel(service.jaw) : toothLabel(toothCode)}
      </button>
      <span className="min-w-0 flex-1 text-[13px] leading-[1.35] font-semibold">
        {service.name}
      </span>
      <span dir="ltr" className="font-mono text-[13px] leading-none font-semibold tabular-nums">
        {formatMoney(service.final, locale)}
      </span>
      {canWrite && <ServiceMenu service={service} />}
    </li>
  );
}
