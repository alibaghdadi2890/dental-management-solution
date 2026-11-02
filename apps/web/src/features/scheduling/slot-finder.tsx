import {
  type Appointment,
  canWriteAppointment,
  type FollowUpInvalidReason,
  type Slot,
  SLOT_SEARCH_MAX_DAYS,
  type VisitType,
} from '@dcm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { TextInput } from '@/components/ui/field';
import { useSession } from '@/features/auth/session';
import { ApiError } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatCalendarDate, formatTime } from '@/lib/format';
import { useIdempotencyKeys } from '@/lib/idempotency';
import { cn } from '@/lib/utils';
import { addDays, clinicClock } from './schedule-time';
import {
  bookAppointment,
  invalidateSchedule,
  rescheduleAppointment,
  resourcesQuery,
  schedulingKeys,
  slotsQuery,
} from './scheduling-api';

const SHOWN_PER_DAY = 3;
const MORE_DATES_DAYS = 14;
const LATER_DAYS = 31;
/** One less than `SLOT_SEARCH_MAX_DAYS`: the range counts both ends. */
const MAX_RANGE_DAYS = SLOT_SEARCH_MAX_DAYS - 1;

/** Three chips spread over the day: first, middle, last (A10). */
function spread(slots: readonly Slot[]): Slot[] {
  if (slots.length <= SHOWN_PER_DAY) return [...slots];
  const middle = slots[Math.floor(slots.length / 2)];
  const first = slots[0];
  const last = slots.at(-1);
  return first && middle && last ? [first, middle, last] : [...slots];
}

export interface SlotRequestContext {
  patientId: string;
  patientName: string;
  /** What is being booked: the follow-up's title, say. */
  reason: string;
  visitType: VisitType | null;
  durationMin: number;
  dentistId: string | null;
  from: string;
  to: string;
  timingLabel: string;
  planIds?: readonly string[] | undefined;
  followUpId?: string | undefined;
  sourceVisitId?: string | undefined;
  /** Moves this appointment instead of booking a new one (A9). */
  rescheduleId?: string | undefined;
  /** Opens on *Change dentist*: the preferred dentist is gone (G16). */
  pickDentist?: boolean | undefined;
  invalidReason?: FollowUpInvalidReason | null | undefined;
  recommender?: string | undefined;
}

/**
 * *Find available slots* (A10): a follow-up's header, days of start-time chips, then *Confirm
 * appointment*. One component for the Complete dialog, the checkout, the worklist and the record.
 */
