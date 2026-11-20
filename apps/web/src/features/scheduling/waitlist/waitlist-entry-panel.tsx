import {
  canWriteAppointment,
  REASON_CHIPS,
  SLOT_LENGTHS,
  VISIT_TYPES,
  type VisitType,
  type WaitlistEntry,
  type WaitlistSource,
  waitlistUntilDefault,
  waitlistUntilMax,
} from '@dcm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Field, Select, TextInput } from '@/components/ui/field';
import { RightPanel } from '@/components/ui/right-panel';
import { useToast } from '@/components/ui/toast-context';
import { useSession } from '@/features/auth/session';
import { usePermission } from '@/features/auth/use-permission';
import { ApiError } from '@/lib/api';
import { apiErrorMessage } from '@/lib/api-error-message';
import { todayIn } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type PanelPatient, PatientPicker } from '../new-appointment-panel';
import { invalidateSchedule, openingHoursQuery, resourcesQuery } from '../scheduling-api';
import {
  addToWaitlist,
  patientWaitlistQuery,
  updateWaitlistEntry,
  waitingWithout,
} from './waitlist-api';
import { BeforeLine, WishesFields } from './wishes';
import {
  EMPTY_WISHES,
  type WishesState,
  wishesInput,
  wishesState,
  wishesValid,
} from './wishes-state';

/** What the panel opens with: pre-filled from where it was opened, or an entry to edit. */
export interface WaitlistEntryDraft {
  source: WaitlistSource;
  patient?: PanelPatient | undefined;
  /** Null is *Any dentist*; left out, the caller's own column when they have only one. */
  dentistId?: string | null | undefined;
  reason?: string | undefined;
  visitType?: VisitType | null | undefined;
  durationMin?: number | undefined;
  planIds?: readonly string[] | undefined;
  followUpId?: string | undefined;
  wishes?: WishesState | undefined;
  /** Edits this entry instead of adding one. */
  entry?: WaitlistEntry | undefined;
}

interface Fields {
  dentistId: string | null | undefined;
  reason: string;
  visitType: VisitType | '';
  durationMin: number;
  until: string;
  wishes: WishesState;
}

const fieldsOf = (draft: WaitlistEntryDraft, today: string): Fields => {
  const { entry } = draft;
  if (entry) {
    return {
      dentistId: entry.dentistId,
      reason: entry.reason,
      visitType: entry.visitType ?? '',
      durationMin: entry.durationMin,
      until: entry.until,
      wishes: wishesState(entry.wishes, entry),
    };
  }
  return {
    dentistId: draft.dentistId,
    reason: draft.reason ?? '',
    visitType: draft.visitType ?? '',
    durationMin: draft.durationMin ?? 30,
    until: waitlistUntilDefault(today),
    wishes: draft.wishes ?? EMPTY_WISHES,
  };
};

/**
 * *Add to waitlist* and *Edit waitlist entry* (A4, S2): a modal right panel over any page. The
 * patient waits with no appointment: dentist or *Any dentist*, reason, type, duration, wishes and
 * *Until*. Editing an entry with an appointment changes its wishes only; the rest is the
 * appointment's. Adding a patient who already waits opens that entry instead.
 */
