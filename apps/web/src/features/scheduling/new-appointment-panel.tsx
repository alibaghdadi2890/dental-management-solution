import {
  type Appointment,
  canWriteAppointment,
  type AppointmentConflict,
  type FollowUp,
  type PatientCreateInput,
  patientListQuerySchema,
  REASON_CHIPS,
  type ReasonChipKey,
  type ScheduleResources,
  SLOT_LENGTHS,
  VISIT_TYPES,
  type VisitType,
} from '@dcm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, Select, TextInput } from '@/components/ui/field';
import { RightPanel } from '@/components/ui/right-panel';
import { useToast } from '@/components/ui/toast-context';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import {
  createPatient,
  duplicateCheckQuery,
  invalidatePatientData,
  patientListQuery,
} from '@/features/patients/patients-api';
import { ApiError } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-error-message';
import { formatTime } from '@/lib/format';
import { useIdempotencyKeys } from '@/lib/idempotency';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { cn } from '@/lib/utils';
import { ConflictLines } from './conflict-lines';
import { useConflictWords } from './conflict-words';
import { clinicClock, instantOf } from './schedule-time';
import {
  bookAppointment,
  checkAppointment,
  editAppointment,
  invalidateSchedule,
  patientFollowUpsQuery,
  schedulingKeys,
} from './scheduling-api';

export interface PanelPatient {
  id: string;
  fullName: string;
  meta: string;
}

/** What the panel opens with: an empty slot, a record, or a follow-up (A11). */
export interface NewAppointmentDraft {
  patient?: PanelPatient | undefined;
  dentistId?: string | undefined;
  date: string;
  time?: string | undefined;
  durationMin?: number | undefined;
  /** Edit mode (ADR-0075): the appointment whose fields the panel starts from. */
  editing?: Appointment | undefined;
}

const minutesLong = (appointment: Appointment) =>
  (Date.parse(appointment.endsAt) - Date.parse(appointment.startsAt)) / 60_000;

interface PanelFields {
  reason: string;
  visitType: VisitType | '';
  durationMin: number;
  dentistId: string | undefined;
  date: string;
  time: string;
  roomId: string;
  confirmed: boolean;
}

/** The panel's fields, from the draft or from the appointment it edits. */
function initialFields(
  draft: NewAppointmentDraft,
  timeZone: string,
  rooms: ScheduleResources['rooms'],
): PanelFields {
  const { editing } = draft;
  if (!editing) {
    return {
      reason: '',
      visitType: '',
      durationMin: draft.durationMin ?? 30,
      dentistId: draft.dentistId,
      date: draft.date,
      time: draft.time ?? '09:00',
      roomId: 'auto',
      confirmed: true,
    };
  }
  const start = clinicClock(editing.startsAt, timeZone);
  return {
    reason: editing.reason,
    visitType: editing.visitType ?? '',
    durationMin: minutesLong(editing),
    dentistId: editing.dentistId,
    date: start.date,
    time: start.time,
    // A room since closed reads as Auto; one left for check-in stays so.
    roomId: editing.roomAuto
      ? 'auto'
      : editing.roomId === null
        ? 'none'
        : rooms.some((room) => room.id === editing.roomId)
          ? editing.roomId
          : 'auto',
    // A moved appointment starts unconfirmed: the box is ticked again on the phone (feature 14).
    confirmed: false,
  };
}

const TIMES = Array.from({ length: 24 * 4 }, (_, index) => {
  const hour = String(Math.floor(index / 4)).padStart(2, '0');
  return `${hour}:${String((index % 4) * 15).padStart(2, '0')}`;
});

const splitName = (text: string) => {
  const [first = '', ...rest] = text.trim().split(/\s+/);
  return { first, last: rest.join(' ') };
};

