import type { VisitListItem } from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { Field, TextInput } from '@/components/ui/field';
import { formatCalendarDate } from '@/lib/format';
import { draftMinutes, type TimesDraft, timesOf } from './times-draft';

/**
 * The detail panel's body while correcting a finished visit's times (ADR-0062): its start and end
 * as clock times on the visit's day (an end before the start is the next day), and the duration
 * before → after. The services, money and date are not part of it.
 */
export function TimesForm({
  visit,
  draft,
  timeZone,
  locale,
  onChange,
}: {
  visit: VisitListItem;
  draft: TimesDraft;
  timeZone: string;
  locale: string;
  onChange: (draft: TimesDraft) => void;
}) {
  const { t } = useTranslation('visits');
  const minutes = draftMinutes(draft, visit, timeZone);
  const nextDay = timesOf(draft, visit, timeZone)?.nextDay ?? false;
  const duration = (value: number | null) =>
    value === null ? '—' : t('times.minutes', { minutes: value });

  return (
    <section className="flex flex-col gap-3">
      <p className="text-[12.5px] leading-snug text-ink-secondary">
        {t('times.intro', { date: formatCalendarDate(visit.localDate, locale) })}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('times.start')}>
          {(props) => (
            <TextInput
              {...props}
              type="time"
              dir="ltr"
              value={draft.start}
              onChange={(event) => {
                onChange({ ...draft, start: event.target.value });
              }}
            />
          )}
        </Field>
        <Field label={t('times.end')} hint={nextDay ? t('times.nextDay') : undefined}>
          {(props) => (
            <TextInput
              {...props}
              type="time"
              dir="ltr"
              value={draft.end}
              onChange={(event) => {
                onChange({ ...draft, end: event.target.value });
              }}
            />
          )}
        </Field>
      </div>
      <p className="text-[12.5px] leading-snug">
        {t('times.duration', {
          before: duration(visit.durationMinutes),
          after: duration(minutes),
        })}
      </p>
    </section>
  );
}
