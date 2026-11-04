import type { Appointment, OpeningDay, ScheduleDentist, Slot } from '@dcm/contracts';
import { DateTime, Settings } from 'luxon';
import { type CSSProperties, useMemo } from 'react';
import { Calendar, type Components, luxonLocalizer, Views } from 'react-big-calendar';
import withDragAndDropModule from 'react-big-calendar/lib/addons/dragAndDrop';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import './schedule.css';
import { useTranslation } from 'react-i18next';
import { formatTime } from '@/lib/format';
import { initials } from '@/lib/initials';
import { cn } from '@/lib/utils';
import { ScheduleCard, ScheduleClusterCard } from './schedule-card';
import { arrangeEvents, type CalendarEvent, type ScheduleView } from './schedule-events';
import {
  clinicClock,
  clockOf,
  dentistColor,
  instantOf,
  isClosedAt,
  isClosedDay,
  minutesOf,
} from './schedule-time';

interface Column {
  id: string;
  title: string;
}

/** CommonJS default interop differs between Vite's dev server and its build. */
const withDragAndDrop =
  (withDragAndDropModule as unknown as { default?: typeof withDragAndDropModule }).default ??
  withDragAndDropModule;
const DragAndDropCalendar = withDragAndDrop<CalendarEvent, Column>(Calendar as never);

/** How tall a minute is, as in the design. */
const MINUTE_PX = 1.4;

/** The localizer works in the clinic's zone: dates on screen are never the browser's. */
function clinicLocalizer(timeZone: string) {
  Settings.defaultZone = timeZone;
  return luxonLocalizer(DateTime, { firstDayOfWeek: 1 });
}

/** `Mon 31`, the design's week header, in the clinic's zone and the user's language. */
function dayName(value: Date, timeZone: string, locale: string): string {
  const format = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { timeZone, ...options }).format(value);
  return `${format({ weekday: 'short' })} ${format({ day: 'numeric' })}`;
}

const timeslotsOf = (slotLength: number) => (slotLength === 15 ? 4 : slotLength === 30 ? 2 : 1);

export type { CalendarEvent, ScheduleView } from './schedule-events';

export interface ScheduleCalendarProps {
  view: ScheduleView;
  date: string;
  timeZone: string;
  locale: string;
  rtl: boolean;
  dentists: readonly ScheduleDentist[];
  events: readonly CalendarEvent[];
  hours: readonly OpeningDay[];
  slotLength: number;
  bounds: { from: number; to: number };
  canDrag: (appointment: Appointment) => boolean;
  /** Move mode: the starts on offer, by dentist and instant. */
  moveSlots: ReadonlyMap<string, ReadonlyMap<number, Slot>> | null;
  now: () => Date;
  onDate: (date: string) => void;
  /** A day's header or crowded card: opens that day. */
  onDay: (date: string) => void;
  /** No dentist in the week view, where a column is a day. */
  onEmptySlot: (dentistId: string | null, start: Date) => void;
  /** `point`: where the click landed, from the card's top-left corner. */
  onOpen: (appointment: Appointment, anchor: DOMRect, point?: { x: number; y: number }) => void;
  onMove: (appointment: Appointment, start: Date, dentistId: string) => void;
  onResize: (appointment: Appointment, end: Date) => void;
}

/**
 * The calendar grid (ADR-0071): the only file that knows `react-big-calendar`. Day shows a column per
 * dentist; week a column per day, every dentist in it, a card naming theirs (the design's). Drops
 * are only proposals: the page confirms them, so a card that is refused simply stays where it was.
 */
