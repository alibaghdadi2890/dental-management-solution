import { appointmentSchema, type WaitlistFit, type WaitlistOpening } from '@dcm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { InfoMark } from '@/components/ui/info-mark';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { RightPanel } from '@/components/ui/right-panel';
import { Select, TextInput } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast-context';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { LabBookingWarning } from '@/features/labs/appointment-lab-work';
import { useOpenLabOrders } from '@/features/labs/lab-words';
import { ApiError, apiFetch } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatCalendarDate, formatPhone, formatTime } from '@/lib/format';
import { useIdempotencyKeys } from '@/lib/idempotency';
import { checkAppointment, invalidateSchedule, schedulingKeys } from '../scheduling-api';
import { fillOpening, openingQuery, recordAttempt, removeWaitlistEntry } from './waitlist-api';
import { useFreedTimeToast } from './use-freed-time-toast';
import { useAppointmentWords, useWaitedWords } from './waitlist-words';

/** Lab work expected after the opening's day: the row is still listed, last (B2). */
function useLateLab(): (patientId: string, day: string) => boolean {
  const { byPatient } = useOpenLabOrders();
  return (patientId, day) =>
    (byPatient.get(patientId) ?? []).some(
      (order) => order.status !== 'arrived' && order.expectedOn !== null && order.expectedOn > day,
    );
}

/**
 * *Fill* (B4, S2): one opening and who fits it, in the fair order, lab work last. A row is one
 * line with *Book*, *No answer*, *Not this time* and *Remove…*; *Book* asks one confirmation, in the
 * manner of the slot finder's, with *Confirmed with patient* ticked.
 */
