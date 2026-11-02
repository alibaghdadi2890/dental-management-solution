import { type Appointment, type FollowUp, isActiveAppointment, type Patient } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { formatCalendarDate, formatTime, todayIn } from '@/lib/format';
import { cn } from '@/lib/utils';
import { AppointmentStatusPill } from './appointment-status';
import { clinicClock } from './schedule-time';
import { isOpenFollowUp, patientAppointmentsQuery } from './scheduling-api';
import { moveContext, useFollowUpContext } from './slot-context';
import { SlotFinderDialog } from './slot-finder-dialog';
import { useAppointmentAbilities, useAppointmentActions } from './use-appointment-actions';
import type { TimelineEntry } from './use-schedule-timeline';

const minutesOf = (appointment: Appointment) =>
  (Date.parse(appointment.endsAt) - Date.parse(appointment.startsAt)) / 60_000;

/** The Overview's **Next appointment** card (A18). */
export function NextAppointmentCard({ patient }: { patient: Patient }) {
  const { t, i18n } = useTranslation('scheduling');
  const { data: session } = useSession();
  const canRead = usePermission('appointment:read');
  const canBook = usePermission('appointment:write');
  const appointments = useQuery(patientAppointmentsQuery(patient.id, canRead));
  const abilities = useAppointmentAbilities();
  const { cancel } = useAppointmentActions();
  const [moving, setMoving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  if (!canRead || !session?.tenant) return null;
  const clock = { timeZone: session.tenant.timeZone, locale: i18n.language };
  const today = todayIn(session.tenant.timeZone);
  const next = [...(appointments.data ?? [])]
    .filter(
      (item) =>
        isActiveAppointment(item.status) &&
        (Date.parse(item.endsAt) >= appointments.dataUpdatedAt ||
          item.status === 'checked_in' ||
          item.status === 'in_room'),
    )
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  const can = next ? abilities(next) : null;
  return (
    <Card title={t('record.next')}>
      {next ? (
        <div className="flex flex-col gap-1.5 text-[13px]">
          <p className="m-0 font-medium">
            {formatCalendarDate(next.localDate, i18n.language)} · {formatTime(next.startsAt, clock)}
          </p>
          <p className="m-0 text-ink-secondary">{next.reason}</p>
          <p className="m-0 text-[12.5px] text-ink-muted">
            {[next.dentistName, next.roomName, t('panel.minutes', { count: minutesOf(next) })]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <div className="mt-1 flex items-center gap-2">
            <AppointmentStatusPill appointment={next} />
            {can?.move ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setMoving(true);
                }}
              >
                {t('actions.reschedule')}
              </Button>
            ) : null}
            {can?.cancel && !cancelling ? (
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  setCancelling(true);
                }}
              >
                {t('actions.cancel')}
              </Button>
            ) : null}
          </div>
          {cancelling ? (
            <div className="mt-1 flex items-center gap-2 text-[12.5px]">
              <span className="flex-1">{t('popover.cancelTitle')}</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setCancelling(false);
                }}
              >
                {t('popover.keep')}
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={cancel.isPending}
                onClick={() => {
                  cancel.mutate({ id: next.id, reason: '' });
                  setCancelling(false);
                }}
              >
                {t('popover.cancelConfirm')}
              </Button>
            </div>
          ) : null}
          {moving ? (
            <SlotFinderDialog
              context={moveContext(next, today)}
              onClose={() => {
                setMoving(false);
              }}
            />
          ) : null}
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 text-[13px] text-ink-secondary">
          <span>{t('record.noNext')}</span>
          {canBook && patient.archivedAt === null ? (
            <Link
              to="/schedule"
              search={{ bookFor: patient.id }}
              className="font-medium text-primary hover:underline"
            >
              {t('record.book')}
            </Link>
          ) : null}
        </div>
      )}
    </Card>
  );
}

/** The record's *Schedule* of a follow-up row in Needs attention. */
export function FollowUpScheduleDialog({
  followUp,
  onClose,
}: {
  followUp: FollowUp;
  onClose: () => void;
}) {
  const { data: session } = useSession();
  const contextOf = useFollowUpContext();
  if (!session?.tenant) return null;
  return (
    <SlotFinderDialog
      context={contextOf(followUp, todayIn(session.tenant.timeZone))}
      onClose={onClose}
    />
  );
}

const ROW = 'flex items-center gap-2.5 rounded-xl border border-border bg-surface px-[18px] py-2.5';

/** The Visits & history tab's upcoming appointments, above the timeline (A18). */
export function UpcomingAppointments({ appointments }: { appointments: readonly Appointment[] }) {
  const { i18n } = useTranslation('scheduling');
  const { data: session } = useSession();
  if (!session?.tenant || appointments.length === 0) return null;
  const clock = { timeZone: session.tenant.timeZone, locale: i18n.language };
  return (
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
      {appointments.map((item) => (
        <li key={item.id} className={ROW}>
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">
              {formatCalendarDate(item.localDate, i18n.language)} ·{' '}
              {formatTime(item.startsAt, clock)}
            </span>{' '}
            · {item.reason} · {item.dentistName}
          </span>
          <AppointmentStatusPill appointment={item} />
        </li>
      ))}
    </ul>
  );
}

/** A muted line in the timeline: an appointment that did not end in a visit, or a follow-up. */
export function ScheduleEntryRow({ entry }: { entry: TimelineEntry }) {
  const { t, i18n } = useTranslation('scheduling');
  const { data: session } = useSession();
  if (!session?.tenant) return null;
  const timeZone = session.tenant.timeZone;
  if (entry.kind === 'followUp') {
    const { followUp } = entry;
    const status = followUp.expired
      ? t('record.expired')
      : followUp.status === 'declined'
        ? [t('record.declined'), followUp.declinedReason].filter(Boolean).join(' — ')
        : followUp.status === 'done'
          ? t('record.done')
          : followUp.status === 'booked'
            ? t('record.booked')
            : t('followUp.awaiting');
    return (
      <li className={cn(ROW, 'text-[13px]', !isOpenFollowUp(followUp) && 'text-ink-muted')}>
        <span className="w-[112px] flex-none font-mono text-[12.5px]">
          {formatCalendarDate(entry.date, i18n.language)}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {t('record.followUp', { title: followUp.title })}
        </span>
        <span className="flex-none text-[12px]">{status}</span>
      </li>
    );
  }
  const { appointment } = entry;
  const movedTo = appointment.lineage.movedToStartsAt;
  const note =
    appointment.status === 'cancelled'
      ? (appointment.cancelReason ?? '')
      : appointment.status === 'rescheduled' && movedTo
        ? t('record.movedTo', {
            date: formatCalendarDate(clinicClock(movedTo, timeZone).date, i18n.language),
          })
        : '';
  return (
    <li className={cn(ROW, 'text-[13px] text-ink-muted')}>
      <span className="w-[112px] flex-none font-mono text-[12.5px]">
        {formatCalendarDate(entry.date, i18n.language)}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {formatTime(appointment.startsAt, { timeZone, locale: i18n.language })} ·{' '}
        {appointment.reason}
        {note ? ` — ${note}` : ''}
      </span>
      <AppointmentStatusPill appointment={appointment} />
    </li>
  );
}
