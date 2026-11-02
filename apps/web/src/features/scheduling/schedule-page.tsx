import {
  type Appointment,
  type AppointmentConflict,
  canWriteAppointment,
  type ScheduleDentist,
  type Slot,
} from '@dcm/contracts';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/list';
import { InPanelSlot, PanelLayout } from '@/components/ui/panel-slot';
import { useToast } from '@/components/ui/toast-context';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { StartVisitPopover } from '@/features/clinical/start-visit-popover';
import { usePatientNavigation } from '@/features/patients/patient-navigation';
import { patientQuery } from '@/features/patients/patients-api';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatCalendarDate, formatTime, todayIn } from '@/lib/format';
import { useIdempotencyKeys } from '@/lib/idempotency';
import { AnchoredPopover, AppointmentDetails } from './appointment-popover';
import { ConflictLines } from './conflict-lines';
import { conflictsOf, useConflictWords } from './conflict-words';
import { NewAppointmentPanel, type NewAppointmentDraft } from './new-appointment-panel';
import { type CalendarEvent, ScheduleCalendar, type ScheduleView } from './schedule-calendar';
import { addDays, clinicClock, gridBounds, instantOf, weekOf } from './schedule-time';
import { ScheduleToolbar } from './schedule-toolbar';
import {
  appointmentsQuery,
  checkAppointment,
  invalidateSchedule,
  openingHoursQuery,
  rescheduleAppointment,
  resizeAppointment,
  resourcesQuery,
  slotsQuery,
} from './scheduling-api';
import { useAppointmentAbilities } from './use-appointment-actions';
import { useScheduleDisplay } from './use-schedule-display';

export interface ScheduleSearch {
  date?: string | undefined;
  view?: ScheduleView | undefined;
  dentist?: string | undefined;
  room?: string | undefined;
  unresolved?: boolean | undefined;
  appointment?: string | undefined;
  /** Opens the panel: from the Today board. */
  book?: boolean | undefined;
  /** Opens the panel on this patient: from the record. */
  bookFor?: string | undefined;
}

/** A proposed change, waiting for its confirmation at the drop. */
type Pending =
  | {
      kind: 'move';
      appointment: Appointment;
      start: Date;
      dentistId: string;
      rect: DOMRect;
      conflicts: AppointmentConflict[];
    }
  | {
      kind: 'resize';
      appointment: Appointment;
      end: Date;
      rect: DOMRect;
      conflicts: AppointmentConflict[];
    };

const minutesBetween = (start: Date, end: Date) =>
  Math.round((end.getTime() - start.getTime()) / 60_000);

const pointAt = (x: number, y: number) => new DOMRect(x, y, 0, 0);

const toEvent = (appointment: Appointment): CalendarEvent => ({
  id: appointment.id,
  title: appointment.patient.fullName,
  start: new Date(appointment.startsAt),
  end: new Date(appointment.endsAt),
  dentistId: appointment.dentistId,
  appointment,
});

/** The Schedule screen (A5–A9): the state of what is open; the grid itself is `ScheduleCalendar`. */
export function SchedulePage({
  search,
  onSearch,
}: {
  search: ScheduleSearch;
  onSearch: (next: ScheduleSearch) => void;
}) {
  const { t, i18n } = useTranslation('scheduling');
  const { data: session } = useSession();
  const canRead = usePermission('appointment:read');
  const tenant = session?.tenant;
  const branch = session?.branch;
  if (!tenant || !branch) return null;
  if (!canRead) {
    return <EmptyState title={t('noAccess.title')} body={t('noAccess.body')} />;
  }
  return (
    <ScheduleScreen
      key={branch.id}
      branchId={branch.id}
      userId={session.user.id}
      timeZone={tenant.timeZone}
      locale={i18n.language}
      search={search}
      onSearch={onSearch}
    />
  );
}

