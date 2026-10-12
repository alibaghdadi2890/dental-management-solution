import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { formatCalendarDate } from '@/lib/format';
import { lastVisitOfTypeQuery } from '../visits-api';

/**
 * A hygiene visit's **Last hygiene visit** line (feature 10, V9), above the chart: the previous
 * completed hygiene visit's date, dentist and what was done — or "None recorded".
 */
export function LastHygieneLine({ patientId }: { patientId: string }) {
  const { t, i18n } = useTranslation('clinical');
  const locale = i18n.resolvedLanguage ?? 'en';
  const last = useQuery(lastVisitOfTypeQuery(patientId, 'hygiene'));
  const visit = last.data;
  return (
    <section
      aria-label={t('flow.lastHygiene.title')}
      className="mb-4 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 rounded-xl border border-border bg-surface px-4 py-3"
    >
      <h2 className="m-0 text-[13px] leading-none font-semibold">{t('flow.lastHygiene.title')}</h2>
      {visit ? (
        <>
          <span className="font-mono text-[12.5px] leading-none font-medium">
            {formatCalendarDate(visit.date, locale)}
          </span>
          <span className="text-[12.5px] leading-none text-ink-tertiary">{visit.dentistName}</span>
          <span className="text-[12.5px] leading-[1.35] text-ink-secondary">
            {visit.services.map((service) => service.name).join(t('title.listSeparator'))}
          </span>
        </>
      ) : (
        <span className="text-[12.5px] leading-none text-ink-muted">
          {last.isPending
            ? t('workspace.loading')
            : last.isError
              ? t('flow.lastVisit.failed')
              : t('flow.lastHygiene.none')}
        </span>
      )}
    </section>
  );
}
