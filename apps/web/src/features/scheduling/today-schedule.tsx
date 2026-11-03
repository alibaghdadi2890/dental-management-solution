import type { Appointment, FollowUp } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { StartVisitPopover } from '@/features/clinical/start-visit-popover';
import { usePatientNavigation } from '@/features/patients/patient-navigation';
import { formatCalendarDate, formatTime, todayIn } from '@/lib/format';
import { cn } from '@/lib/utils';
import { AppointmentStatusPill } from './appointment-status';
import { DeclineForm } from './checkout-next-step';
import { todayBoardQuery, worklistQuery } from './scheduling-api';
import { useFollowUpContext } from './slot-context';
import { SlotFinderDialog } from './slot-finder-dialog';
import { useAppointmentAbilities, useAppointmentActions } from './use-appointment-actions';
import { useFollowUpOutcomes } from './use-follow-up-outcomes';

const COMING_UP_ROWS = 5;
const WORKLIST_ROWS = 5;

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number | undefined;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="mb-6">
      <h2
        id={headingId}
        className="mb-2.5 text-[11.5px] leading-none font-medium tracking-[.05em] text-ink-muted uppercase [&:lang(ar)]:tracking-normal"
      >
        {count === undefined ? title : `${title} · ${String(count)}`}
      </h2>
      <div className="overflow-hidden rounded-xl border border-border bg-surface">{children}</div>
    </section>
  );
}

function StartButton({ appointment, label }: { appointment: Appointment; label: string }) {
  return (
    <StartVisitPopover
      patientId={appointment.patient.id}
      preset={{
        ...(appointment.visitType ? { type: appointment.visitType } : {}),
        planIds: appointment.planIds,
        appointmentId: appointment.id,
        dentistId: appointment.dentistId,
        roomId: appointment.roomId,
        reason: appointment.reason,
      }}
    >
      <Button size="sm" variant="primary">
        {label}
      </Button>
    </StartVisitPopover>
  );
}

