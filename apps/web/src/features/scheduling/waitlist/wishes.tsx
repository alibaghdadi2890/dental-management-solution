import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, Select, TextInput } from '@/components/ui/field';
import { InfoMark } from '@/components/ui/info-mark';
import { formatCalendarDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { clockText, WEEK, weekdayName, type WishesState, wishesValid } from './wishes-state';

const TIMES = Array.from({ length: 24 * 4 }, (_, index) => {
  const hour = String(Math.floor(index / 4)).padStart(2, '0');
  return `${hour}:${String((index % 4) * 15).padStart(2, '0')}`;
});

/**
 * The wishes' fields (A2), under the *Wants an earlier time* tick and in the Add to waitlist
 * panel. Only the days the branch opens are offered. *Until* is the caller's: typed for an entry
 * without an appointment, read for one with.
 */
export function WishesFields({
  value,
  onChange,
  openWeekdays,
  until,
}: {
  value: WishesState;
  onChange: (next: WishesState) => void;
  openWeekdays: ReadonlySet<number>;
  until?: ReactNode;
}) {
  const { t, i18n } = useTranslation('scheduling');
  const locale = i18n.language;
  const set = (patch: Partial<WishesState>) => {
    onChange({ ...value, ...patch });
  };
  const days = WEEK.filter((day) => openWeekdays.has(day));
  const betweenInvalid = !wishesValid(value);
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="m-0 mb-1.5 flex items-center gap-1.5 text-xs leading-none font-medium text-ink-secondary">
          {t('waitlist.days')}
          <InfoMark about={t('waitlist.days')}>{t('waitlist.daysInfo')}</InfoMark>
        </p>
        <div role="group" aria-label={t('waitlist.days')} className="flex flex-wrap gap-1">
          {days.map((day) => {
            const on = value.weekdays.includes(day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={on}
                className={cn(
                  'h-[28px] cursor-pointer rounded-md border px-2 text-[12px]',
                  on
                    ? 'border-primary bg-primary-tint font-semibold text-primary'
                    : 'border-border-control bg-surface',
                )}
                onClick={() => {
                  set({
                    weekdays: on
                      ? value.weekdays.filter((item) => item !== day)
                      : [...value.weekdays, day],
                  });
                }}
              >
                {weekdayName(day, locale)}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('waitlist.earliest')}>
          {(field) => (
            <Select
              {...field}
              value={value.betweenFrom}
              onChange={(event) => {
                set({ betweenFrom: event.target.value });
              }}
            >
              <option value="">{t('waitlist.anyTime')}</option>
              {TIMES.map((time) => (
                <option key={time} value={time}>
                  {clockText(time, locale)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label={t('waitlist.latest')}
          error={betweenInvalid ? t('waitlist.betweenInvalid') : undefined}
        >
          {(field) => (
            <Select
              {...field}
              value={value.betweenTo}
              onChange={(event) => {
                set({ betweenTo: event.target.value });
              }}
            >
              <option value="">{t('waitlist.anyTime')}</option>
              {TIMES.map((time) => (
                <option key={time} value={time}>
                  {clockText(time, locale)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('waitlist.notBefore')}>
          {(field) => (
            <TextInput
              {...field}
              type="date"
              value={value.notBefore}
              onChange={(event) => {
                set({ notBefore: event.target.value });
              }}
            />
          )}
        </Field>
        {until}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={value.sameDay}
            onChange={(event) => {
              set({ sameDay: event.target.checked });
            }}
          />
          {t('waitlist.sameDay')}
          <InfoMark about={t('waitlist.sameDay')}>{t('waitlist.sameDayInfo')}</InfoMark>
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={value.urgent}
            onChange={(event) => {
              set({ urgent: event.target.checked });
            }}
          />
          {t('waitlist.urgent')}
        </label>
      </div>
      <Field label={t('waitlist.note')}>
        {(field) => (
          <TextInput
            {...field}
            value={value.note}
            maxLength={500}
            onChange={(event) => {
              set({ note: event.target.value });
            }}
          />
        )}
      </Field>
    </div>
  );
}

/** *Before {date}*: an entry with an appointment never types its date (A2). */
export function BeforeLine({ date }: { date: string }) {
  const { t, i18n } = useTranslation('scheduling');
  return (
    <div>
      <p className="m-0 mb-1.5 flex items-center gap-1.5 text-[12.5px] leading-none font-medium">
        {t('waitlist.until')}
        <InfoMark about={t('waitlist.until')}>{t('waitlist.beforeInfo')}</InfoMark>
      </p>
      <p className="m-0 flex h-[34px] items-center text-[13px] text-ink-secondary">
        {t('waitlist.before', { date: formatCalendarDate(date, i18n.language) })}
      </p>
    </div>
  );
}