export function FillPanel({
  appointmentId,
  at,
  onClose,
}: {
  appointmentId: string;
  at?: string | undefined;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation('scheduling');
  const { data: session } = useSession();
  const detail = useQuery(openingQuery(appointmentId, at));
  const lateLab = useLateLab();
  const [booking, setBooking] = useState<WaitlistFit | null>(null);
  const [taken, setTaken] = useState(false);
  const timeZone = session?.tenant?.timeZone ?? 'UTC';
  const clock = { timeZone, locale: i18n.language };
  const opening = detail.data?.opening ?? null;
  const fits = opening
    ? [...(detail.data?.fits ?? [])].sort(
        (a, b) =>
          Number(lateLab(a.entry.patient.id, opening.date)) -
          Number(lateLab(b.entry.patient.id, opening.date)),
      )
    : [];
  const span = opening
    ? `${formatCalendarDate(opening.date, i18n.language)} · ${formatTime(opening.startsAt, clock)}–${formatTime(opening.endsAt, clock)}`
    : '';

  return (
    <>
      <div
        className="fixed inset-0 z-40 animate-fadein bg-[rgba(27,26,31,.28)]"
        aria-hidden
        onClick={onClose}
      />
      <RightPanel
        modal
        title={t('waitlist.fillTitle')}
        subtitle={
          opening ? (
            <p className="m-0 mt-1 flex items-center gap-1.5 text-[12.5px] text-ink-secondary">
              {span} · {opening.dentistName}
              <InfoMark about={t('waitlist.fillTitle')}>{t('waitlist.openingInfo')}</InfoMark>
            </p>
          ) : null
        }
        dirty={false}
        onClose={onClose}
        className="fixed inset-y-0 end-0 z-40 w-[560px] max-w-full shadow-[-12px_0_32px_rgba(27,26,31,.12)]"
      >
        {taken ? (
          <p
            role="alert"
            className="m-0 mb-3 rounded-md bg-warning-bg px-2.5 py-1.5 text-[12.5px] text-warning-ink"
          >
            {t('finder.taken')}
          </p>
        ) : null}
        {detail.isSuccess && !opening ? (
          <p className="m-0 text-[13px] text-ink-secondary">{t('waitlist.noOpening')}</p>
        ) : null}
        {opening && booking ? (
          <ConfirmFill
            opening={opening}
            fit={booking}
            lateLab={lateLab(booking.entry.patient.id, opening.date)}
            onBack={() => {
              setBooking(null);
            }}
            onTaken={() => {
              setBooking(null);
              setTaken(true);
            }}
            onDone={onClose}
          />
        ) : null}
        {opening && !booking ? (
          fits.length === 0 ? (
            <p className="m-0 text-[13px] text-ink-secondary">{t('waitlist.nobodyFits')}</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-0 p-0">
              {fits.map((fit) => (
                <FitRow
                  key={fit.entry.id}
                  fit={fit}
                  lateLab={lateLab(fit.entry.patient.id, opening.date)}
                  onBook={() => {
                    setTaken(false);
                    setBooking(fit);
                  }}
                />
              ))}
            </ul>
          )
        ) : null}
        {detail.isError ? (
          <p role="alert" className="m-0 text-[12.5px] text-danger">
            {apiErrorMessage(detail.error, i18n)}
          </p>
        ) : null}
      </RightPanel>
    </>
  );
}

/** The marks of a row or an entry: *Urgent*, lab work, the last attempt. */
export function EntryMarks({ entry, lateLab }: { entry: WaitlistFit['entry']; lateLab: boolean }) {
  const { t, i18n } = useTranslation(['scheduling', 'labs']);
  const { data: session } = useSession();
  const clock = { timeZone: session?.tenant?.timeZone ?? 'UTC', locale: i18n.language };
  return (
    <>
      {entry.urgent ? (
        <span className="rounded-[4px] border border-danger-border bg-danger-bg px-1 text-[10.5px] font-medium text-danger">
          {t('waitlist.urgent')}
        </span>
      ) : null}
      {lateLab ? (
        <span className="rounded-full border border-warning-dot bg-warning-bg px-1.5 text-[10.5px] font-semibold text-warning-ink">
          {t('labs:appointmentLab.pending')}
        </span>
      ) : null}
      {entry.lastAttempt ? (
        <span className="rounded-[4px] border border-border px-1 text-[10.5px] text-ink-secondary">
          {t(`waitlist.outcome.${entry.lastAttempt.outcome}`)} ·{' '}
          {entry.triedToday
            ? formatTime(entry.lastAttempt.at, clock)
            : formatCalendarDate(entry.lastAttempt.at.slice(0, 10), i18n.language)}
        </span>
      ) : null}
    </>
  );
}

function FitRow({
  fit,
  lateLab,
  onBook,
}: {
  fit: WaitlistFit;
  lateLab: boolean;
  onBook: () => void;
}) {
  const { t, i18n } = useTranslation('scheduling');
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const appointmentWords = useAppointmentWords();
  const waited = useWaitedWords();
  const [removing, setRemoving] = useState(false);
  const [reason, setReason] = useState('');
  const { entry } = fit;
  const settle = {
    onSuccess: () => invalidateSchedule(queryClient),
    onError: (error: unknown) => {
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
    },
  };
  const attempt = useMutation({
    mutationFn: (outcome: 'no_answer' | 'not_this_time') => recordAttempt(entry.id, outcome),
    ...settle,
  });
  const remove = useMutation({
    mutationFn: () => removeWaitlistEntry(entry.id, reason),
    ...settle,
  });
  const phone =
    entry.callPhone && session?.tenant
      ? formatPhone(entry.callPhone, session.tenant.country)
      : null;
  return (
    <li className="border-b border-inner-divider py-2.5 last:border-b-0">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="m-0 flex flex-wrap items-center gap-1.5 text-[13px]">
            <span className="font-medium">{entry.patient.fullName}</span>
            {entry.patient.registrationIncomplete ? (
              <span className="rounded-[4px] border border-warning-border bg-warning-bg px-1 text-[10.5px] font-medium text-warning">
                {t('status.incomplete')}
              </span>
            ) : null}
            {phone ? (
              <a
                href={`tel:${entry.callPhone ?? ''}`}
                dir="ltr"
                className="font-mono text-[12px] text-primary hover:underline"
              >
                {phone}
              </a>
            ) : null}
          </p>
          <p className="m-0 mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-muted">
            <span>
              {entry.reason} · {t('panel.minutes', { count: entry.durationMin })} ·{' '}
              {appointmentWords(entry)} · {waited(entry)}
            </span>
            <EntryMarks entry={entry} lateLab={lateLab} />
          </p>
        </div>
        <Button size="sm" variant="primary" onClick={onBook}>
          {t('waitlist.book')}
        </Button>
        <Menu>
          <MenuTrigger asChild>
            <Button size="sm" variant="secondary" aria-label={t('today.more')}>
              {'⋯'}
            </Button>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem
              onSelect={() => {
                attempt.mutate('no_answer');
              }}
            >
              {t('waitlist.outcome.no_answer')}
            </MenuItem>
            <MenuItem
              onSelect={() => {
                attempt.mutate('not_this_time');
              }}
            >
              {t('waitlist.outcome.not_this_time')}
            </MenuItem>
            <MenuItem
              onSelect={() => {
                setRemoving(true);
              }}
            >
              {t('waitlist.remove')}
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      {removing ? (
        <RemoveForm
          reason={reason}
          onReason={setReason}
          busy={remove.isPending}
          onCancel={() => {
            setRemoving(false);
          }}
          onRemove={() => {
            remove.mutate();
          }}
        />
      ) : null}
    </li>
  );
}

/** *Remove from waitlist…*: an optional reason, then the removal. */
export function RemoveForm({
  reason,
  onReason,
  busy,
  onCancel,
  onRemove,
}: {
  reason: string;
  onReason: (reason: string) => void;
  busy: boolean;
  onCancel: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation('scheduling');
  return (
    <div className="mt-2 flex items-center gap-2">
      <TextInput
        value={reason}
        maxLength={500}
        placeholder={t('waitlist.removeReason')}
        aria-label={t('waitlist.removeReason')}
        onChange={(event) => {
          onReason(event.target.value);
        }}
      />
      <Button size="sm" variant="secondary" onClick={onCancel}>
        {t('popover.keep')}
      </Button>
      <Button size="sm" variant="danger" disabled={busy} onClick={onRemove}>
        {t('waitlist.removeConfirm')}
      </Button>
    </div>
  );
}

/** The confirmation (B4): patient, reason, dentist, room, when; the start on the opening's grid. */
function ConfirmFill({
  opening,
  fit,
  lateLab,
  onBack,
  onTaken,
  onDone,
}: {
  opening: WaitlistOpening;
  fit: WaitlistFit;
  lateLab: boolean;
  onBack: () => void;
  onTaken: () => void;
  onDone: () => void;
}) {
  const { t, i18n } = useTranslation('scheduling');
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const keyFor = useIdempotencyKeys();
  const freedToast = useFreedTimeToast();
  const canRead = usePermission('appointment:read');
  const timeZone = session?.tenant?.timeZone ?? 'UTC';
  const clock = { timeZone, locale: i18n.language };
  const { entry } = fit;
  const [startsAt, setStartsAt] = useState(fit.starts[0] ?? opening.startsAt);
  const [confirmed, setConfirmed] = useState(true);
  const moving = entry.appointment;
  const current = useQuery({
    queryKey: [...schedulingKeys.all(session?.tenant?.id ?? null), 'appointment', moving?.id],
    queryFn: () => apiFetch(`/scheduling/appointments/${moving?.id ?? ''}`, appointmentSchema),
    enabled: moving !== null && canRead,
  });
  const roomChoice =
    moving && current.data && !current.data.roomAuto && current.data.roomId
      ? current.data.roomId
      : 'auto';
  const room = useQuery({
    queryKey: [
      ...schedulingKeys.all(session?.tenant?.id ?? null),
      'fill-room',
      entry.id,
      startsAt,
      roomChoice,
    ],
    enabled: moving === null || current.isSuccess || !canRead,
    queryFn: async () => {
      const check = (roomId: string) =>
        checkAppointment({
          branchId: opening.branchId,
          dentistId: opening.dentistId,
          patientId: entry.patient.id,
          startsAt,
          durationMin: entry.durationMin,
          roomId,
          ...(moving ? { ignoreAppointmentId: moving.id } : {}),
        });
      const first = await check(roomChoice);
      if (roomChoice !== 'auto' && first.conflicts.some((item) => item.kind === 'room')) {
        const auto = await check('auto');
        return { name: auto.room.roomName, replaced: current.data?.roomName ?? null };
      }
      return { name: first.room.roomName, replaced: null };
    },
  });
  const book = useMutation({
    mutationFn: () => {
      const input = { openingId: opening.id, startsAt, confirmed };
      return fillOpening(entry.id, input, keyFor({ id: entry.id, ...input }));
    },
    onSuccess: async () => {
      await invalidateSchedule(queryClient);
      onDone();
      const message = t('waitlist.toast.booked', { name: entry.patient.fullName });
      // A move frees the old time: whoever fits it is offered at once (B4).
      if (moving) await freedToast(moving.id, message);
      else toast(message);
    },
    onError: async (error) => {
      await invalidateSchedule(queryClient);
      if (
        error instanceof ApiError &&
        (error.code === 'waitlist.opening_taken' || error.code === 'appointment.conflict')
      ) {
        onTaken();
      }
    },
  });
  const end = new Date(Date.parse(startsAt) + entry.durationMin * 60_000).toISOString();
  return (
    <div className="flex flex-col gap-3">
      <h3 className="m-0 text-[14px] font-semibold">
        {moving ? t('waitlist.confirmMove') : t('finder.confirmTitle')}
      </h3>
      <dl className="m-0 grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        <dt className="text-ink-muted">{t('finder.patient')}</dt>
        <dd className="m-0">{entry.patient.fullName}</dd>
        <dt className="text-ink-muted">{t('finder.reason')}</dt>
        <dd className="m-0">{entry.reason}</dd>
        <dt className="text-ink-muted">{t('finder.dentist')}</dt>
        <dd className="m-0">{opening.dentistName}</dd>
        <dt className="text-ink-muted">{t('finder.room')}</dt>
        <dd className="m-0">
          {room.data ? (room.data.name ?? t('panel.roomAtCheckIn')) : '…'}
          {room.data?.replaced ? (
            <span className="ms-1.5 text-warning">
              {t('waitlist.roomReplaced', { room: room.data.replaced })}
            </span>
          ) : null}
        </dd>
        <dt className="text-ink-muted">{t('finder.when')}</dt>
        <dd className="m-0">
          {moving ? (
            <span className="block text-ink-muted">
              {t('waitlist.from', {
                when: `${formatCalendarDate(moving.localDate, i18n.language)} · ${formatTime(moving.startsAt, clock)}`,
              })}
            </span>
          ) : null}
          {formatCalendarDate(opening.date, i18n.language)} ·{' '}
          {fit.starts.length > 1 ? (
            <Select
              aria-label={t('finder.when')}
              className="inline-block h-[28px] w-auto"
              value={startsAt}
              onChange={(event) => {
                setStartsAt(event.target.value);
              }}
            >
              {fit.starts.map((start) => (
                <option key={start} value={start}>
                  {formatTime(start, clock)}
                </option>
              ))}
            </Select>
          ) : (
            formatTime(startsAt, clock)
          )}
          –{formatTime(end, clock)}
        </dd>
      </dl>
      {lateLab ? <LabBookingWarning patientId={entry.patient.id} day={opening.date} /> : null}
      <label className="flex cursor-pointer items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => {
            setConfirmed(event.target.checked);
          }}
        />
        {t('panel.confirmed')}
      </label>
      {book.isError &&
      !(
        book.error instanceof ApiError &&
        ['waitlist.opening_taken', 'appointment.conflict'].includes(book.error.code)
      ) ? (
        <p role="alert" className="m-0 text-[12.5px] text-danger">
          {apiErrorMessage(book.error, i18n)}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={book.isPending || room.isPending}
          onClick={() => {
            book.mutate();
          }}
        >
          {moving ? t('waitlist.move') : t('waitlist.book')}
        </Button>
        <Button variant="secondary" onClick={onBack}>
          {t('finder.back')}
        </Button>
      </div>
    </div>
  );
}