function ScheduleScreen({
  branchId,
  userId,
  timeZone,
  locale,
  search,
  onSearch,
}: {
  branchId: string;
  userId: string;
  timeZone: string;
  locale: string;
  search: ScheduleSearch;
  onSearch: (next: ScheduleSearch) => void;
}) {
  const { t, i18n } = useTranslation('scheduling');
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const patientNavigation = usePatientNavigation();
  const words = useConflictWords();
  const abilities = useAppointmentAbilities();
  const canOverride = usePermission('appointment:override');
  const keyFor = useIdempotencyKeys();
  const [slotLength, setSlotLength] = useScheduleDisplay(userId);
  const [selected, setSelected] = useState<{ id: string; rect: DOMRect } | null>(null);
  const [panel, setPanel] = useState<NewAppointmentDraft | null>(null);
  const [moving, setMoving] = useState<Appointment | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const pointer = useRef({ x: 0, y: 0 });

  const today = todayIn(timeZone);
  const date = search.date ?? today;
  const view: ScheduleView = search.view ?? 'day';
  const dates = useMemo(() => (view === 'day' ? [date] : weekOf(date)), [view, date]);
  const firstDate = dates[0] ?? date;
  const lastDate = dates.at(-1) ?? date;
  const from = instantOf(firstDate, '00:00', timeZone).toISOString();
  const to = instantOf(addDays(lastDate, 1), '00:00', timeZone).toISOString();

  const resources = useQuery(resourcesQuery(branchId));
  const hours = useQuery(openingHoursQuery(branchId));
  const range = useQuery(appointmentsQuery(branchId, from, to));
  const appointments = useMemo(() => range.data ?? [], [range.data]);

  useEffect(() => {
    const remember = (event: PointerEvent) => {
      pointer.current = { x: event.clientX, y: event.clientY };
    };
    window.addEventListener('pointerup', remember);
    return () => {
      window.removeEventListener('pointerup', remember);
    };
  }, []);

  /** The branch's dentists, plus an active one taken off it who still has a card here (G16). */
  const columns = useMemo<ScheduleDentist[]>(() => {
    const dentists = resources.data?.dentists ?? [];
    const known = new Set(dentists.map((dentist) => dentist.id));
    const extra = new Map<string, ScheduleDentist>();
    for (const appointment of appointments) {
      if (known.has(appointment.dentistId) || extra.has(appointment.dentistId)) continue;
      extra.set(appointment.dentistId, {
        id: appointment.dentistId,
        name: appointment.dentistName,
        order: dentists.length + extra.size,
      });
    }
    const all = [...dentists, ...extra.values()];
    return search.dentist ? all.filter((dentist) => dentist.id === search.dentist) : all;
  }, [resources.data, appointments, search.dentist]);

  const visible = useMemo(
    () =>
      appointments.filter(
        (appointment) =>
          (!search.dentist || appointment.dentistId === search.dentist) &&
          (!search.room || appointment.roomId === search.room) &&
          (!search.unresolved || appointment.unresolved),
      ),
    [appointments, search.dentist, search.room, search.unresolved],
  );

  const events = useMemo(() => {
    const drawn = visible.map(toEvent);
    if (pending?.kind === 'move') {
      const { appointment, start, dentistId } = pending;
      const length = Date.parse(appointment.endsAt) - Date.parse(appointment.startsAt);
      return drawn.map((event) =>
        event.id === appointment.id
          ? {
              ...event,
              start,
              end: new Date(start.getTime() + length),
              dentistId,
              pending: true,
            }
          : event,
      );
    }
    if (pending?.kind === 'resize') {
      return drawn.map((event) =>
        event.id === pending.appointment.id ? { ...event, end: pending.end, pending: true } : event,
      );
    }
    return drawn;
  }, [visible, pending]);

  const bounds = useMemo(
    () => gridBounds(dates, hours.data?.days ?? [], visible, timeZone),
    [dates, hours.data, visible, timeZone],
  );

  // Move mode: every dentist's starts, days and columns as they are in view (A9). The week's
  // columns are days, so there the card stays with its dentist.
  const moveDentists = useMemo(
    () =>
      view === 'week' && moving
        ? columns.filter((dentist) => dentist.id === moving.dentistId)
        : columns,
    [view, moving, columns],
  );
  const moveQueries = useQueries({
    queries: moving
      ? moveDentists.map((dentist) =>
          slotsQuery({
            branchId,
            dentistId: dentist.id,
            patientId: moving.patient.id,
            durationMin: minutesBetween(new Date(moving.startsAt), new Date(moving.endsAt)),
            from: firstDate,
            to: lastDate,
            // Every slot length's cells fall on it, counted from the hour the grid opens on.
            stepMin: 15,
            ignoreAppointmentId: moving.id,
            includeWarnings: true,
          }),
        )
      : [],
  });
  const moveSlots = useMemo(() => {
    if (!moving) return null;
    const offers = new Map<string, Map<number, Slot>>();
    moveDentists.forEach((dentist, index) => {
      const days = moveQueries[index]?.data ?? [];
      offers.set(
        dentist.id,
        new Map(
          days.flatMap((day) =>
            day.slots.map((slot) => [Date.parse(slot.startsAt), slot] as [number, Slot]),
          ),
        ),
      );
    });
    return offers;
  }, [moving, moveDentists, moveQueries]);

  const selectedAppointment = selected
    ? appointments.find((appointment) => appointment.id === selected.id)
    : undefined;

  const bookingFor = useQuery({
    ...patientQuery(search.bookFor ?? ''),
    enabled: search.bookFor !== undefined,
  });
  // `?book` and `?bookFor=` open the panel, as the URL says; closing it clears them.
  const asked = search.book === true || (search.bookFor !== undefined && bookingFor.data);
  const openDraft: NewAppointmentDraft | null =
    panel ??
    (asked
      ? {
          date: date < today ? today : date,
          durationMin: slotLength,
          ...(bookingFor.data
            ? {
                patient: {
                  id: bookingFor.data.id,
                  fullName: bookingFor.data.fullName,
                  meta: `${bookingFor.data.displayNumber} · ${bookingFor.data.phone ?? ''}`,
                },
              }
            : {}),
        }
      : null);
  const closePanel = () => {
    setPanel(null);
    if (search.book || search.bookFor) onSearch({ ...search, book: undefined, bookFor: undefined });
  };

  // `?appointment=` from the board or the record: open its card once it is drawn.
  useEffect(() => {
    if (!search.appointment || selected?.id === search.appointment) return;
    const card = document.querySelector(`[data-appointment="${search.appointment}"]`);
    if (card) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- measures the card once it is drawn
      setSelected({ id: search.appointment, rect: card.getBoundingClientRect() });
    }
  }, [search.appointment, selected, events]);

  const propose = async (appointment: Appointment, start: Date, dentistId: string) => {
    setMoving(null);
    const duration = minutesBetween(new Date(appointment.startsAt), new Date(appointment.endsAt));
    try {
      const check = await checkAppointment({
        branchId,
        dentistId,
        patientId: appointment.patient.id,
        startsAt: start.toISOString(),
        durationMin: duration,
        roomId: appointment.roomAuto ? 'auto' : (appointment.roomId ?? 'auto'),
        ignoreAppointmentId: appointment.id,
      });
      const refusal = check.conflicts.find((conflict) => conflict.hard);
      if (refusal) {
        toast(words.of(refusal), { tone: 'danger' });
        return;
      }
      setPending({
        kind: 'move',
        appointment,
        start,
        dentistId,
        rect: pointAt(pointer.current.x, pointer.current.y),
        conflicts: check.conflicts,
      });
    } catch (error) {
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
    }
  };

  const proposeResize = async (appointment: Appointment, end: Date) => {
    const start = new Date(appointment.startsAt);
    try {
      const check = await checkAppointment({
        branchId,
        dentistId: appointment.dentistId,
        patientId: appointment.patient.id,
        startsAt: appointment.startsAt,
        durationMin: minutesBetween(start, end),
        roomId: appointment.roomId ?? 'auto',
        ignoreAppointmentId: appointment.id,
      });
      const refusal = check.conflicts.find((conflict) => conflict.hard);
      if (refusal) {
        toast(words.of(refusal), { tone: 'danger' });
        return;
      }
      setPending({
        kind: 'resize',
        appointment,
        end,
        rect: pointAt(pointer.current.x, pointer.current.y),
        conflicts: check.conflicts,
      });
    } catch (error) {
      toast(apiErrorMessage(error, i18n), { tone: 'danger' });
    }
  };

  const apply = useMutation({
    mutationFn: (change: Pending) => {
      const override = change.conflicts.length > 0;
      if (change.kind === 'resize') {
        return resizeAppointment(
          change.appointment.id,
          minutesBetween(new Date(change.appointment.startsAt), change.end),
          override,
        );
      }
      const input = {
        startsAt: change.start.toISOString(),
        dentistId: change.dentistId,
        override,
      };
      const key = keyFor({ id: change.appointment.id, ...input });
      return rescheduleAppointment(change.appointment.id, input, key);
    },
    onSuccess: async (_, change) => {
      toast(change.kind === 'move' ? t('toast.moved') : t('toast.resized'));
      setPending(null);
      await invalidateSchedule(queryClient);
    },
    onError: async (error) => {
      const refusal = conflictsOf(error)[0];
      toast(refusal ? words.of(refusal) : apiErrorMessage(error, i18n), { tone: 'danger' });
      setPending(null);
      await invalidateSchedule(queryClient);
    },
  });

  const clock = { timeZone, locale };
  const canDrag = (appointment: Appointment) =>
    abilities(appointment).move && Date.parse(appointment.startsAt) > Date.now();
  const actor = {
    permissions: session?.permissions ?? [],
    profileId: session?.profile?.id ?? null,
  };
  const canBookFor = (dentistId: string) => canWriteAppointment(actor, { dentistId });
  const canBookAny = resources.data?.dentists.some((dentist) => canBookFor(dentist.id)) ?? false;

  const closeSelected = () => {
    setSelected(null);
    if (search.appointment) onSearch({ ...search, appointment: undefined });
  };

  const openPanel = (draft: NewAppointmentDraft) => {
    setSelected(null);
    setPanel(draft);
  };

  const onDay = useCallback(
    (day: string) => {
      onSearch({ ...search, date: day, view: undefined });
    },
    [onSearch, search],
  );

  const onEmptySlot = (column: string | null, start: Date) => {
    if (moving) {
      const dentistId = column ?? moving.dentistId;
      const offer = moveSlots?.get(dentistId)?.get(start.getTime());
      if (!offer) return;
      if (offer.warnings.length > 0 && !canOverride) {
        toast(words.needsOverride, { tone: 'info' });
        return;
      }
      void propose(moving, start, dentistId);
      return;
    }
    // A week column is a day: the filtered dentist if there is one, else the panel asks.
    const dentistId = column ?? search.dentist;
    if (dentistId ? !canBookFor(dentistId) : !canBookAny) return;
    const { date: day, time } = clinicClock(start, timeZone);
    openPanel({ dentistId, date: day, time, durationMin: slotLength });
  };

  return (
    <PanelLayout>
      <div className="flex h-full min-h-0 flex-col px-6 pt-5 pb-3">
        <ScheduleToolbar
          view={view}
          date={date}
          today={today}
          dates={dates}
          locale={locale}
          dentists={resources.data?.dentists ?? []}
          rooms={resources.data?.rooms ?? []}
          search={search}
          slotLength={slotLength}
          canBook={canBookAny}
          onSlotLength={setSlotLength}
          onSearch={onSearch}
          onNew={() => {
            openPanel({ date: date < today ? today : date, durationMin: slotLength });
          }}
        />
        {resources.isSuccess && resources.data.dentists.length === 0 ? (
          <EmptyState title={t('calendar.noDentists')} body={t('calendar.noDentistsBody')} />
        ) : (
          <ScheduleCalendar
            view={view}
            date={date}
            timeZone={timeZone}
            locale={locale}
            rtl={i18n.dir() === 'rtl'}
            dentists={columns}
            events={events}
            hours={hours.data?.days ?? []}
            slotLength={slotLength}
            bounds={bounds}
            canDrag={canDrag}
            moveSlots={moveSlots}
            now={() => new Date()}
            onDate={(next) => {
              onSearch({ ...search, date: next });
            }}
            onDay={onDay}
            onEmptySlot={onEmptySlot}
            onOpen={(appointment, rect) => {
              setSelected({ id: appointment.id, rect });
            }}
            onMove={(appointment, start, dentistId) => {
              if (dentistId !== appointment.dentistId && !canBookFor(dentistId)) return;
              void propose(appointment, start, dentistId);
            }}
            onResize={(appointment, end) => {
              void proposeResize(appointment, end);
            }}
          />
        )}
        {moving ? (
          <div
            role="status"
            className="mt-2 flex items-center gap-3 rounded-lg border border-primary-tint-border bg-primary-tint px-3.5 py-2 text-[13px]"
          >
            <span className="min-w-0 flex-1">
              {t('move.bar', { patient: moving.patient.fullName })}
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setMoving(null);
              }}
            >
              {t('move.stop')}
            </Button>
          </div>
        ) : null}
      </div>
      {selected && selectedAppointment ? (
        <AnchoredPopover rect={selected.rect} label={t('popover.label')} onClose={closeSelected}>
          <AppointmentDetails
            appointment={selectedAppointment}
            rooms={resources.data?.rooms ?? []}
            onClose={closeSelected}
            onReschedule={() => {
              setMoving(selectedAppointment);
              closeSelected();
            }}
            onOpenPatient={() => {
              void navigate({
                to: '/patients/$patientId',
                params: { patientId: selectedAppointment.patient.id },
              });
            }}
            onCompleteRegistration={() => {
              patientNavigation.editPatient(selectedAppointment.patient.id);
            }}
            startVisit={
              <StartVisitPopover
                patientId={selectedAppointment.patient.id}
                preset={{
                  ...(selectedAppointment.visitType ? { type: selectedAppointment.visitType } : {}),
                  planIds: selectedAppointment.planIds,
                  appointmentId: selectedAppointment.id,
                  dentistId: selectedAppointment.dentistId,
                  roomId: selectedAppointment.roomId,
                  reason: selectedAppointment.reason,
                }}
              >
                <Button size="sm" variant="primary">
                  {t('actions.startVisit')}
                </Button>
              </StartVisitPopover>
            }
          />
        </AnchoredPopover>
      ) : null}
      {pending ? (
        <AnchoredPopover
          rect={pending.rect}
          label={t('confirm.label')}
          onClose={() => {
            setPending(null);
          }}
        >
          <p className="m-0 text-[13px] font-semibold">
            {pending.kind === 'move'
              ? t('confirm.move', {
                  patient: pending.appointment.patient.fullName,
                  day: formatCalendarDate(clinicClock(pending.start, timeZone).date, locale),
                  time: formatTime(pending.start, clock),
                  dentist:
                    columns.find((dentist) => dentist.id === pending.dentistId)?.name ??
                    pending.appointment.dentistName,
                })
              : t('confirm.resize', {
                  minutes: minutesBetween(new Date(pending.appointment.startsAt), pending.end),
                })}
          </p>
          {pending.kind === 'move' && pending.dentistId !== pending.appointment.dentistId ? (
            <p className="m-0 mt-1 text-[12.5px] text-ink-secondary">
              {t('confirm.dentistChange', {
                from: pending.appointment.dentistName,
                to: columns.find((dentist) => dentist.id === pending.dentistId)?.name ?? '',
              })}
            </p>
          ) : null}
          {pending.conflicts.length > 0 ? (
            <div className="mt-2">
              <ConflictLines conflicts={pending.conflicts} />
            </div>
          ) : null}
          {pending.conflicts.length > 0 && !canOverride ? (
            <p className="m-0 mt-1.5 text-[12px] text-warning">{words.needsOverride}</p>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setPending(null);
              }}
            >
              {t('confirm.cancel')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={apply.isPending || (pending.conflicts.length > 0 && !canOverride)}
              onClick={() => {
                apply.mutate(pending);
              }}
            >
              {pending.kind === 'move' ? t('confirm.moveAction') : t('confirm.resizeAction')}
            </Button>
          </div>
        </AnchoredPopover>
      ) : null}
      <InPanelSlot>
        {openDraft ? (
          <NewAppointmentPanel
            key={JSON.stringify(openDraft)}
            branchId={branchId}
            draft={openDraft}
            resources={resources.data ?? { dentists: [], rooms: [] }}
            onClose={closePanel}
            onBooked={(day) => {
              setPanel(null);
              onSearch({ ...search, date: day, book: undefined, bookFor: undefined });
            }}
          />
        ) : null}
      </InPanelSlot>
    </PanelLayout>
  );
}
