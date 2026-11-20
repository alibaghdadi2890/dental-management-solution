import type { Appointment, FollowUp } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BoardIcon } from '@/components/board/board-icons';
import { BoardMore } from '@/components/board/board-more';
import { CARD_ACTION, CARD_LINK, HUE_BUTTON, useRowArrival } from '@/components/board/board-kit';
import { TodayCard } from '@/components/board/today-card';
import { useNow } from '@/components/board/use-now';
import { Button } from '@/components/ui/button';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { StartVisitPopover } from '@/features/clinical/start-visit-popover';
import { AppointmentLabMark } from '@/features/labs/lab-order-label';
import { usePatientNavigation } from '@/features/patients/patient-navigation';
import { formatCalendarDate, formatTime, todayIn } from '@/lib/format';
import { cn } from '@/lib/utils';
import { AppointmentStatusPill } from './appointment-status';
import { DeclineForm } from './checkout-next-step';
import { todayBoardQuery, worklistQuery } from './scheduling-api';
import { useFollowUpContext } from './slot-context';
import { SlotFinderDialog } from './slot-finder-dialog';
import { TodayTimeline } from './today-timeline';
import { waitingTone } from './today-timeline-layout';
import { useAppointmentAbilities, useAppointmentActions } from './use-appointment-actions';
import { useFollowUpOutcomes } from './use-follow-up-outcomes';
import { followUpDraft } from './waitlist/follow-up-draft';
import { useWaitlistPanels } from './waitlist/waitlist-context';