export function SlotFinder({
  context,
  onBooked,
  onCancel,
  cancelLabel,
}: {
  context: SlotRequestContext;
  onBooked: (appointment: Appointment) => void;
  onCancel: () => void;
  cancelLabel: string;
}) {
  const { t, i18n } = useTranslation('scheduling');
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const keyFor = useIdempotencyKeys();
  const branchId = session?.branch?.id ?? '';
  const timeZone = session?.tenant?.timeZone ?? 'UTC';
  const clock = { timeZone, locale: i18n.language };
  const resources = useQuery(resourcesQuery(branchId));
  const [dentistId, setDentistId] = useState(context.pickDentist ? null : context.dentistId);
  const [panel, setPanel] = useState<'dentist' | 'dates' | null>(
    context.pickDentist ? 'dentist' : null,
  );
  const [from, setFrom] = useState(context.from);
  const [to, setTo] = useState(context.to);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [picked, setPicked] = useState<Slot | null>(null);
  const [taken, setTaken] = useState(false);
  const dentist = resources.data?.dentists.find((item) => item.id === dentistId);
  const actor = {
    permissions: session?.permissions ?? [],
    profileId: session?.profile?.id ?? null,
  };
  const bookable =
    resources.data?.dentists.filter((item) => canWriteAppointment(actor, { dentistId: item.id })) ??
    [];

  const slots = useQuery(
    slotsQuery(
      {
        branchId,
        dentistId: dentistId ?? '',
        patientId: context.patientId,
        durationMin: context.durationMin,
        from,
        to,
        stepMin: 15,
        ignoreAppointmentId: context.rescheduleId,
      },
      dentistId !== null,
    ),
  );
  const days = (slots.data ?? []).filter((day) => day.slots.length > 0);

  const book = useMutation({
    mutationFn: (slot: Slot) => {
      if (context.rescheduleId) {
        const change = { startsAt: slot.startsAt, dentistId: dentistId ?? '' };
        const key = keyFor({ id: context.rescheduleId, ...change });
        return rescheduleAppointment(context.rescheduleId, change, key);
      }
      const input = {
        branchId,
        patientId: context.patientId,
        dentistId: dentistId ?? '',
        startsAt: slot.startsAt,
        durationMin: context.durationMin,
        reason: context.reason,
        visitType: context.visitType,
        planIds: [...(context.planIds ?? [])],
        // The chip's room is Auto's: a later move chooses it again (G8).
        roomId: 'auto' as const,
        confirmed: true,
        ...(context.followUpId ? { followUpId: context.followUpId } : {}),
        ...(context.sourceVisitId ? { sourceVisitId: context.sourceVisitId } : {}),
      };
      return bookAppointment(input, keyFor(input));
    },
    onSuccess: async (appointment) => {
      await invalidateSchedule(queryClient);
      onBooked(appointment);
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.code === 'appointment.conflict') {
        setPicked(null);
        setTaken(true);
      }
      await queryClient.invalidateQueries({
        queryKey: schedulingKeys.all(session?.tenant?.id ?? null),
      });
    },
  });

  if (picked && dentist) {
    const usualNote =
      !picked.isUsual && picked.usualRoomName
        ? t('finder.usualInUse', { usual: picked.usualRoomName })
        : null;
    return (
      <div className="flex flex-col gap-3">
        <h3 className="m-0 text-[14px] font-semibold">{t('finder.confirmTitle')}</h3>
        <dl className="m-0 grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
          <dt className="text-ink-muted">{t('finder.patient')}</dt>
          <dd className="m-0">{context.patientName}</dd>
          <dt className="text-ink-muted">{t('finder.reason')}</dt>
          <dd className="m-0">{context.reason}</dd>
          <dt className="text-ink-muted">{t('finder.dentist')}</dt>
          <dd className="m-0">{dentist.name}</dd>
          <dt className="text-ink-muted">{t('finder.room')}</dt>
          <dd className="m-0">
            {picked.roomName ?? t('panel.roomAtCheckIn')}
            {usualNote ? <span className="ms-1.5 text-ink-muted">{usualNote}</span> : null}
          </dd>
          <dt className="text-ink-muted">{t('finder.when')}</dt>
          <dd className="m-0">
            {formatCalendarDate(clinicClock(picked.startsAt, timeZone).date, i18n.language)} ·{' '}
            {formatTime(picked.startsAt, clock)}–{formatTime(picked.endsAt, clock)}
          </dd>
        </dl>
        {book.isError && !taken ? (
          <p role="alert" className="m-0 text-[12.5px] text-danger">
            {book.error instanceof ApiError && book.error.code === 'follow_up.not_awaiting'
              ? t('finder.alreadyBooked')
              : apiErrorMessage(book.error, i18n)}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button
            variant="primary"
            disabled={book.isPending}
            onClick={() => {
              book.mutate(picked);
            }}
          >
            {t('finder.confirm')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setPicked(null);
            }}
          >
            {t('finder.back')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 flex flex-wrap gap-1.5 text-[13px]">
        <span className="font-semibold">{context.reason}</span>
        <span className="text-ink-muted">
          · {t('panel.minutes', { count: context.durationMin })}
          {dentist ? ` · ${dentist.name}` : ''} · {context.timingLabel}
        </span>
      </p>
      {context.invalidReason ? (
        <p
          role="alert"
          className="m-0 rounded-md bg-warning-bg px-2.5 py-1.5 text-[12.5px] text-warning-ink"
        >
          {t(`finder.invalid.${context.invalidReason}`)}{' '}
          {t('finder.checkWith', { dentist: context.recommender ?? '' })}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={panel === 'dentist'}
          onClick={() => {
            setPanel(panel === 'dentist' ? null : 'dentist');
          }}
        >
          {t('finder.changeDentist')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={panel === 'dates'}
          onClick={() => {
            setPanel(panel === 'dates' ? null : 'dates');
          }}
        >
          {t('finder.changeDates')}
        </Button>
        <Link
          to="/schedule"
          search={{ date: from }}
          className="inline-flex h-[30px] items-center px-3 text-[12.5px] font-medium text-primary hover:underline"
        >
          {t('finder.openCalendar')}
        </Link>
      </div>
      {panel === 'dentist' ? (
        <div role="group" aria-label={t('finder.dentist')} className="flex flex-wrap gap-1">
          {bookable.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={item.id === dentistId}
              className={cn(
                'h-[32px] cursor-pointer rounded-lg border px-2.5 text-[12.5px]',
                item.id === dentistId
                  ? 'border-primary bg-primary-tint font-semibold text-primary'
                  : 'border-border-control bg-surface',
              )}
              onClick={() => {
                setDentistId(item.id);
                setPanel(null);
              }}
            >
              {item.name}
            </button>
          ))}
        </div>
      ) : null}
      {panel === 'dates' ? (
        <div className="flex items-center gap-2 text-[12.5px]">
          <label className="flex items-center gap-1.5">
            {t('finder.from')}
            <TextInput
              type="date"
              value={from}
              onChange={(event) => {
                if (event.target.value) setFrom(event.target.value);
              }}
            />
          </label>
          <label className="flex items-center gap-1.5">
            {t('finder.to')}
            <TextInput
              type="date"
              value={to}
              min={from}
              onChange={(event) => {
                if (event.target.value) setTo(event.target.value);
              }}
            />
          </label>
        </div>
      ) : null}
      {taken ? (
        <p
          role="alert"
          className="m-0 rounded-md bg-warning-bg px-2.5 py-1.5 text-[12.5px] text-warning-ink"
        >
          {t('finder.taken')}
        </p>
      ) : null}
      {slots.isFetching && !slots.data ? (
        <span className="flex items-center gap-2 text-[12.5px] text-ink-muted">
          <Spinner tone="dark" />
          {t('finder.checking')}
        </span>
      ) : null}
      {days.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {days.map((day) => {
            const all = opened.has(day.date);
            const shown = all ? day.slots : spread(day.slots);
            return (
              <li key={day.date} className="flex items-baseline gap-3">
                <span className="w-[112px] flex-none text-[12.5px] font-medium">
                  {formatCalendarDate(day.date, i18n.language)}
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {shown.map((slot) => (
                    <button
                      key={slot.startsAt}
                      type="button"
                      className="flex h-[32px] cursor-pointer items-center gap-1.5 rounded-md border border-border-control bg-surface px-2.5 text-[12.5px] hover:border-primary hover:bg-primary-tint"
                      title={slot.roomName ?? undefined}
                      onClick={() => {
                        setTaken(false);
                        setPicked(slot);
                      }}
                    >
                      {formatTime(slot.startsAt, clock)}
                      {!slot.isUsual && slot.roomName ? (
                        <span className="text-[11px] text-ink-muted">{slot.roomName}</span>
                      ) : null}
                    </button>
                  ))}
                  {!all && day.slots.length > SHOWN_PER_DAY ? (
                    <button
                      type="button"
                      className="h-[32px] cursor-pointer rounded-md border-none bg-transparent px-1.5 text-[12.5px] text-primary hover:underline"
                      onClick={() => {
                        setOpened(new Set([...opened, day.date]));
                      }}
                    >
                      {t('finder.more', { count: day.slots.length - SHOWN_PER_DAY })}
                    </button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {slots.isError ? (
        <p role="alert" className="m-0 text-[12.5px] text-danger">
          {apiErrorMessage(slots.error, i18n)}
        </p>
      ) : null}
      {slots.isSuccess && days.length === 0 ? (
        <div className="rounded-md border border-border p-3 text-[12.5px]">
          <p className="m-0 font-medium">{t('finder.emptyTitle')}</p>
          <p className="m-0 mt-0.5 text-ink-secondary">{t('finder.emptyBody')}</p>
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            onClick={() => {
              const next = addDays(to, 1);
              setFrom(next);
              setTo(addDays(next, LATER_DAYS));
            }}
          >
            {t('finder.later')}
          </Button>
        </div>
      ) : null}
      {dentistId === null ? (
        <p className="m-0 text-[12.5px] text-ink-secondary">{t('finder.pickDentist')}</p>
      ) : null}
      <div className="flex gap-2">
        {days.length > 0 && addDays(to, MORE_DATES_DAYS) <= addDays(from, MAX_RANGE_DAYS) ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setTo(addDays(to, MORE_DATES_DAYS));
            }}
          >
            {t('finder.moreDates')}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {cancelLabel}
        </Button>
      </div>
    </div>
  );
}
