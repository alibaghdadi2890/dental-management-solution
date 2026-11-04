import type { Appointment, ScheduleResources } from '@dcm/contracts';
import { useQuery } from '@tanstack/react-query';
import { Popover } from 'radix-ui';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Select, TextInput } from '@/components/ui/field';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { balanceQuery } from '@/features/billing/billing-api';
import { formatCalendarDate, formatTime } from '@/lib/format';
import { AppointmentStatusPill } from './appointment-status';
import { clinicClock } from './schedule-time';
import { POPOVER_EDGE, POPOVER_GAP, placePopover } from './popover-placement';
import { useAppointmentAbilities, useAppointmentActions } from './use-appointment-actions';

function OwesLine({ patientId }: { patientId: string }) {
  const { t } = useTranslation('scheduling');
  const canSee = usePermission('payment:read');
  const balance = useQuery({ ...balanceQuery(patientId), enabled: canSee });
  const owes = balance.data?.balances.some((item) => Number(item.amount) > 0) ?? false;
  if (!canSee || !owes) return null;
  return <span className="text-warning">{t('popover.owes')}</span>;
}

/** Inline, in the popover, per the design (A12). */
function CancelConfirm({ appointment, onDone }: { appointment: Appointment; onDone: () => void }) {
  const { t } = useTranslation('scheduling');
  const [reason, setReason] = useState('');
  const { cancel } = useAppointmentActions();
  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="m-0 text-[13px] font-semibold">{t('popover.cancelTitle')}</p>
      {appointment.followUp ? (
        <p className="m-0 mt-1 text-[12px] text-ink-secondary">{t('popover.cancelFollowUp')}</p>
      ) : null}
      <TextInput
        className="mt-2"
        value={reason}
        maxLength={120}
        placeholder={t('popover.cancelReason')}
        aria-label={t('popover.cancelReason')}
        onChange={(event) => {
          setReason(event.target.value);
        }}
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onDone}>
          {t('popover.keep')}
        </Button>
        <Button
          size="sm"
          variant="danger"
          disabled={cancel.isPending}
          onClick={() => {
            cancel.mutate({ id: appointment.id, reason }, { onSuccess: onDone });
          }}
        >
          {t('popover.cancelConfirm')}
        </Button>
      </div>
    </div>
  );
}

function RoomLine({
  appointment,
  rooms,
  editable,
}: {
  appointment: Appointment;
  rooms: ScheduleResources['rooms'];
  editable: boolean;
}) {
  const { t } = useTranslation('scheduling');
  const { room } = useAppointmentActions();
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <Select
        aria-label={t('popover.room')}
        value={appointment.roomId ?? ''}
        onChange={(event) => {
          setEditing(false);
          room.mutate({ id: appointment.id, roomId: event.target.value || null });
        }}
      >
        <option value="">{t('popover.noRoom')}</option>
        {rooms.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </Select>
    );
  }
  return (
    <span>
      {appointment.dentistName} · {appointment.roomName ?? t('popover.noRoom')}
      {editable ? (
        <button
          type="button"
          className="ms-1.5 cursor-pointer border-none bg-transparent p-0 text-primary hover:underline"
          onClick={() => {
            setEditing(true);
          }}
        >
          {t('popover.change')}
        </button>
      ) : null}
    </span>
  );
}