function RowMenu({ appointment }: { appointment: Appointment }) {
  const { t } = useTranslation('scheduling');
  const abilities = useAppointmentAbilities()(appointment);
  const actions = useAppointmentActions();
  const { openPatient } = usePatientNavigation();
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button size="sm" variant="secondary" aria-label={t('today.more')}>
          {'⋯'}
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        {abilities.undoCheckIn ? (
          <MenuItem
            onSelect={() => {
              actions.undoCheckIn.mutate(appointment.id);
            }}
          >
            {t('actions.undoCheckIn')}
          </MenuItem>
        ) : null}
        {abilities.noShow ? (
          <MenuItem
            onSelect={() => {
              actions.noShow.mutate(appointment.id);
            }}
          >
            {t('actions.noShow')}
          </MenuItem>
        ) : null}
        <MenuItem
          onSelect={() => {
            openPatient(appointment.patient.id);
          }}
        >
          {t('actions.patientRecord')}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function Row({
  appointment,
  meta,
  action,
}: {
  appointment: Appointment;
  meta: string;
  action: ReactNode;
}) {
  const { t } = useTranslation('scheduling');
  return (
    <li className="flex items-center gap-3 border-b border-inner-divider px-[18px] py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="m-0 flex items-center gap-1.5 text-[13px] font-medium">
          <span className="truncate">{appointment.patient.fullName}</span>
          {appointment.patient.registrationIncomplete ? (
            <span className="flex-none rounded-[4px] border border-warning-border bg-warning-bg px-1 text-[10.5px] font-medium text-warning">
              {t('status.incomplete')}
            </span>
          ) : null}
        </p>
        <p className="m-0 mt-0.5 truncate text-[12px] text-ink-muted">{meta}</p>
      </div>
      {action}
      <RowMenu appointment={appointment} />
    </li>
  );
}

function ComingUpAction({ appointment }: { appointment: Appointment }) {
  const { t } = useTranslation('scheduling');
  const abilities = useAppointmentAbilities()(appointment);
  const actions = useAppointmentActions();
  if (abilities.checkIn) {
    return (
      <Button
        size="sm"
        variant="secondary"
        disabled={actions.checkIn.isPending}
        onClick={() => {
          actions.checkIn.mutate({ id: appointment.id });
        }}
      >
        {t('actions.checkIn')}
      </Button>
    );
  }
  return <AppointmentStatusPill appointment={appointment} />;
}

/** Waiting's minutes, at the board's own 30-second beat. */
const minutesSince = (iso: string | null, now: number) =>
  iso ? Math.max(0, Math.round((now - Date.parse(iso)) / 60_000)) : 0;

/**
 * The Today board's schedule lanes (A17): the day at a glance, the next appointment, who is waiting
 * and who is coming up. All of it derives from `GET /scheduling/today`.
 */
export function TodaySchedule({ branchId }: { branchId: string }) {
  const { t, i18n } = useTranslation('scheduling');
  const { data: session } = useSession();
  const canRead = usePermission('appointment:read');
  const canVisit = usePermission('visit:start');
  const canBook = usePermission('appointment:write');
  const board = useQuery(todayBoardQuery(branchId, canRead));
  const [showAll, setShowAll] = useState(false);
  if (!canRead || !board.data || !session?.tenant) return null;
  const clock = { timeZone: session.tenant.timeZone, locale: i18n.language };
  const { appointments, unresolvedCount, unconfirmedCount } = board.data;
  const now = board.dataUpdatedAt;
  const waiting = appointments
    .filter((item) => item.status === 'checked_in')
    .sort((a, b) => Date.parse(a.checkedInAt ?? '') - Date.parse(b.checkedInAt ?? ''));
  const comingUp = appointments.filter(
    (item) =>
      (item.status === 'booked' || item.status === 'confirmed') && Date.parse(item.startsAt) >= now,
  );
  const next = comingUp[0];
  const shown = showAll ? comingUp : comingUp.slice(0, COMING_UP_ROWS);
  const dentists = [...new Set(appointments.map((item) => item.dentistName))];

  return (
    <>
      <Section title={t('today.schedule')}>
        <div className="flex flex-wrap items-center gap-3 border-b border-inner-divider px-[18px] py-2.5 text-[12.5px]">
          <span className="text-ink-secondary">
            {t('today.count', { count: appointments.length })}
            {unconfirmedCount > 0
              ? ` · ${t('today.unconfirmed', { count: unconfirmedCount })}`
              : ''}
          </span>
          {unresolvedCount > 0 ? (
            <Link
              to="/schedule"
              search={{ unresolved: true }}
              className="rounded-[4px] border border-warning-border bg-warning-bg px-1.5 py-0.5 text-[11.5px] font-medium text-warning"
            >
              {t('today.unresolved', { count: unresolvedCount })}
            </Link>
          ) : null}
          <span className="ms-auto flex items-center gap-3">
            <Link to="/schedule" className="font-medium text-primary hover:underline">
              {t('today.viewCalendar')}
            </Link>
            {canBook ? (
              <Link
                to="/schedule"
                search={{ book: true }}
                className="font-medium text-primary hover:underline"
              >
                {t('today.newAppointment')}
              </Link>
            ) : null}
          </span>
        </div>
        {dentists.length > 0 ? (
          <ul className="m-0 list-none p-0">
            {dentists.map((dentist) => (
              <li
                key={dentist}
                className="flex items-center gap-3 border-b border-inner-divider px-[18px] py-2 last:border-b-0"
              >
                <span className="w-[140px] flex-none truncate text-[12.5px] font-medium">
                  {dentist}
                </span>
                <span className="flex min-w-0 flex-wrap gap-1">
                  {appointments
                    .filter((item) => item.dentistName === dentist)
                    .map((item) => (
                      <Link
                        key={item.id}
                        to="/schedule"
                        search={{ appointment: item.id }}
                        title={`${item.patient.fullName} · ${item.reason}`}
                        className={cn(
                          'rounded-[4px] border border-border px-1.5 py-0.5 font-mono text-[11px] hover:border-primary',
                          item.status === 'cancelled' && 'text-ink-muted line-through',
                          (item.status === 'completed' || item.status === 'no_show') &&
                            'text-ink-muted',
                          item.status === 'in_room' && 'border-primary-tint-border bg-primary-tint',
                        )}
                      >
                        {formatTime(item.startsAt, clock)}
                      </Link>
                    ))}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>
      {next ? (
        <Section title={t('today.next')}>
          <ul className="m-0 list-none p-0">
            <Row
              appointment={next}
              meta={`${formatTime(next.startsAt, clock)} · ${t('today.inMinutes', {
                count: Math.max(0, Math.round((Date.parse(next.startsAt) - now) / 60_000)),
              })} · ${next.dentistName}`}
              action={<ComingUpAction appointment={next} />}
            />
          </ul>
        </Section>
      ) : null}
      {waiting.length > 0 ? (
        <Section title={t('today.waiting')} count={waiting.length}>
          <ul className="m-0 list-none p-0">
            {waiting.map((item) => (
              <Row
                key={item.id}
                appointment={item}
                meta={`${t('today.waitingFor', { count: minutesSince(item.checkedInAt, now) })} · ${item.dentistName}${
                  item.roomName ? ` · ${item.roomName}` : ''
                }`}
                action={
                  canVisit ? (
                    <StartButton appointment={item} label={t('actions.startVisit')} />
                  ) : null
                }
              />
            ))}
          </ul>
        </Section>
      ) : null}
      {comingUp.length > 1 ? (
        <Section title={t('today.comingUp')} count={comingUp.length - 1}>
          <ul className="m-0 list-none p-0">
            {shown.slice(1).map((item) => (
              <Row
                key={item.id}
                appointment={item}
                meta={`${formatTime(item.startsAt, clock)} · ${item.dentistName} · ${item.reason}`}
                action={<ComingUpAction appointment={item} />}
              />
            ))}
          </ul>
          {!showAll && comingUp.length > COMING_UP_ROWS ? (
            <Button
              size="sm"
              variant="ghost"
              className="m-1"
              onClick={() => {
                setShowAll(true);
              }}
            >
              {t('today.more_n', { count: comingUp.length - COMING_UP_ROWS })}
            </Button>
          ) : null}
        </Section>
      ) : null}
    </>
  );
}

function WorklistRow({ followUp, today }: { followUp: FollowUp; today: string }) {
  const { t, i18n } = useTranslation('scheduling');
  const contextOf = useFollowUpContext();
  const { openPatient } = usePatientNavigation();
  const { willCall, decline } = useFollowUpOutcomes();
  const [finding, setFinding] = useState(false);
  const [declining, setDeclining] = useState(false);
  const overdue = followUp.overdueDays > 0;
  return (
    <li className="border-b border-inner-divider px-[18px] py-2.5 last:border-b-0">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="m-0 flex items-center gap-1.5 text-[13px]">
            {followUp.priority === 'urgent' ? (
              <span
                aria-label={t('followUp.urgent')}
                title={t('followUp.urgent')}
                className="size-[7px] flex-none rounded-full bg-danger"
              />
            ) : null}
            <span className="truncate font-medium">{followUp.patientName}</span>
            <span className="truncate text-ink-secondary">
              — {followUp.title} — {t('panel.minutes', { count: followUp.durationMin })}
            </span>
          </p>
          <p className="m-0 mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-ink-muted">
            <span>{t(`timings.${followUp.timing}`)}</span>
            {overdue ? (
              <span className="font-medium text-warning">
                {t('followUp.overdue', { count: followUp.overdueDays })}
              </span>
            ) : followUp.dueOn ? (
              <span>
                {t('followUp.due', { date: formatCalendarDate(followUp.dueOn, i18n.language) })}
              </span>
            ) : null}
            {followUp.willCallAt ? (
              <span className="rounded-[4px] border border-border px-1">
                {t('followUp.willCall')}
              </span>
            ) : null}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setFinding(true);
          }}
        >
          {t('followUp.schedule')}
        </Button>
        <Menu>
          <MenuTrigger asChild>
            <Button size="sm" variant="secondary" aria-label={t('today.more')}>
              {'⋯'}
            </Button>
          </MenuTrigger>
          <MenuContent align="end">
            {followUp.willCallAt ? null : (
              <MenuItem
                onSelect={() => {
                  willCall.mutate(followUp.id);
                }}
              >
                {t('followUp.willCall')}
              </MenuItem>
            )}
            <MenuItem
              onSelect={() => {
                setDeclining(true);
              }}
            >
              {t('followUp.markDeclined')}
            </MenuItem>
            <MenuItem
              onSelect={() => {
                openPatient(followUp.patientId);
              }}
            >
              {t('actions.patientRecord')}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      {declining ? (
        <div className="mt-2 max-w-[320px]">
          <DeclineForm
            onDecline={(reason) => {
              decline.mutate({ id: followUp.id, reason });
              setDeclining(false);
            }}
          />
        </div>
      ) : null}
      {finding ? (
        <SlotFinderDialog
          context={contextOf(followUp, today)}
          onClose={() => {
            setFinding(false);
          }}
        />
      ) : null}
    </li>
  );
}

/** **Follow-ups to schedule** (A16): whoever manages every dentist's appointments. */
export function FollowUpWorklist({ branchId }: { branchId: string }) {
  const { t } = useTranslation('scheduling');
  const { data: session } = useSession();
  const canWork = usePermission('appointment:write_all');
  const worklist = useQuery(worklistQuery(branchId, canWork));
  const [all, setAll] = useState(false);
  if (!canWork || !worklist.data || worklist.data.length === 0 || !session?.tenant) return null;
  const rows = all ? worklist.data : worklist.data.slice(0, WORKLIST_ROWS);
  const today = todayIn(session.tenant.timeZone);
  return (
    <Section title={t('followUp.title')} count={worklist.data.length}>
      <ul className="m-0 list-none p-0">
        {rows.map((followUp) => (
          <WorklistRow key={followUp.id} followUp={followUp} today={today} />
        ))}
      </ul>
      {!all && worklist.data.length > WORKLIST_ROWS ? (
        <Button
          size="sm"
          variant="ghost"
          className="m-1"
          onClick={() => {
            setAll(true);
          }}
        >
          {t('followUp.viewAll', { count: worklist.data.length })}
        </Button>
      ) : null}
    </Section>
  );
}
