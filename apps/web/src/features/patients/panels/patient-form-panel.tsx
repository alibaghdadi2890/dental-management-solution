import type { Patient, Session } from '@dcm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/field';
import { RightPanel } from '@/components/ui/right-panel';
import { useToast } from '@/components/ui/toast-context';
import { type GuardLocation, UnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { usePermission } from '@/features/auth/use-permission';
import { createWithOpeningBalance } from '@/features/billing/billing-api';
import { formatCalendarDate, todayIn } from '@/lib/format';
import { type PatientPanel, parsePatientsSearch } from '../list-query';
import {
  amountValue,
  emptyForm,
  fromPatient,
  isDirty,
  isEditDirty,
  type PatientFormPrefill,
  pendingExclusions,
  toCreatePayload,
  toOpeningBalance,
  toPatchPayload,
  wantsOpeningBalance,
} from '../patient-form';
import { PatientField, type PatientFieldName } from '../patient-form-fields';
import { usePatientNavigation } from '../patient-navigation';
import { createPatient, invalidatePatientData, patientQuery, updatePatient } from '../patients-api';
import { usePatientForm } from '../use-patient-form';
import { AccountFields } from './account-fields';
import { CurrentContactsSection, PendingContactsSection } from './contacts-section';
import { FAILURE_VALUES, failureOf, fieldErrorsOf, type SentContext } from './form-server-errors';
import { LinkChip, LinkOffer } from './link-offer';
import { PanelFallback } from './panel-fallback';
import { useDuplicateTwin } from './use-duplicate-twin';
import { useLinkOffer } from './use-link-offer';

type Tenant = NonNullable<Session['tenant']>;

export type FormMode =
  | { kind: 'new'; prefill: { fullName?: string | undefined; phone?: string | undefined } }
  | { kind: 'edit'; id: string };

/** What identifies the open form: the URL's panel, plus the create pre-fill (history state). */
const formKeyOf = ({ search, state }: GuardLocation) => {
  const { panel } = parsePatientsSearch(search);
  const prefill = state.patientPrefill;
  return JSON.stringify([panel ?? '', prefill?.fullName ?? '', prefill?.phone ?? '']);
};

/** A form held in the URL search is left when that panel changes (another panel, or a new
 * pre-fill), not only when the path does. */
const leavesForm = (current: GuardLocation, next: GuardLocation) =>
  current.pathname !== next.pathname || formKeyOf(current) !== formKeyOf(next);

/**
 * Create / Edit patient (design §Right panel, `Patients.dc.html` form, workspace spec §Screen 2
 * styling): Full name* and Phone* up front (the phone optional while the date of birth makes the
 * patient a minor, design addendum C3) — on create, with the offer to link a contact whose phone
 * it is (C4) — then the contacts (the Guardian block for a minor, "Contacts & family" for an
 * adult: pending links sent with the create, or, when editing, immediate actions, C5), the
 * optional details demoted below, and — create only, with `payment:write` — the Account group's
 * opening balance (design Q1).
 */
export function PatientFormPanel({
  mode,
  tenant,
  onClose,
  onOpen,
}: {
  mode: FormMode;
  tenant: Tenant;
  onClose: () => void;
  onOpen: (panel: PatientPanel) => void;
}) {
  if (mode.kind === 'new') {
    return <PatientForm prefill={mode.prefill} tenant={tenant} onClose={onClose} onOpen={onOpen} />;
  }
  return <EditPatient id={mode.id} tenant={tenant} onClose={onClose} onOpen={onOpen} />;
}

/**
 * Loads the patient to edit. A patient already archived when the panel opens can't be edited; one
 * archived by someone else while the form is open keeps the form (and its edits) with a warning —
 * saving then fails with a clear message instead of the edits vanishing.
 */
function EditPatient({
  id,
  tenant,
  onClose,
  onOpen,
}: {
  id: string;
  tenant: Tenant;
  onClose: () => void;
  onOpen: (panel: PatientPanel) => void;
}) {
  const { t } = useTranslation('patients');
  const patient = useQuery(patientQuery(id));
  const [archivedAtOpen, setArchivedAtOpen] = useState<boolean | null>(null);
  if (patient.data && archivedAtOpen === null) {
    setArchivedAtOpen(patient.data.archivedAt !== null);
  }

  if (!patient.data) {
    return (
      <PanelFallback
        eyebrow={t('form.editEyebrow')}
        error={patient.error}
        onRetry={() => void patient.refetch()}
        onClose={onClose}
      />
    );
  }
  if (archivedAtOpen === true) {
    return (
      <RightPanel
        eyebrow={t('form.editEyebrow')}
        title={patient.data.fullName}
        dirty={false}
        onClose={onClose}
      >
        <p role="alert" className="text-[13px] leading-normal text-ink-secondary">
          {t('form.archived')}
        </p>
      </RightPanel>
    );
  }
  return (
    <PatientForm
      key={patient.data.id}
      patient={patient.data}
      tenant={tenant}
      onClose={onClose}
      onOpen={onOpen}
    />
  );
}

function PatientForm({
  patient,
  prefill,
  tenant,
  onClose,
  onOpen,
}: {
  /** Absent when creating. */
  patient?: Patient;
  prefill?: PatientFormPrefill;
  tenant: Tenant;
  onClose: () => void;
  onOpen: (panel: PatientPanel) => void;
}) {
  const { t, i18n } = useTranslation(['patients', 'common']);
  const locale = i18n.resolvedLanguage ?? 'en';
  const toast = useToast();
  const queryClient = useQueryClient();
  const { openPatient } = usePatientNavigation();
  const canRecordBalance = usePermission('payment:write');
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);

  const editing = patient !== undefined;
  const archived = patient !== undefined && patient.archivedAt !== null;
  const showAccount = !editing && canRecordBalance;

  const form = usePatientForm(
    () =>
      patient
        ? fromPatient(patient, tenant.country)
        : { ...emptyForm(prefill), openingBalanceAsOf: todayIn(tenant.timeZone) },
    tenant,
    formRef,
    patient ? 'edit' : 'create',
  );
  const { initial, values, country, today } = form;
  const [amountText, setAmountText] = useState('');
  // Set once a save has succeeded, so closing the panel afterwards isn't guarded.
  const saved = useRef(false);
  // One save at a time, even for two submits in the same tick (before `isPending` renders).
  const saving = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const dirty = editing ? isEditDirty(initial, values, country) : isDirty(initial, values);
  const ready = values.fullName.trim() !== '' && (values.phone.trim() !== '' || form.phoneOptional);
  // The phone matches an unlinked contact: offer to link it (`linkContactId`). The link holds
  // while the phone stays that number (however it is typed), and goes when it changes.
  const offer = useLinkOffer(values.phone, country, !editing);
  const [linked, setLinked] = useState<{ id: string; fullName: string; phone: string } | null>(
    null,
  );
  const [dismissed, setDismissed] = useState<readonly string[]>([]);
  if (linked !== null && offer.e164 !== linked.phone) {
    setLinked(null);
    form.setLinkContactId(null);
  }
  // Never offered: a contact already added to this patient (a minor's phone is often a parent's).
  const offered =
    linked === null &&
    offer.match !== null &&
    !dismissed.includes(offer.match.id) &&
    !pendingExclusions(values).contactIds.includes(offer.match.id)
      ? offer.match
      : null;

  const twin = useDuplicateTwin({
    fullName: values.fullName,
    dateOfBirth: values.dateOfBirth,
    excludeId: patient?.id,
    today,
  });

  const mutation = useMutation({
    mutationFn: async (): Promise<string> => {
      if (patient) {
        const patch = toPatchPayload(initial, values, country);
        if (patch) await updatePatient(patient.id, patch);
        return patient.id;
      }
      const input = toCreatePayload(values);
      if (showAccount && wantsOpeningBalance(values)) {
        const result = await createWithOpeningBalance({
          patient: input,
          openingBalance: toOpeningBalance(values, today),
        });
        return result.patient.id;
      }
      return (await createPatient(input)).id;
    },
  });

  const submit = async () => {
    if (saving.current) return;
    if (!form.check()) return;
    saving.current = true;
    // What a failure is read against: a create's 409 `contact.already_linked` is its link offer.
    const sent: SentContext = editing ? {} : { linkContactId: values.linkContactId || undefined };
    try {
      const id = await mutation.mutateAsync();
      void invalidatePatientData(queryClient);
      if (!mounted.current) return;
      saved.current = true;
      onClose();
      if (editing) {
        toast(t('form.updated'));
      } else {
        toast(t('form.created'), {
          actionLabel: t('form.openRecord'),
          onAction: () => {
            openPatient(id);
          },
        });
      }
    } catch (error) {
      const failure = failureOf(error, sent);
      // Someone archived the patient meanwhile: reload it, so the form shows why.
      if (failure === 'archived') void invalidatePatientData(queryClient);
      if (!mounted.current) return;
      const fields = fieldErrorsOf(error, sent);
      if (fields) {
        form.showServerErrors(fields);
        return;
      }
      toast(t('form.failed', { reason: t(`failures.${failure}`, FAILURE_VALUES) }), {
        tone: 'danger',
      });
    } finally {
      saving.current = false;
    }
  };

  const message = form.messageOf;

  const field = (name: PatientFieldName, className?: string) => (
    <PatientField form={form} name={name} variant="panel" className={className} />
  );
  const pending = mutation.isPending;

  return (
    <RightPanel
      eyebrow={t(editing ? 'form.editEyebrow' : 'form.newEyebrow')}
      title={patient ? patient.fullName : t('form.newTitle')}
      dirty={dirty}
      onClose={onClose}
      closeDisabled={pending}
      initialFocus="field"
      footer={
        <>
          {!ready && (
            <span className="me-auto text-xs leading-tight text-ink-muted">
              {t('form.requiredHint')}
            </span>
          )}
          <Button disabled={pending} onClick={onClose}>
            {t('common:cancel')}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            busy={pending}
            disabled={!ready || (editing && !dirty)}
          >
            {editing ? t('form.save') : pending ? t('form.creating') : t('form.create')}
          </Button>
        </>
      }
    >
      <UnsavedChangesGuard
        when={dirty}
        isLeaving={(current, next) => !saved.current && leavesForm(current, next)}
      />
      <form
        id={formId}
        ref={formRef}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) void submit();
        }}
        className="flex flex-col gap-3.5"
      >
        {archived && (
          <p
            role="alert"
            className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2.5 text-[12.5px] leading-[1.45] font-medium text-danger"
          >
            {t('form.archivedWhileEditing')}
          </p>
        )}
        {twin && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-lg border border-warning-border bg-warning-bg px-3 py-2.5 text-[12.5px] leading-[1.45] text-warning-ink"
          >
            <p className="m-0 min-w-0 flex-1">
              <b className="font-semibold">{t('form.duplicate.label')}</b>{' '}
              {t('form.duplicate.body', {
                name: twin.fullName,
                number: twin.displayNumber,
                dob: twin.dateOfBirth ? formatCalendarDate(twin.dateOfBirth, locale) : '—',
              })}
            </p>
            <button
              type="button"
              onClick={() => {
                onOpen({ kind: 'quick', id: twin.id });
              }}
              className="flex-none cursor-pointer font-medium text-warning-ink underline"
            >
              {t('form.duplicate.open', { number: twin.displayNumber })}
            </button>
          </div>
        )}

        {field('fullName')}
        {field('phone')}
        {offered && (
          <LinkOffer
            contact={offered}
            onDismiss={() => {
              setDismissed((ids) => [...ids, offered.id]);
            }}
            onLink={() => {
              if (offer.e164 === null) return;
              form.setLinkContactId(offered.id);
              setLinked({ id: offered.id, fullName: offered.fullName, phone: offer.e164 });
            }}
          />
        )}
        {linked && (
          <LinkChip
            name={linked.fullName}
            error={message('linkContactId')}
            onRemove={() => {
              setLinked(null);
              form.setLinkContactId(null);
            }}
          />
        )}
        {patient ? (
          <CurrentContactsSection
            patient={patient}
            minor={form.showGuardianBlock}
            country={country}
          />
        ) : (
          <PendingContactsSection form={form} country={country} />
        )}

        <Eyebrow className="mt-1">{t('form.optional')}</Eyebrow>
        <div className="grid grid-cols-2 gap-x-2.5 gap-y-3">
          {field('dateOfBirth')}
          {field('sex')}
          {field('email', 'col-span-2')}
          {field('address', 'col-span-2')}
          {field('insurance', 'col-span-2')}
          {field('alerts', 'col-span-2')}
          {field('dentist', 'col-span-2')}
          {field('notes', 'col-span-2')}
        </div>

        {showAccount && (
          <AccountFields
            amountText={amountText}
            asOf={values.openingBalanceAsOf}
            note={values.openingBalanceNote}
            recording={wantsOpeningBalance(values)}
            errors={{
              amount: message('openingBalanceAmount'),
              asOf: message('openingBalanceAsOf'),
              note: message('openingBalanceNote'),
            }}
            currency={tenant.currency}
            locale={locale}
            order={form.order}
            today={form.today}
            onAmount={(typed) => {
              setAmountText(typed);
              form.set('openingBalanceAmount')(amountValue(typed, locale));
            }}
            onAsOf={form.set('openingBalanceAsOf')}
            onNote={form.set('openingBalanceNote')}
          />
        )}
      </form>
    </RightPanel>
  );
}