/** Everything the popover says and does; the page owns where it is anchored. */
export function AppointmentDetails({
  appointment,
  rooms,
  onReschedule,
  onOpenPatient,
  onStartVisit,
  onCompleteRegistration,
  onClose,
}: {
  appointment: Appointment;
  rooms: ScheduleResources['rooms'];
  onReschedule: () => void;
  onOpenPatient: () => void;
  /** The page opens the Start visit panel. */
  onStartVisit: () => void;
  onCompleteRegistration: () => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation('scheduling');
  const { data: session } = useSession();
  const [cancelling, setCancelling] = useState(false);
  const [room, setRoom] = useState('');
  const abilities = useAppointmentAbilities()(appointment);
  const actions = useAppointmentActions();
  if (!session?.tenant) return null;
  const clock = { timeZone: session.tenant.timeZone, locale: i18n.language };
  const when = `${formatCalendarDate(appointment.localDate, i18n.language)} · ${formatTime(
    appointment.startsAt,
    clock,
  )}–${formatTime(appointment.endsAt, clock)}`;
  const { followUp, lineage } = appointment;
  const needsRoom = abilities.checkIn && appointment.roomId === null && rooms.length > 0;

  return (
    <>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="m-0 flex flex-wrap items-center gap-1.5 text-[14px] font-semibold">
            {appointment.patient.fullName}
            {appointment.patient.registrationIncomplete ? (
              <span className="rounded-[4px] border border-warning-border bg-warning-bg px-1 text-[10.5px] font-medium text-warning">
                {t('status.incomplete')}
              </span>
            ) : null}
          </p>
          <p className="m-0 mt-0.5 text-[12.5px] text-ink-secondary">{appointment.reason}</p>
        </div>
        <AppointmentStatusPill appointment={appointment} />
      </div>
      <div className="mt-2.5 flex flex-col gap-1 text-[12.5px] text-ink-secondary">
        <span>{when}</span>
        <RoomLine
          appointment={appointment}
          rooms={rooms}
          editable={abilities.write && (abilities.move || abilities.undoCheckIn)}
        />
        {followUp ? (
          <span>
            {t('popover.followUpFrom', {
              visit: `V-${String(followUp.sourceVisitNumber).padStart(6, '0')}`,
              dentist: followUp.recommendedByName,
            })}
          </span>
        ) : null}
        {appointment.bookedByName ? (
          <span>{t('popover.bookedBy', { name: appointment.bookedByName })}</span>
        ) : null}
        {lineage.moves > 0 ? (
          <span>
            {t('popover.moved', {
              count: lineage.moves,
              date: formatCalendarDate(
                clinicClock(lineage.firstStartsAt, clock.timeZone).date,
                i18n.language,
              ),
            })}
          </span>
        ) : null}
        <OwesLine patientId={appointment.patient.id} />
      </div>
      {appointment.patient.registrationIncomplete && abilities.checkIn ? (
        <p className="m-0 mt-2 text-[12px] text-warning">
          {t('popover.registrationIncomplete')}{' '}
          <button
            type="button"
            className="cursor-pointer border-none bg-transparent p-0 text-primary hover:underline"
            onClick={onCompleteRegistration}
          >
            {t('popover.completeNow')}
          </button>
        </p>
      ) : null}
      {needsRoom ? (
        <Select
          className="mt-2"
          aria-label={t('popover.room')}
          value={room}
          onChange={(event) => {
            setRoom(event.target.value);
          }}
        >
          <option value="">{t('popover.noRoom')}</option>
          {rooms.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </Select>
      ) : null}
      {cancelling ? (
        <CancelConfirm
          appointment={appointment}
          onDone={() => {
            setCancelling(false);
          }}
        />
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
          {abilities.checkIn ? (
            <Button
              size="sm"
              variant="primary"
              disabled={actions.checkIn.isPending}
              onClick={() => {
                actions.checkIn.mutate(
                  { id: appointment.id, ...(room ? { roomId: room } : {}) },
                  { onSuccess: onClose },
                );
              }}
            >
              {t('actions.checkIn')}
            </Button>
          ) : null}
          {abilities.startVisit && appointment.status === 'checked_in' ? (
            <Button size="sm" variant="primary" onClick={onStartVisit}>
              {t('actions.startVisit')}
            </Button>
          ) : null}
          {abilities.confirm ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={actions.confirm.isPending}
              onClick={() => {
                actions.confirm.mutate(appointment.id);
              }}
            >
              {t('actions.confirm')}
            </Button>
          ) : null}
          {abilities.undoCheckIn ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={actions.undoCheckIn.isPending}
              onClick={() => {
                actions.undoCheckIn.mutate(appointment.id);
              }}
            >
              {t('actions.undoCheckIn')}
            </Button>
          ) : null}
          {abilities.move ? (
            <Button size="sm" variant="secondary" onClick={onReschedule}>
              {t('actions.reschedule')}
            </Button>
          ) : null}
          {abilities.noShow ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={actions.noShow.isPending}
              onClick={() => {
                actions.noShow.mutate(appointment.id);
              }}
            >
              {t('actions.noShow')}
            </Button>
          ) : null}
          {abilities.cancel ? (
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
          <button
            type="button"
            className="ms-auto cursor-pointer border-none bg-transparent p-0 text-[12.5px] text-primary hover:underline"
            onClick={onOpenPatient}
          >
            {t('actions.patientRecord')}
          </button>
        </div>
      )}
    </>
  );
}

const POPOVER =
  'z-40 max-h-(--radix-popover-content-available-height) w-[340px] max-w-[calc(100vw-24px)] animate-fadein overflow-y-auto rounded-[10px] border border-border bg-surface p-4 shadow-[0_10px_28px_rgba(27,26,31,.14)]';

/** Where the clicked card is drawn now, so the popover follows a scroll and a redraw. */
function liveCard(id: string): Element | null {
  return document.querySelector(`[data-appointment="${CSS.escape(id)}"]`);
}

/**
 * What the popover's clipping is measured from: the scroller's child that holds the card, so it hides
 * when the scroller hides the card, not when the card's own clipped box crops a point inside it.
 */
function clipContext(card: Element): Element {
  let element = card;
  for (let parent = card.parentElement; parent; parent = parent.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(parent).overflowY)) return element;
    element = parent;
  }
  return card;
}

/**
 * Anchored at a rect (the clicked card, the drop): beside it, or under or over it when it is too wide
 * (`placePopover`). With `card`, it follows that card as the calendar scrolls and hides once the card
 * is scrolled out of view.
 */
export function AnchoredPopover({
  rect,
  card,
  label,
  onClose,
  children,
}: {
  rect: DOMRect;
  card?: { id: string; point?: { x: number; y: number } };
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { i18n } = useTranslation();
  const rtl = i18n.dir() === 'rtl';
  const cardId = card?.id;
  const point = card?.point;
  const placement = useMemo(
    () =>
      placePopover(rect, { width: window.innerWidth, height: window.innerHeight }, { point, rtl }),
    [rect, point, rtl],
  );
  const anchor = useMemo(() => {
    const element = cardId ? liveCard(cardId) : null;
    const measurable = {
      getBoundingClientRect: () =>
        placement.anchor((cardId ? liveCard(cardId) : null)?.getBoundingClientRect() ?? rect),
      ...(element ? { contextElement: clipContext(element) } : {}),
    };
    return { current: measurable };
  }, [cardId, placement, rect]);
  return (
    <Popover.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Popover.Anchor virtualRef={anchor} />
      <Popover.Portal>
        <Popover.Content
          aria-label={label}
          side={placement.side}
          align="start"
          sideOffset={POPOVER_GAP}
          collisionPadding={POPOVER_EDGE}
          hideWhenDetached={cardId !== undefined}
          className={POPOVER}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
