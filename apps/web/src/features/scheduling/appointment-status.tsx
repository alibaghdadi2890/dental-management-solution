import type { Appointment, AppointmentStatus } from '@dcm/contracts';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

const TONE: Readonly<Record<AppointmentStatus, string>> = {
  booked: 'border-warning-border bg-warning-bg text-warning',
  confirmed: 'border-success-border bg-success-bg text-success',
  checked_in: 'border-success-border bg-success-bg text-success',
  in_room: 'border-primary-tint-border bg-primary-tint text-primary',
  completed: 'border-border bg-sunken text-ink-muted',
  cancelled: 'border-border bg-sunken text-ink-muted',
  no_show: 'border-danger-border bg-danger-bg text-danger',
  rescheduled: 'border-border bg-sunken text-ink-muted',
};

function labelOf(
  appointment: Pick<Appointment, 'status' | 'unresolved'>,
  t: ReturnType<typeof useTranslation<'scheduling'>>['t'],
): string {
  return appointment.unresolved ? t('status.unresolved') : t(`status.${appointment.status}`);
}

/** The status as the design words it; *Unresolved* wins while it is derived (never stored). */
export function AppointmentStatusPill({
  appointment,
}: {
  appointment: Pick<Appointment, 'status' | 'unresolved'>;
}) {
  const { t } = useTranslation('scheduling');
  const tone = appointment.unresolved
    ? 'border-warning-border bg-warning-bg text-warning'
    : TONE[appointment.status];
  return (
    <span
      className={cn(
        'inline-flex h-5 flex-none items-center rounded-[4px] border px-1.5 text-[11px] font-medium whitespace-nowrap',
        tone,
      )}
    >
      {labelOf(appointment, t)}
    </span>
  );
}

/** Statuses a card names: the ones somebody has to act on or read. */
const NAMED: readonly AppointmentStatus[] = ['checked_in', 'in_room', 'no_show', 'cancelled'];

const SYMBOL: Partial<Readonly<Record<AppointmentStatus, string>>> = {
  checked_in: '✓',
  in_room: '•',
  no_show: '✕',
  cancelled: '✕',
};

/**
 * A card's status (the design's): quiet unless it needs attention. Plain confirmed and finished say
 * nothing, unconfirmed is a small ring, and the rest are a pill where there is room, a symbol where
 * there is not. The full word is always the mark's title.
 */
export function AppointmentStatusMark({
  appointment,
  roomy,
}: {
  appointment: Pick<Appointment, 'status' | 'unresolved'>;
  /** The card has the width for words. */
  roomy: boolean;
}) {
  const { t } = useTranslation('scheduling');
  const label = labelOf(appointment, t);
  if (appointment.unresolved || NAMED.includes(appointment.status)) {
    if (roomy) {
      return (
        <span className="schedule-status" title={label}>
          <AppointmentStatusPill appointment={appointment} />
        </span>
      );
    }
    return (
      <span
        className={`schedule-status-symbol schedule-status-${appointment.unresolved ? 'unresolved' : appointment.status}`}
        title={label}
        aria-label={label}
      >
        {appointment.unresolved ? '!' : SYMBOL[appointment.status]}
      </span>
    );
  }
  if (appointment.status === 'booked') {
    return <span className="schedule-status-ring" title={label} aria-label={label} />;
  }
  return null;
}