export function WaitlistEntryPanel({
  draft,
  onClose,
}: {
  draft: WaitlistEntryDraft;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation('scheduling');
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const canAll = usePermission('appointment:write_all');
  const branchId = draft.entry?.branchId ?? session?.branch?.id ?? '';
  const today = todayIn(session?.tenant?.timeZone ?? 'UTC');
  const resources = useQuery(resourcesQuery(branchId));
  const hours = useQuery(openingHoursQuery(branchId));
  const [editing, setEditing] = useState<WaitlistEntry | undefined>(draft.entry);
  const [patient, setPatient] = useState<PanelPatient | null>(
    draft.patient ??
      (draft.entry
        ? {
            id: draft.entry.patient.id,
            fullName: draft.entry.patient.fullName,
            meta: draft.entry.patient.displayNumber,
          }
        : null),
  );
  const [fields, setFields] = useState(() => fieldsOf(draft, today));
  const existing = useQuery({
    ...patientWaitlistQuery(patient?.id ?? '', editing === undefined),
    select: waitingWithout,
  });
  // Adding a patient who already waits opens that entry (A1).
  if (!editing && existing.data) {
    setEditing(existing.data);
    setFields(fieldsOf({ source: draft.source, entry: existing.data }, today));
  }
  const actor = {
    permissions: session?.permissions ?? [],
    profileId: session?.profile?.id ?? null,
  };
  const writable = (resources.data?.dentists ?? []).filter((dentist) =>
    canWriteAppointment(actor, { dentistId: dentist.id }),
  );
  // A pre-filled dentist counts only when the caller may name them; *Any* needs every column.
  const allowed = (id: string | null) =>
    id === null ? canAll : writable.some((dentist) => dentist.id === id);
  const dentistId =
    fields.dentistId !== undefined && allowed(fields.dentistId)
      ? fields.dentistId
      : writable.length === 1
        ? (writable[0]?.id ?? null)
        : undefined;
  const withAppointment = editing?.appointment ?? null;
  const set = (patch: Partial<Fields>) => {
    setFields((current) => ({ ...current, ...patch }));
  };

  const save = useMutation({
    mutationFn: () => {
      const wishes = wishesInput(fields.wishes);
      if (editing) {
        return updateWaitlistEntry(editing.id, {
          wishes,
          ...(withAppointment
            ? {}
            : {
                dentistId: dentistId ?? null,
                reason: fields.reason.trim(),
                visitType: fields.visitType || null,
                durationMin: fields.durationMin,
                until: fields.until,
              }),
        });
      }
      return addToWaitlist({
        branchId,
        patientId: patient?.id ?? '',
        dentistId: dentistId ?? null,
        reason: fields.reason.trim(),
        visitType: fields.visitType || null,
        durationMin: fields.durationMin,
        until: fields.until,
        planIds: [...(draft.planIds ?? [])],
        ...(draft.followUpId ? { followUpId: draft.followUpId } : {}),
        wishes,
        source: draft.source,
      });
    },
    onSuccess: async () => {
      toast(editing ? t('waitlist.toast.saved') : t('waitlist.toast.added'));
      await invalidateSchedule(queryClient);
      onClose();
    },
    onError: () => invalidateSchedule(queryClient),
  });

  const ready =
    patient !== null &&
    (withAppointment !== null ||
      (dentistId !== undefined && fields.reason.trim() !== '' && fields.until >= today)) &&
    wishesValid(fields.wishes) &&
    !save.isPending;
  const openWeekdays = new Set(
    (hours.data?.days ?? []).filter((day) => day.isOpen).map((day) => day.weekday),
  );
  const durations = [...new Set([...SLOT_LENGTHS, fields.durationMin])].sort((a, b) => a - b);

  return (
    <>
      <div
        className="fixed inset-0 z-40 animate-fadein bg-[rgba(27,26,31,.28)]"
        aria-hidden
        onClick={onClose}
      />
      <RightPanel
        modal
        title={editing ? t('waitlist.editTitle') : t('waitlist.addTitle')}
        dirty={false}
        onClose={onClose}
        closeDisabled={save.isPending}
        className="fixed inset-y-0 end-0 z-40 w-[460px] max-w-full shadow-[-12px_0_32px_rgba(27,26,31,.12)]"
        footer={
          <>
            <Button
              variant="primary"
              disabled={!ready}
              onClick={() => {
                save.mutate();
              }}
            >
              {editing ? t('waitlist.save') : t('waitlist.add')}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              {t('panel.cancel')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3.5">
          <div>
            <p className="m-0 mb-1.5 text-xs leading-none font-medium text-ink-secondary">
              {t('panel.patient')}
            </p>
            {patient ? (
              <div className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{patient.fullName}</span>
                  <span className="block truncate text-[11.5px] text-ink-muted">
                    {patient.meta}
                  </span>
                </span>
                {editing || draft.patient ? null : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setPatient(null);
                    }}
                  >
                    {t('panel.change')}
                  </Button>
                )}
              </div>
            ) : (
              <PatientPicker onPick={setPatient} />
            )}
          </div>
          {withAppointment ? (
            <p className="m-0 text-[12.5px] text-ink-secondary">
              {editing?.reason} · {withAppointment.dentistName}
            </p>
          ) : (
            <>
              <div>
                <p className="m-0 mb-1.5 text-xs leading-none font-medium text-ink-secondary">
                  {t('panel.dentist')}
                </p>
                <div role="group" aria-label={t('panel.dentist')} className="flex flex-wrap gap-1">
                  {[
                    ...(canAll ? [{ id: null, name: t('waitlist.anyDentist') }] : []),
                    ...writable,
                  ].map((dentist) => (
                    <button
                      key={dentist.id ?? 'any'}
                      type="button"
                      aria-pressed={dentistId === dentist.id}
                      className={cn(
                        'h-[34px] cursor-pointer rounded-lg border px-2.5 text-[12.5px]',
                        dentistId === dentist.id
                          ? 'border-primary bg-primary-tint font-semibold text-primary'
                          : 'border-border-control bg-surface',
                      )}
                      onClick={() => {
                        set({ dentistId: dentist.id });
                      }}
                    >
                      {dentist.name}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="m-0 mb-1.5 text-xs leading-none font-medium text-ink-secondary">
                  {t('panel.reason')}
                </p>
                <TextInput
                  value={fields.reason}
                  aria-label={t('panel.reason')}
                  maxLength={200}
                  onChange={(event) => {
                    set({ reason: event.target.value });
                  }}
                />
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {REASON_CHIPS.map((chip) => (
                    <button
                      key={chip.key}
                      type="button"
                      className="h-[26px] cursor-pointer rounded-full border border-border-control bg-surface px-2.5 text-[12px] hover:border-primary"
                      onClick={() => {
                        set({ reason: t(`reasons.${chip.key}`), visitType: chip.visitType ?? '' });
                      }}
                    >
                      {t(`reasons.${chip.key}`)}
                    </button>
                  ))}
                </div>
              </div>
              <Field label={t('panel.visitType')}>
                {(field) => (
                  <Select
                    {...field}
                    value={fields.visitType}
                    onChange={(event) => {
                      set({ visitType: event.target.value as VisitType | '' });
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
              <div>
                <p className="m-0 mb-1.5 text-xs leading-none font-medium text-ink-secondary">
                  {t('panel.duration')}
                </p>
                <div role="group" aria-label={t('panel.duration')} className="flex flex-wrap gap-1">
                  {durations.map((minutes) => (
                    <button
                      key={minutes}
                      type="button"
                      aria-pressed={fields.durationMin === minutes}
                      className={cn(
                        'h-[30px] cursor-pointer rounded-md border px-2.5 text-[12.5px]',
                        fields.durationMin === minutes
                          ? 'border-primary bg-primary-tint font-semibold text-primary'
                          : 'border-border-control bg-surface',
                      )}
                      onClick={() => {
                        set({ durationMin: minutes });
                      }}
                    >
                      {t('panel.minutes', { count: minutes })}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
          <WishesFields
            value={fields.wishes}
            openWeekdays={openWeekdays}
            onChange={(wishes) => {
              set({ wishes });
            }}
            until={
              withAppointment ? (
                <BeforeLine date={withAppointment.localDate} />
              ) : (
                <Field label={t('waitlist.until')}>
                  {(field) => (
                    <TextInput
                      {...field}
                      type="date"
                      value={fields.until}
                      min={today}
                      max={waitlistUntilMax(today)}
                      onChange={(event) => {
                        if (event.target.value) set({ until: event.target.value });
                      }}
                    />
                  )}
                </Field>
              )
            }
          />
          {save.isError ? (
            <p role="alert" className="m-0 text-[12.5px] text-danger">
              {save.error instanceof ApiError && save.error.code === 'waitlist.entry_exists'
                ? t('waitlist.alreadyWaiting')
                : apiErrorMessage(save.error, i18n)}
            </p>
          ) : null}
        </div>
      </RightPanel>
    </>
  );
}
