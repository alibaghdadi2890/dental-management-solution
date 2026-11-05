import type { Appointment } from '@dcm/contracts';
import { type SyntheticEvent, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@/components/ui/tooltip';
import { formatTime } from '@/lib/format';
import { initials } from '@/lib/initials';
import { AppointmentStatusMark } from './appointment-status';
import { ScheduleCardEdit } from './schedule-card-edit';
import type { EventCluster } from './schedule-events';

const minutesLong = (appointment: Appointment) =>
  (Date.parse(appointment.endsAt) - Date.parse(appointment.startsAt)) / 60_000;

/** The card's own click, drag and keys open the popover or move it: the button keeps its own. */
const keepToButton = (event: SyntheticEvent) => {
  event.stopPropagation();
};

function EditButton({ appointment }: { appointment: Appointment }) {
  const { t } = useTranslation('scheduling');
  const edit = useContext(ScheduleCardEdit);
  if (!edit?.canEdit(appointment)) return null;
  return (
    <Tooltip label={t('card.edit')} side="top">
      <button
        type="button"
        className="schedule-card-edit"
        aria-label={t('card.edit')}
        onMouseDown={keepToButton}
        onPointerDown={keepToButton}
        onTouchStart={keepToButton}
        onKeyDown={keepToButton}
        onClick={(event) => {
          event.stopPropagation();
          edit.onEdit(appointment);
        }}
      >
        <svg
          aria-hidden
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        >
          <path d="M11.2 2.6a1.6 1.6 0 0 1 2.2 2.2L5.6 12.6 2.6 13.4l.8-3z" />
        </svg>
      </button>
    </Tooltip>
  );
}

/** A cancelled card (ADR-0075): a strip at the column's end, so the slot beside it stays bookable. */
export function ScheduleStripCard({
  appointment,
  timeZone,
  locale,
}: {
  appointment: Appointment;
  timeZone: string;
  locale: string;
}) {
  const { t } = useTranslation('scheduling');
  const label = t('card.cancelled', {
    name: appointment.patient.fullName,
    time: formatTime(appointment.startsAt, { timeZone, locale }),
  });
  return (
    <Tooltip label={label} side="top">
      <span className="schedule-strip" data-appointment={appointment.id} aria-label={label}>
        <span className="schedule-strip-initials">{initials(appointment.patient.fullName)}</span>
      </span>
    </Tooltip>
  );
}

/**
 * A calendar card (the design's): the dentist is its edge and tint, the status stays quiet unless it
 * needs attention, and the longer it is the more it says. In a week of several dentists it names
 * theirs in initials, because the column no longer does.
 */
export function ScheduleCard({
  appointment,
  timeZone,
  locale,
  week,
  multiDentist,
  lanes,
}: {
  appointment: Appointment;
  timeZone: string;
  locale: string;
  week: boolean;
  /** More than one dentist shares the view. */
  multiDentist: boolean;
  /** How many cards share this one's width. */
  lanes: number;
}) {
  const { t } = useTranslation('scheduling');
  const minutes = minutesLong(appointment);
  const narrow = week || lanes > 1;
  const short = minutes <= 15;
  const time = formatTime(appointment.startsAt, { timeZone, locale });
  const incomplete = appointment.patient.registrationIncomplete ? (
    <span className="schedule-card-flag">{t('status.incomplete')}</span>
  ) : null;
  return (
    <span
      className={narrow ? 'schedule-card schedule-card-narrow' : 'schedule-card'}
      data-appointment={appointment.id}
    >
      <span className="schedule-card-line">
        {short ? <span className="schedule-card-time">{time}</span> : null}
        <span className="schedule-card-name">{appointment.patient.fullName}</span>
        {narrow ? null : incomplete}
        <AppointmentStatusMark appointment={appointment} roomy={!week || lanes === 1} />
      </span>
      {short ? null : (
        <span className="schedule-card-meta">
          <span>{time}</span>
          {week && multiDentist ? (
            <span className="schedule-card-dentist">{initials(appointment.dentistName)}</span>
          ) : null}
          {narrow || !appointment.roomName ? null : <span>{appointment.roomName}</span>}
          {appointment.overridden.length > 0 ? (
            <span title={t('card.overridden')}>{'!'}</span>
          ) : null}
          {narrow ? incomplete : null}
        </span>
      )}
      {(week ? minutes >= 60 && lanes === 1 : minutes >= 45) ? (
        <span className="schedule-card-reason">{appointment.reason}</span>
      ) : null}
      <EditButton appointment={appointment} />
    </span>
  );
}

/** A crowded run in a week column: how many, and who. It opens the day. */
export function ScheduleClusterCard({
  cluster,
  start,
  end,
  timeZone,
  locale,
}: {
  cluster: EventCluster;
  start: Date;
  end: Date;
  timeZone: string;
  locale: string;
}) {
  const { t } = useTranslation('scheduling');
  const clock = { timeZone, locale };
  return (
    <span className="schedule-card schedule-card-narrow">
      <span className="schedule-card-line">
        <span className="schedule-card-name">{t('today.count', { count: cluster.count })}</span>
        {cluster.inClinic > 0 ? (
          <span className="schedule-card-clinic">
            {t('calendar.inClinic', { count: cluster.inClinic })}
          </span>
        ) : null}
      </span>
      <span className="schedule-card-meta">
        <span>
          {formatTime(start, clock)}–{formatTime(end, clock)}
        </span>
      </span>
      <span className="schedule-card-reason">{cluster.firstNames.join(', ')}</span>
    </span>
  );
}
