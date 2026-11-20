import type { Appointment, AppointmentStatus } from '@dcm/contracts';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useNow } from '@/components/board/use-now';
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { timelineLayout } from './today-timeline-layout';

const TRACK_PX = 22;
const LANE_GAP_PX = 6;
/** Past ten hours, every other hour is labelled. */
const DENSE_HOURS = 10;

const BLOCK: Record<AppointmentStatus, string> = {
  booked: 'border-dashed border-primary-tint-strong bg-surface text-primary',
  confirmed: 'border-primary-tint-strong bg-primary-tint text-primary-deep',
  checked_in: 'border-warning-dot bg-warning-bg text-warning',
  in_room: 'border-primary bg-primary text-white',
  completed: 'border-subtle bg-subtle text-ink-muted',
  no_show: 'border-danger-border bg-danger-bg text-danger',
  cancelled: 'border-border bg-faint text-ink-disabled line-through',
  rescheduled: 'border-border bg-faint text-ink-disabled line-through',
};

/** "Maya Ghanem" → "Maya G.": what fits in a block; the tooltip has the rest. */
const shortName = (fullName: string) => {
  const [first, ...rest] = fullName.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first ?? ''} ${last.charAt(0)}.` : (first ?? '');
};

/**
 * The day at a glance (spec T7): one lane per dentist, each appointment a block from its start to
 * its end in its status's colour, and a line at now. Read-only (ADR-0108): hover or focus says
 * who and why, a click opens the appointment on the calendar. Runs with the reading direction.
 */
export function TodayTimeline({
  appointments,
  timeZone,
}: {
  appointments: readonly Appointment[];
  timeZone: string;
}) {
  const { t, i18n } = useTranslation('scheduling');
  const now = useNow();
  const layout = timelineLayout(appointments, now, timeZone);
  if (!layout) return null;
  const clock = { timeZone, locale: i18n.language };
  const step = layout.ticks.length - 1 > DENSE_HOURS ? 2 : 1;
  const laneHeight = (tracks: number) => tracks * TRACK_PX + (tracks - 1) * 2 + LANE_GAP_PX;
  const pct = (fraction: number) => `${String(fraction * 100)}%`;

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex px-3.5 pt-2 pb-3">
        <div className="w-[min(120px,28%)] flex-none pe-3">
          <div className="h-4" />
          {layout.lanes.map((lane) => (
            <div
              key={lane.dentistName}
              style={{ height: laneHeight(lane.tracks) }}
              className="flex items-center truncate border-t border-row-divider text-[12px] font-semibold"
            >
              <span className="truncate">{lane.dentistName}</span>
            </div>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="relative h-4" aria-hidden>
            {layout.ticks.map((tick, index) =>
              index % step === 0 ? (
                <span
                  key={tick.at}
                  style={{ insetInlineStart: pct(tick.left) }}
                  className={cn(
                    'absolute top-0 font-mono text-[10px] leading-none text-ink-muted tabular-nums',
                    // The ends stay inside the strip; the hours between sit centred on their line.
                    index === 0
                      ? ''
                      : index === layout.ticks.length - 1
                        ? '-translate-x-full rtl:translate-x-full'
                        : '-translate-x-1/2 rtl:translate-x-1/2',
                  )}
                >
                  <span dir="ltr">{formatTime(new Date(tick.at), clock)}</span>
                </span>
              ) : null,
            )}
          </div>
          {layout.ticks.map((tick) => (
            <span
              key={tick.at}
              aria-hidden
              style={{ insetInlineStart: pct(tick.left) }}
              className="absolute top-4 bottom-0 w-px bg-chart-grid"
            />
          ))}
          <ul className="m-0 list-none p-0">
            {layout.lanes.map((lane) => (
              <li
                key={lane.dentistName}
                aria-label={lane.dentistName}
                style={{ height: laneHeight(lane.tracks) }}
                className="relative border-t border-row-divider"
              >
                {lane.blocks.map(({ item, left, width, track }) => {
                  const time = `${formatTime(item.startsAt, clock)}–${formatTime(item.endsAt, clock)}`;
                  const about = [
                    time,
                    item.patient.fullName,
                    item.reason,
                    t(`status.${item.status}`),
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <Tooltip key={item.id} label={about} side="top">
                      <Link
                        to="/schedule"
                        search={{ appointment: item.id }}
                        aria-label={about}
                        data-status={item.status}
                        style={{
                          insetInlineStart: pct(left),
                          width: `max(${pct(width)}, 6px)`,
                          top: LANE_GAP_PX / 2 + track * (TRACK_PX + 2),
                          height: TRACK_PX,
                        }}
                        className={cn(
                          'absolute truncate rounded-[5px] border px-1.5 text-[10.5px] leading-[20px] font-medium hover:z-10 hover:outline-2 hover:outline-ink focus-visible:z-10',
                          BLOCK[item.status],
                        )}
                      >
                        <bdi>{shortName(item.patient.fullName)}</bdi>
                      </Link>
                    </Tooltip>
                  );
                })}
              </li>
            ))}
          </ul>
          {layout.now === null ? null : (
            <span
              aria-hidden
              style={{ insetInlineStart: pct(layout.now) }}
              className="pointer-events-none absolute top-3 bottom-0 z-20 w-0.5 -translate-x-1/2 rounded-full bg-danger rtl:translate-x-1/2"
            />
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