/** A long card's first rows; the rest behind _Show all_. */
const ROWS = 5;

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
      <Button size="sm" variant="primary" className={HUE_BUTTON}>
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
  meta: ReactNode;
  action: ReactNode;
}) {
  const { t } = useTranslation('scheduling');
  const arrival = useRowArrival();
  return (
    <li
      className={cn(
        'flex items-center gap-3 border-t border-row-divider px-3.5 py-2.5 first:border-t-0',
        arrival,
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="m-0 flex items-center gap-1.5 text-[13px] font-medium">
          <span className="truncate">{appointment.patient.fullName}</span>
          <AppointmentLabMark appointmentId={appointment.id} />
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

const minutesSince = (iso: string | null, now: number) =>
  iso ? Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000)) : 0;

const TONE = { normal: 'text-ink', warning: 'text-warning', danger: 'text-danger' } as const;

/**
 * The day's appointments for the Today board's scheduling cards (A17), split as the cards need
 * them against the board's one clock: who is waiting (longest first), what is still to come.
 * Null while unread or without `appointment:read`.
 */
function useDay(branchId: string) {
  const { i18n } = useTranslation();
  const { data: session } = useSession();
  const canRead = usePermission('appointment:read');
  const board = useQuery(todayBoardQuery(branchId, canRead));
  const now = useNow();
  if (!canRead || !board.data || !session?.tenant) return null;
  const { appointments } = board.data;
  const waiting = appointments
    .filter((item) => item.status === 'checked_in')
    .sort((a, b) => Date.parse(a.checkedInAt ?? '') - Date.parse(b.checkedInAt ?? ''));
  const comingUp = appointments.filter(
    (item) =>
      (item.status === 'booked' || item.status === 'confirmed') && Date.parse(item.startsAt) >= now,
  );
  return {
    board: board.data,
    waiting,
    comingUp,
    now,
    timeZone: session.tenant.timeZone,
    clock: { timeZone: session.tenant.timeZone, locale: i18n.language },
  };
}

/** **Today's schedule**: the day as a timeline (T7), its counts, _+ New appointment_. */
export function TodayScheduleCard({ branchId }: { branchId: string }) {
  const { t } = useTranslation('scheduling');
  const canBook = usePermission('appointment:write');
  const day = useDay(branchId);
  if (!day || day.board.appointments.length === 0) return null;
  const { appointments, unresolvedCount, unconfirmedCount } = day.board;
  return (
    <TodayCard
      id="schedule"
      hue="indigo"
      icon={<BoardIcon name="schedule" />}
      title={t('today.schedule')}
      regionLabel={t('today.schedule')}
      link={(label) => (
        <Link to="/schedule" className={CARD_LINK}>
          {label}
        </Link>
      )}
      count={appointments.length}
      extra={
        <>
          {unconfirmedCount > 0 ? (
            <span className="text-[11.5px] font-medium text-ink-secondary">
              {t('today.unconfirmed', { count: unconfirmedCount })}
            </span>
          ) : null}
          {unresolvedCount > 0 ? (
            <Link
              to="/schedule"
              search={{ unresolved: true }}
              className="rounded-[4px] border border-warning-border bg-warning-bg px-1.5 py-0.5 text-[11px] font-medium text-warning hover:underline"
            >
              {t('today.unresolved', { count: unresolvedCount })}
            </Link>
          ) : null}
        </>
      }
      action={
        canBook ? (
          <Link to="/schedule" search={{ book: true }} className={CARD_ACTION}>
            {t('today.newAppointment')}
          </Link>
        ) : null
      }
      span={2}
    >
      <TodayTimeline appointments={appointments} timeZone={day.timeZone} />
    </TodayCard>
  );
}

/** **Next appointment**: its time large, a countdown, and _Check in_. */
export function NextUpCard({ branchId }: { branchId: string }) {
  const { t } = useTranslation('scheduling');
  const day = useDay(branchId);
  const next = day?.comingUp[0];
  if (!day || !next) return null;
  const minutes = Math.max(0, Math.ceil((Date.parse(next.startsAt) - day.now) / 60_000));
  return (
    <TodayCard
      id="next"
      hue="indigo"
      icon={<BoardIcon name="next" />}
      title={t('today.next')}
      span={1}
    >
      <p className="m-0 flex items-baseline gap-2 px-3.5 pt-3">
        <span
          dir="ltr"
          className="font-mono text-[26px] leading-none font-bold text-(--hue-ink) tabular-nums"
        >
          {formatTime(next.startsAt, day.clock)}
        </span>
        <span className="text-[12px] font-medium text-ink-secondary">
          {minutes === 0 ? t('today.startsNow') : t('today.inMinutes', { count: minutes })}
        </span>
      </p>
      <ul className="m-0 list-none p-0">
        <Row
          appointment={next}
          meta={[next.dentistName, next.reason].filter(Boolean).join(' · ')}
          action={<ComingUpAction appointment={next} />}
        />
      </ul>
    </TodayCard>
  );
}

/** **Waiting**: checked in, longest first; minutes tick and turn warning, then danger. */
export function WaitingCard({ branchId }: { branchId: string }) {
  const { t } = useTranslation('scheduling');
  const canVisit = usePermission('visit:start');
  const day = useDay(branchId);
  const [all, setAll] = useState(false);
  if (!day || day.waiting.length === 0) return null;
  const rows = all ? day.waiting : day.waiting.slice(0, ROWS);
  return (
    <TodayCard
      id="waiting"
      hue="amber"
      icon={<BoardIcon name="waiting" />}
      title={t('today.waiting')}
      count={day.waiting.length}
      span={1}
    >
      <ul className="m-0 list-none p-0">
        {rows.map((item) => {
          const minutes = minutesSince(item.checkedInAt, day.now);
          const tone = waitingTone(minutes);
          return (
            <Row
              key={item.id}
              appointment={item}
              meta={
                <>
                  <span data-tone={tone} className={cn('font-semibold tabular-nums', TONE[tone])}>
                    {t('today.waitingFor', { count: minutes })}
                  </span>
                  {` · ${[item.dentistName, item.roomName].filter(Boolean).join(' · ')}`}
                </>
              }
              action={
                canVisit ? <StartButton appointment={item} label={t('actions.startVisit')} /> : null
              }
            />
          );
        })}
      </ul>
      {!all && day.waiting.length > ROWS ? (
        <BoardMore
          total={day.waiting.length}
          onShowAll={() => {
            setAll(true);
          }}
        />
      ) : null}
    </TodayCard>
  );
}

/** **Coming up**: what is still booked after the next one, with _Check in_. */
export function ComingUpCard({ branchId }: { branchId: string }) {
  const { t } = useTranslation('scheduling');
  const day = useDay(branchId);
  const [all, setAll] = useState(false);
  const later = day?.comingUp.slice(1) ?? [];
  if (!day || later.length === 0) return null;
  const rows = all ? later : later.slice(0, ROWS);
  return (
    <TodayCard
      id="coming-up"
      hue="indigo"
      icon={<BoardIcon name="list" />}
      title={t('today.comingUp')}
      count={later.length}
      span={1}
    >
      <ul className="m-0 list-none p-0">
        {rows.map((item) => (
          <Row
            key={item.id}
            appointment={item}
            meta={`${formatTime(item.startsAt, day.clock)} · ${item.dentistName} · ${item.reason}`}
            action={<ComingUpAction appointment={item} />}
          />
        ))}
      </ul>
      {!all && later.length > ROWS ? (
        <BoardMore
          total={later.length}
          onShowAll={() => {
            setAll(true);
          }}
        />
      ) : null}
    </TodayCard>
  );
}

function WorklistRow({ followUp, today }: { followUp: FollowUp; today: string }) {
  const { t, i18n } = useTranslation('scheduling');
  const contextOf = useFollowUpContext();
  const { openPatient } = usePatientNavigation();
  const { willCall, decline } = useFollowUpOutcomes();
  const { openEntry } = useWaitlistPanels();
  const [finding, setFinding] = useState(false);
  const [declining, setDeclining] = useState(false);
  const arrival = useRowArrival();
  const overdue = followUp.overdueDays > 0;
  return (
    <li className={cn('border-t border-row-divider px-3.5 py-2.5 first:border-t-0', arrival)}>
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
            {followUp.onWaitlist ? (
              <span className="rounded-[4px] border border-primary-tint-border px-1 text-primary">
                {t('waitlist.onTheWaitlist')}
              </span>
            ) : null}
          </p>
        </div>
        <Button
          size="sm"
          variant="primary"
          className={HUE_BUTTON}
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
            {openEntry && !followUp.onWaitlist ? (
              <MenuItem
                onSelect={() => {
                  openEntry(followUpDraft(followUp));
                }}
              >
                {t('waitlist.addTitle')}
              </MenuItem>
            ) : null}
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
export function FollowUpsCard({ branchId }: { branchId: string }) {
  const { t } = useTranslation('scheduling');
  const { data: session } = useSession();
  const canWork = usePermission('appointment:write_all');
  const worklist = useQuery(worklistQuery(branchId, canWork));
  const [all, setAll] = useState(false);
  if (!canWork || !worklist.data || worklist.data.length === 0 || !session?.tenant) return null;
  const rows = all ? worklist.data : worklist.data.slice(0, ROWS);
  const today = todayIn(session.tenant.timeZone);
  return (
    <TodayCard
      id="follow-ups"
      hue="violet"
      icon={<BoardIcon name="followUp" />}
      title={t('followUp.title')}
      count={worklist.data.length}
      span={1}
    >
      <ul className="m-0 list-none p-0">
        {rows.map((followUp) => (
          <WorklistRow key={followUp.id} followUp={followUp} today={today} />
        ))}
      </ul>
      {!all && worklist.data.length > ROWS ? (
        <BoardMore
          total={worklist.data.length}
          onShowAll={() => {
            setAll(true);
          }}
        />
      ) : null}
    </TodayCard>
  );
}
