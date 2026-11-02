import { type ScheduleDentist, SLOT_LENGTHS } from '@dcm/contracts';
import { Popover } from 'radix-ui';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { formatCalendarDate } from '@/lib/format';
import { initials } from '@/lib/initials';
import { cn } from '@/lib/utils';
import type { ScheduleView } from './schedule-calendar';
import type { ScheduleSearch } from './schedule-page';
import { addDays, dentistColor, weekOf } from './schedule-time';

const SEGMENT =
  'h-[26px] cursor-pointer rounded-md border-none px-3 text-[12.5px] leading-none whitespace-nowrap';
const segment = (on: boolean) =>
  cn(
    SEGMENT,
    on ? 'bg-primary-tint font-semibold text-primary' : 'bg-transparent text-ink-secondary',
  );

const weekdayOf = (date: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  );

const dayOfMonth = (date: string) => String(Number(date.slice(8)));

/** The design's two rows: range and view, then the days, the filters and Display. */
export function ScheduleToolbar({
  view,
  date,
  today,
  dates,
  locale,
  dentists,
  rooms,
  search,
  slotLength,
  canBook,
  onSlotLength,
  onSearch,
  onNew,
}: {
  view: ScheduleView;
  date: string;
  today: string;
  dates: readonly string[];
  locale: string;
  dentists: readonly ScheduleDentist[];
  rooms: readonly { id: string; name: string }[];
  search: ScheduleSearch;
  slotLength: number;
  canBook: boolean;
  onSlotLength: (slotLength: number) => void;
  onSearch: (next: ScheduleSearch) => void;
  onNew: () => void;
}) {
  const { t } = useTranslation('scheduling');
  const step = view === 'day' ? 1 : 7;
  const go = (next: string) => {
    onSearch({ ...search, date: next });
  };
  const first = dates[0] ?? date;
  const last = dates.at(-1) ?? date;
  const label =
    view === 'day'
      ? formatCalendarDate(date, locale)
      : `${formatCalendarDate(first, locale)} – ${formatCalendarDate(last, locale)}`;
  const chips = [{ id: undefined, name: t('toolbar.allDentists') }, ...dentists];

  return (
    <div className="mb-3 flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <h1 className="m-0 text-[19px] leading-none font-semibold">{t('title')}</h1>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="secondary"
            aria-label={t('toolbar.previous')}
            onClick={() => {
              go(addDays(date, -step));
            }}
          >
            <span className="rtl:rotate-180">‹</span>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            aria-label={t('toolbar.next')}
            onClick={() => {
              go(addDays(date, step));
            }}
          >
            <span className="rtl:rotate-180">›</span>
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={date === today}
            onClick={() => {
              go(today);
            }}
          >
            {t('toolbar.today')}
          </Button>
        </div>
        <span className="text-[14px] font-medium">{label}</span>
        <div className="ms-auto flex items-center gap-2">
          <div
            role="group"
            aria-label={t('toolbar.view')}
            className="flex rounded-lg border border-border p-0.5"
          >
            {(['day', 'week'] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={view === option}
                className={segment(view === option)}
                onClick={() => {
                  onSearch({ ...search, view: option === 'day' ? undefined : option });
                }}
              >
                {t(`toolbar.${option}`)}
              </button>
            ))}
          </div>
          {canBook ? (
            <Button size="sm" variant="primary" onClick={onNew}>
              {t('toolbar.newAppointment')}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        {view === 'day' ? (
          <div role="group" aria-label={t('toolbar.days')} className="flex gap-0.5">
            {weekOf(date).map((day) => (
              <button
                key={day}
                type="button"
                aria-pressed={day === date}
                className={cn(segment(day === date), 'px-2', day === today && 'text-primary')}
                onClick={() => {
                  go(day);
                }}
              >
                {weekdayOf(day, locale)} {dayOfMonth(day)}
              </button>
            ))}
          </div>
        ) : null}
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label={t('toolbar.dentist')}
            className="flex rounded-lg border border-border p-0.5"
          >
            {chips.map((chip) => {
              const on = search.dentist === chip.id;
              const color =
                chip.id === undefined ? null : dentistColor('order' in chip ? chip.order : 0);
              return (
                <button
                  key={chip.id ?? 'all'}
                  type="button"
                  aria-pressed={on}
                  aria-label={chip.name}
                  title={chip.name}
                  className={cn(segment(on), 'flex items-center gap-1.5 px-2')}
                  onClick={() => {
                    onSearch({ ...search, dentist: chip.id });
                  }}
                >
                  {color ? (
                    <span
                      aria-hidden
                      className="size-2 rounded-full"
                      style={{ background: `var(--color-mark-${color})` }}
                    />
                  ) : null}
                  {chip.id === undefined ? chip.name : initials(chip.name)}
                </button>
              );
            })}
          </div>
          <Select
            aria-label={t('toolbar.room')}
            className="h-[30px] w-auto"
            value={search.room ?? ''}
            onChange={(event) => {
              onSearch({ ...search, room: event.target.value || undefined });
            }}
          >
            <option value="">{t('toolbar.allRooms')}</option>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </Select>
          {search.unresolved ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                onSearch({ ...search, unresolved: undefined });
              }}
            >
              {t('toolbar.clearUnresolved')}
            </Button>
          ) : null}
          <Popover.Root>
            <Popover.Trigger asChild>
              <Button size="sm" variant="secondary">
                {t('toolbar.display')}
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                align="end"
                sideOffset={6}
                aria-label={t('toolbar.display')}
                className="z-40 rounded-[10px] border border-border bg-surface p-3 shadow-[0_10px_28px_rgba(27,26,31,.14)]"
              >
                <p className="m-0 mb-2 text-[12px] font-medium text-ink-muted">
                  {t('toolbar.slotLength')}
                </p>
                <div role="group" aria-label={t('toolbar.slotLength')} className="flex gap-1">
                  {SLOT_LENGTHS.map((length) => (
                    <button
                      key={length}
                      type="button"
                      aria-pressed={length === slotLength}
                      className={segment(length === slotLength)}
                      onClick={() => {
                        onSlotLength(length);
                      }}
                    >
                      {length}
                    </button>
                  ))}
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
      </div>
    </div>
  );
}