export function ScheduleCalendar(props: ScheduleCalendarProps) {
  const { t } = useTranslation('scheduling');
  const { view, date, timeZone, locale, rtl, dentists, events, hours } = props;
  const { slotLength, bounds, canDrag, moveSlots, now } = props;
  const localizer = useMemo(() => clinicLocalizer(timeZone), [timeZone]);
  const anchor = useMemo(() => instantOf(date, '12:00', timeZone), [date, timeZone]);
  const min = useMemo(
    () => instantOf(date, clockOf(bounds.from), timeZone),
    [date, bounds.from, timeZone],
  );
  const max = useMemo(
    () => instantOf(date, clockOf(bounds.to), timeZone),
    [date, bounds.to, timeZone],
  );
  // Today opens at the current time, an hour of context above it; other days at the opening.
  const scrollTo = useMemo(() => {
    const current = now();
    if (clinicClock(current, timeZone).date !== date) return min;
    return new Date(Math.max(min.getTime(), current.getTime() - 3_600_000));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per day shown, not per tick
  }, [date, timeZone, min]);
  const columns = useMemo<Column[]>(
    () => dentists.map((dentist) => ({ id: dentist.id, title: dentist.name })),
    [dentists],
  );
  const colorOf = useMemo(
    () => new Map(dentists.map((dentist) => [dentist.id, dentistColor(dentist.order)])),
    [dentists],
  );
  const arranged = useMemo(() => arrangeEvents(events, view, timeZone), [events, view, timeZone]);
  const week = view === 'week';
  const multiDentist = dentists.length > 1;

  const today = clinicClock(now(), timeZone).date;
  const selectedDay = date;

  const components = useMemo<Components<CalendarEvent, Column>>(
    () => ({
      toolbar: () => null,
      event: ({ event }) =>
        event.cluster ? (
          <ScheduleClusterCard
            cluster={event.cluster}
            start={event.start}
            end={event.end}
            timeZone={timeZone}
            locale={locale}
          />
        ) : (
          <ScheduleCard
            appointment={event.appointment}
            timeZone={timeZone}
            locale={locale}
            week={week}
            multiDentist={multiDentist}
            lanes={event.lanes ?? 1}
          />
        ),
      week: {
        header: ({ date: day }) => {
          const { date: local } = clinicClock(day, timeZone);
          return (
            <span
              className="schedule-day-head"
              data-today={local === today || undefined}
              data-selected={local === selectedDay || undefined}
            >
              <span className="schedule-day-name">{dayName(day, timeZone, locale)}</span>
              {isClosedDay(local, hours) ? (
                <span className="schedule-day-sub">{t('settings.closed')}</span>
              ) : null}
            </span>
          );
        },
      },
      resourceHeader: ({ resource }) => (
        <span className="schedule-column-head">
          <span
            className="schedule-avatar"
            style={
              {
                '--dentist': `var(--color-mark-${colorOf.get(resource.id) ?? 'blue'})`,
              } as CSSProperties
            }
          >
            {initials(resource.title)}
          </span>
          <span className="schedule-column-name truncate">{resource.title}</span>
        </span>
      ),
    }),
    [timeZone, locale, week, multiDentist, colorOf, today, selectedDay, hours, t],
  );

  return (
    <div
      className={cn('schedule-grid', moveSlots && 'schedule-moving')}
      style={
        {
          '--schedule-group': `${String(slotLength * timeslotsOf(slotLength) * MINUTE_PX)}px`,
          '--schedule-closed-label': JSON.stringify(t('settings.closed')),
        } as CSSProperties
      }
    >
      <DragAndDropCalendar
        localizer={localizer}
        culture={locale}
        rtl={rtl}
        events={arranged}
        {...(week
          ? {}
          : {
              resources: columns,
              resourceAccessor: 'dentistId',
              resourceIdAccessor: 'id',
              resourceTitleAccessor: 'title',
            })}
        date={anchor}
        onNavigate={(next) => {
          props.onDate(clinicClock(next, timeZone).date);
        }}
        onDrillDown={(day) => {
          props.onDay(clinicClock(day, timeZone).date);
        }}
        view={week ? Views.WEEK : Views.DAY}
        onView={() => undefined}
        views={[Views.DAY, Views.WEEK]}
        step={slotLength}
        timeslots={timeslotsOf(slotLength)}
        min={min}
        max={max}
        getNow={now}
        scrollToTime={scrollTo}
        dayLayoutAlgorithm="no-overlap"
        components={components}
        messages={{ noEventsInRange: t('calendar.empty') }}
        formats={{
          timeGutterFormat: (value: Date) => formatTime(value, { timeZone, locale }),
        }}
        selectable={moveSlots ? true : 'ignoreEvents'}
        resizable
        draggableAccessor={(event) =>
          !event.pending && !event.cluster && canDrag(event.appointment)
        }
        resizableAccessor={(event) =>
          !event.pending && !event.cluster && canDrag(event.appointment)
        }
        onSelectSlot={({ start, resourceId }) => {
          props.onEmptySlot(typeof resourceId === 'string' ? resourceId : null, new Date(start));
        }}
        onSelectEvent={(event, domEvent) => {
          if (event.pending) return;
          if (event.cluster) {
            props.onDay(event.cluster.date);
            return;
          }
          const target = domEvent.currentTarget as HTMLElement | null;
          if (!target) return;
          // The card the popover then follows (`data-appointment`), not the event box around it.
          const rect = (
            target.querySelector('[data-appointment]') ?? target
          ).getBoundingClientRect();
          // A click says where it landed; Enter on a focused card does not (`detail` 0).
          const native = domEvent.nativeEvent;
          const clicked = native instanceof MouseEvent && native.detail > 0;
          props.onOpen(
            event.appointment,
            rect,
            clicked ? { x: native.clientX - rect.left, y: native.clientY - rect.top } : undefined,
          );
        }}
        onEventDrop={({ event, start, resourceId }) => {
          props.onMove(
            event.appointment,
            new Date(start),
            typeof resourceId === 'string' ? resourceId : event.dentistId,
          );
        }}
        onEventResize={({ event, end }) => {
          props.onResize(event.appointment, new Date(end));
        }}
        eventPropGetter={(event) => {
          const color = colorOf.get(event.dentistId) ?? 'blue';
          return {
            className: cn(
              'schedule-event',
              !event.cluster &&
                event.appointment.status === 'cancelled' &&
                'schedule-event-cancelled',
              !event.cluster && event.appointment.status === 'no_show' && 'schedule-event-muted',
              !event.cluster && event.appointment.status === 'completed' && 'schedule-event-muted',
              event.cluster && 'schedule-event-cluster',
              event.pending && 'schedule-event-pending',
            ),
            style: { '--dentist': `var(--color-mark-${color})` } as CSSProperties,
          };
        }}
        slotPropGetter={(slot, resourceId) => {
          const { date: day, time } = clinicClock(slot, timeZone);
          // The week's columns are days: the only offers are the moved card's own dentist's.
          const offers =
            typeof resourceId === 'string'
              ? moveSlots?.get(resourceId)
              : moveSlots?.values().next().value;
          const offer = offers?.get(slot.getTime());
          const minutes = minutesOf(time);
          const closed = isClosedAt(day, minutes, hours);
          const opensHere =
            closed && (minutes === bounds.from || !isClosedAt(day, minutes - slotLength, hours));
          return {
            className: cn(
              closed && 'schedule-closed',
              opensHere && 'schedule-closed-first',
              !closed && slot.getTime() < now().getTime() && 'schedule-past',
              offer && (offer.warnings.length > 0 ? 'schedule-offer-warn' : 'schedule-offer'),
            ),
          };
        }}
      />
    </div>
  );
}
