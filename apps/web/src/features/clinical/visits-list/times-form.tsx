import type { VisitListItem } from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { Field, TextInput } from '@/components/ui/field';
import { toZonedInput } from '@/lib/zoned-time';
import { draftMinutes, type TimesDraft, timesOf } from './times-draft';

/**
 * A correction's day and times (ADR-0062, ADR-0063): the visit's date (another day moves the
 * visit; its charge keeps its date), its start and end as clock times on that day (an end before
 * the start is the next day), and the duration before → after.
 */
export function TimesForm({
  visit,
  draft,
  timeZone,
  onChange,
}: {
  visit: VisitListItem;
  draft: TimesDraft;
  timeZone: string;
  onChange: (draft: TimesDraft) => void;
}) {
  const { t } = useTranslation('visits');
  const minutes = draftMinutes(draft, timeZone);
  const nextDay = timesOf(draft, timeZone)?.nextDay ?? false;
  const today = toZonedInput(new Date().toISOString(), timeZone).slice(0, 10);
  const duration = (value: number | null) =>
    value === null ? '—' : t('times.minutes', { minutes: value });

  return (
    <section className="flex flex-col gap-3">
      <p className="text-[12.5px] leading-snug text-ink-secondary">{t('times.intro')}</p>
      <Field
        label={t('times.date')}
        hint={draft.date !== visit.localDate ? t('times.moved') : undefined}
      >
        {(props) => (
          <TextInput
            {...props}
            type="date"
            dir="ltr"
            max={today}
            value={draft.date}
            onChange={(event) => {
              onChange({ ...draft, date: event.target.value });
            }}
          />
        )}
      </Field>
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