/** The inline quick patient (A11, G2): first name, last name, phone, optional date of birth. */
function QuickPatient({
  typed,
  onCreated,
  onCancel,
}: {
  typed: string;
  onCreated: (patient: PanelPatient) => void;
  onCancel: () => void;
}) {
  const { t, i18n } = useTranslation('scheduling');
  const queryClient = useQueryClient();
  const keyFor = useIdempotencyKeys();
  const initial = splitName(typed);
  const [first, setFirst] = useState(initial.first);
  const [last, setLast] = useState(initial.last);
  const [phone, setPhone] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const fullName = `${first.trim()} ${last.trim()}`.trim();
  const debouncedName = useDebouncedValue(fullName, 300);
  const debouncedPhone = useDebouncedValue(phone.trim(), 300);
  const twins = useQuery({
    ...duplicateCheckQuery({
      fullName: debouncedName,
      dateOfBirth: dateOfBirth || undefined,
      phone: debouncedPhone || undefined,
      excludeId: undefined,
    }),
    enabled: debouncedName !== '',
  });
  const create = useMutation({
    mutationFn: (input: PatientCreateInput) => createPatient(input, keyFor(input)),
    onSuccess: (patient) => {
      void invalidatePatientData(queryClient, patient.id);
      onCreated({
        id: patient.id,
        fullName: patient.fullName,
        meta: `${patient.displayNumber} · ${patient.phone ?? ''}`,
      });
    },
  });
  const ready = fullName !== '' && phone.trim() !== '';
  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg border border-border p-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label={t('quick.firstName')}>
          {(field) => (
            <TextInput
              {...field}
              value={first}
              onChange={(event) => {
                setFirst(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={t('quick.lastName')}>
          {(field) => (
            <TextInput
              {...field}
              value={last}
              onChange={(event) => {
                setLast(event.target.value);
              }}
            />
          )}
        </Field>
      </div>
      <Field label={t('quick.phone')}>
        {(field) => (
          <TextInput
            {...field}
            value={phone}
            inputMode="tel"
            onChange={(event) => {
              setPhone(event.target.value);
            }}
          />
        )}
      </Field>
      <Field label={t('quick.dateOfBirth')}>
        {(field) => (
          <TextInput
            {...field}
            type="date"
            value={dateOfBirth}
            onChange={(event) => {
              setDateOfBirth(event.target.value);
            }}
          />
        )}
      </Field>
      {twins.data && twins.data.length > 0 ? (
        <div className="rounded-md border border-warning-border bg-warning-bg p-2 text-[12px] text-warning-ink">
          <p className="m-0 mb-1">{t('quick.matches')}</p>
          {twins.data.map((twin) => (
            <button
              key={twin.id}
              type="button"
              className="block w-full cursor-pointer border-none bg-transparent p-0 py-0.5 text-start text-primary hover:underline"
              onClick={() => {
                onCreated({
                  id: twin.id,
                  fullName: twin.fullName,
                  meta: `${twin.displayNumber} · ${twin.phone ?? ''}`,
                });
              }}
            >
              {twin.fullName} · {twin.phone ?? twin.displayNumber}
            </button>
          ))}
        </div>
      ) : null}
      {create.isError ? (
        <p role="alert" className="m-0 text-[12px] text-danger">
          {apiErrorMessage(create.error, i18n)}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onCancel}>
          {t('quick.cancel')}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={!ready || create.isPending}
          onClick={() => {
            create.mutate({
              fullName,
              phone: phone.trim(),
              dateOfBirth: dateOfBirth || null,
              registrationIncomplete: true,
            });
          }}
        >
          {t('quick.create')}
        </Button>
      </div>
    </div>
  );
}

/** A label over several controls: `Field` is one control and its label. */
function PanelGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="m-0 mb-1.5 text-xs leading-none font-medium text-ink-secondary">{label}</p>
      {children}
    </div>
  );
}

function PatientPicker({ onPick }: { onPick: (patient: PanelPatient) => void }) {
  const { t } = useTranslation('scheduling');
  const canCreate = usePermission('patient:write');
  const [q, setQ] = useState('');
  const [quick, setQuick] = useState(false);
  const debounced = useDebouncedValue(q.trim(), 200);
  const results = useQuery({
    ...patientListQuery(patientListQuerySchema.parse({ q: debounced, size: 10 })),
    enabled: debounced !== '',
  });
  const rows = results.data?.items ?? [];
  const noMatch = debounced !== '' && results.isSuccess && rows.length === 0;
  return (
    <>
      <TextInput
        value={q}
        placeholder={t('panel.patientSearch')}
        aria-label={t('panel.patientSearch')}
        autoComplete="off"
        maxLength={100}
        onChange={(event) => {
          setQ(event.target.value);
          setQuick(false);
        }}
      />
      {rows.length > 0 ? (
        <ul className="m-0 mt-1 list-none rounded-md border border-border p-0">
          {rows.map((patient) => (
            <li key={patient.id}>
              <button
                type="button"
                className="block w-full cursor-pointer border-none bg-transparent px-2.5 py-1.5 text-start text-[12.5px] hover:bg-sunken"
                onClick={() => {
                  onPick({
                    id: patient.id,
                    fullName: patient.fullName,
                    meta: `${patient.displayNumber} · ${patient.phone ?? ''}`,
                  });
                }}
              >
                {patient.fullName}
                <span className="ms-2 text-ink-muted">{patient.displayNumber}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {noMatch && canCreate && !quick ? (
        <Button
          size="sm"
          variant="secondary"
          className="mt-2"
          onClick={() => {
            setQuick(true);
          }}
        >
          {t('panel.newPatient', { name: q.trim() })}
        </Button>
      ) : null}
      {noMatch && !canCreate ? (
        <p className="m-0 mt-1 text-[12px] text-ink-muted">{t('panel.noMatch')}</p>
      ) : null}
      {quick ? (
        <QuickPatient
          typed={q}
          onCreated={onPick}
          onCancel={() => {
            setQuick(false);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * The design's right panel (A11). `Idempotency-Key` on booking. With `draft.editing` it is the Edit
 * appointment panel (ADR-0075): the patient is fixed, and a new start or dentist is a move.
 */
export function NewAppointmentPanel({
  branchId,
  draft,
  resources,
  onClose,
  onBooked,
}: {
  branchId: string;
  draft: NewAppointmentDraft;
  resources: ScheduleResources;
  onClose: () => void;
  onBooked: (date: string) => void;
}) {
  const { t, i18n } = useTranslation('scheduling');
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const keyFor = useIdempotencyKeys();
  const timeZone = session?.tenant?.timeZone ?? 'UTC';
  const profileId = session?.profile?.id ?? null;
  const actor = { permissions: session?.permissions ?? [], profileId };
  const writable = resources.dentists.filter((dentist) =>
    canWriteAppointment(actor, { dentistId: dentist.id }),
  );
  const { editing } = draft;
  const [initial] = useState(() => initialFields(draft, timeZone, resources.rooms));
  const [patient, setPatient] = useState(
    draft.patient ??
      (editing
        ? {
            id: editing.patient.id,
            fullName: editing.patient.fullName,
            meta: editing.patient.displayNumber,
          }
        : null),
  );
  const [reason, setReason] = useState(initial.reason);
  const [visitType, setVisitType] = useState<VisitType | ''>(initial.visitType);
  const [durationMin, setDurationMin] = useState(initial.durationMin);
  const [dentistId, setDentistId] = useState(
    initial.dentistId ?? (writable.length === 1 ? writable[0]?.id : undefined) ?? '',
  );
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [roomId, setRoomId] = useState(initial.roomId);
  const [ticked, setConfirmed] = useState(initial.confirmed);
  const [followUp, setFollowUp] = useState<FollowUp | null>(null);
  const canOverride = session?.permissions.includes('appointment:override') ?? false;
  const words = useConflictWords();

  const startsAt = instantOf(date, time, timeZone).toISOString();
  const moved =
    editing !== undefined &&
    (dentistId !== editing.dentistId || Date.parse(startsAt) !== Date.parse(editing.startsAt));
  // Confirmed and staying put: it stays confirmed, there is no unconfirming.
  const keepsConfirmed = editing?.status === 'confirmed' && !moved;
  const confirmed = keepsConfirmed || ticked;
  const unchanged =
    editing !== undefined &&
    !moved &&
    reason.trim() === initial.reason &&
    visitType === initial.visitType &&
    durationMin === initial.durationMin &&
    roomId === initial.roomId &&
    confirmed === (editing.status === 'confirmed');
  const durations = [...new Set([...SLOT_LENGTHS, initial.durationMin])].sort((a, b) => a - b);
  const times = TIMES.includes(initial.time) ? TIMES : [...TIMES, initial.time].sort();
  /** A new date, time or dentist is a move: unconfirmed until the box is ticked again. */
  const move = (change: () => void) => {
    change();
    if (editing) setConfirmed(false);
  };
  const check = useQuery({
    queryKey: [
      ...schedulingKeys.all(session?.tenant?.id ?? null),
      'check',
      {
        branchId,
        dentistId,
        patientId: patient?.id,
        startsAt,
        durationMin,
        roomId,
        editing: editing?.id,
      },
    ],
    queryFn: () =>
      checkAppointment({
        branchId,
        dentistId,
        patientId: patient?.id,
        startsAt,
        durationMin,
        roomId,
        ...(editing ? { ignoreAppointmentId: editing.id } : {}),
      }),
    enabled: dentistId !== '',
    staleTime: 0,
  });
  // An edit that keeps its time keeps the warnings it was booked through: only a clash is new.
  const sameSpan = editing !== undefined && !moved && durationMin === initial.durationMin;
  const conflicts: AppointmentConflict[] = (check.data?.conflicts ?? []).filter(
    (conflict) => conflict.hard || !sameSpan,
  );
  const hard = conflicts.some((conflict) => conflict.hard);
  const soft = conflicts.some((conflict) => !conflict.hard);
  const awaiting = useQuery({
    ...patientFollowUpsQuery(patient?.id ?? ''),
    enabled: patient !== null && !editing,
    select: (rows) => rows.find((row) => row.status === 'awaiting' && !row.expired) ?? null,
  });

  const book = useMutation({
    mutationFn: () => {
      if (editing) {
        const changes = {
          dentistId,
          startsAt,
          durationMin,
          reason: reason.trim(),
          visitType: visitType || null,
          roomId,
          confirmed,
          override: soft && canOverride,
        };
        return editAppointment(editing.id, changes, keyFor({ id: editing.id, ...changes }));
      }
      const input = {
        branchId,
        patientId: patient?.id ?? '',
        dentistId,
        startsAt,
        durationMin,
        reason: reason.trim(),
        visitType: visitType || null,
        roomId,
        confirmed,
        override: soft && canOverride,
        planIds: followUp?.planIds ?? [],
        ...(followUp ? { followUpId: followUp.id } : {}),
      };
      return bookAppointment(input, keyFor(input));
    },
    onSuccess: async () => {
      toast(editing ? t('toast.edited') : t('toast.booked'));
      await invalidateSchedule(queryClient);
      onBooked(date);
    },
    onError: () => invalidateSchedule(queryClient),
  });

  const blockedByOverride = soft && !canOverride;
  const disabled =
    !patient ||
    !dentistId ||
    reason.trim() === '' ||
    hard ||
    blockedByOverride ||
    check.isFetching ||
    book.isPending ||
    unchanged;

  const pickChip = (key: ReasonChipKey, visit: VisitType | null) => {
    setReason(t(`reasons.${key}`));
    setVisitType(visit ?? '');
  };
  const takeFollowUp = (row: FollowUp) => {
    setFollowUp(row);
    setReason(row.title);
    setDurationMin(row.durationMin);
    if (row.preferredDentistId && row.preferredDentistAvailable) {
      setDentistId(row.preferredDentistId);
    }
  };
  const roomNote = (() => {
    const room = check.data?.room;
    if (!room || roomId !== 'auto') return null;
    if (room.roomName === null) return t('panel.roomAtCheckIn');
    if (room.isUsual || room.usualRoomName === null) return room.roomName;
    return t('panel.usualInUse', { room: room.roomName, usual: room.usualRoomName });
  })();

  return (
    <RightPanel
      title={editing ? t('panel.editTitle') : t('panel.title')}
      dirty={false}
      onClose={onClose}
      closeDisabled={book.isPending}
      footer={
        <>
          <Button
            variant="primary"
            disabled={disabled}
            onClick={() => {
              book.mutate();
            }}
          >
            {editing ? t('panel.save') : t('panel.confirm')}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t('panel.cancel')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <PanelGroup label={t('panel.patient')}>
          {patient ? (
            <div className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{patient.fullName}</span>
                <span className="block truncate text-[11.5px] text-ink-muted">{patient.meta}</span>
              </span>
              {editing ? null : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setPatient(null);
                    setFollowUp(null);
                  }}
                >
                  {t('panel.change')}
                </Button>
              )}
            </div>
          ) : (
            <PatientPicker onPick={setPatient} />
          )}
        </PanelGroup>
        {awaiting.data && !followUp ? (
          <div className="rounded-md border border-primary-tint-border bg-primary-tint p-2.5 text-[12.5px]">
            <p className="m-0 font-medium">{awaiting.data.title}</p>
            <p className="m-0 mt-0.5 text-ink-secondary">
              {t('panel.followUpWaiting', { dentist: awaiting.data.recommendedByName })}
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-1.5"
              onClick={() => {
                if (awaiting.data) takeFollowUp(awaiting.data);
              }}
            >
              {t('panel.bookFollowUp')}
            </Button>
          </div>
        ) : null}
        <PanelGroup label={t('panel.reason')}>
          <TextInput
            value={reason}
            aria-label={t('panel.reason')}
            maxLength={200}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
          <div className="mt-1.5 flex flex-wrap gap-1">
            {REASON_CHIPS.map((chip) => (
              <button
                key={chip.key}
                type="button"
                className="h-[26px] cursor-pointer rounded-full border border-border-control bg-surface px-2.5 text-[12px] hover:border-primary"
                onClick={() => {
                  pickChip(chip.key, chip.visitType);
                }}
              >
                {t(`reasons.${chip.key}`)}
              </button>
            ))}
          </div>
        </PanelGroup>
        <Field label={t('panel.visitType')}>
          {(field) => (
            <Select
              {...field}
              value={visitType}
              onChange={(event) => {
                setVisitType(event.target.value as VisitType | '');
              }}
            >
              <option value="">{t('panel.noType')}</option>
              {VISIT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`visitTypes.${type}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <PanelGroup label={t('panel.duration')}>
          <div role="group" className="flex flex-wrap gap-1">
            {durations.map((minutes) => (
              <button
                key={minutes}
                type="button"
                aria-pressed={durationMin === minutes}
                className={cn(
                  'h-[30px] cursor-pointer rounded-md border px-2.5 text-[12.5px]',
                  durationMin === minutes
                    ? 'border-primary bg-primary-tint font-semibold text-primary'
                    : 'border-border-control bg-surface',
                )}
                onClick={() => {
                  setDurationMin(minutes);
                }}
              >
                {t('panel.minutes', { count: minutes })}
              </button>
            ))}
          </div>
        </PanelGroup>
        <PanelGroup label={t('panel.dentist')}>
          <div role="group" className="flex flex-wrap gap-1">
            {writable.map((dentist) => (
              <button
                key={dentist.id}
                type="button"
                aria-pressed={dentistId === dentist.id}
                className={cn(
                  'h-[34px] cursor-pointer rounded-lg border px-2.5 text-[12.5px]',
                  dentistId === dentist.id
                    ? 'border-primary bg-primary-tint font-semibold text-primary'
                    : 'border-border-control bg-surface',
                )}
                onClick={() => {
                  move(() => {
                    setDentistId(dentist.id);
                  });
                }}
              >
                {dentist.name}
              </button>
            ))}
          </div>
        </PanelGroup>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('panel.date')}>
            {(field) => (
              <TextInput
                {...field}
                type="date"
                value={date}
                onChange={(event) => {
                  const next = event.target.value;
                  if (next) {
                    move(() => {
                      setDate(next);
                    });
                  }
                }}
              />
            )}
          </Field>
          <Field label={t('panel.time')}>
            {(field) => (
              <Select
                {...field}
                value={time}
                onChange={(event) => {
                  const next = event.target.value;
                  move(() => {
                    setTime(next);
                  });
                }}
              >
                {times.map((value) => (
                  <option key={value} value={value}>
                    {formatTime(instantOf(date, value, timeZone), {
                      timeZone,
                      locale: i18n.language,
                    })}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label={t('panel.room')} hint={roomNote ?? undefined}>
          {(field) => (
            <Select
              {...field}
              value={roomId}
              onChange={(event) => {
                setRoomId(event.target.value);
              }}
            >
              <option value="auto">{t('panel.roomAuto')}</option>
              {editing ? <option value="none">{t('panel.roomAtCheckIn')}</option> : null}
              {resources.rooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {conflicts.length > 0 ? <ConflictLines conflicts={conflicts} /> : null}
        {blockedByOverride && !hard ? (
          <p className="m-0 text-[12px] text-warning">{words.needsOverride}</p>
        ) : null}
        <label className="flex cursor-pointer items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={confirmed}
            disabled={keepsConfirmed}
            onChange={(event) => {
              setConfirmed(event.target.checked);
            }}
          />
          {t('panel.confirmed')}
        </label>
        {book.isError ? (
          <p role="alert" className="m-0 text-[12.5px] text-danger">
            {book.error instanceof ApiError && book.error.code === 'appointment.conflict'
              ? t('errors.conflict')
              : apiErrorMessage(book.error, i18n)}
          </p>
        ) : null}
      </div>
    </RightPanel>
  );
}
