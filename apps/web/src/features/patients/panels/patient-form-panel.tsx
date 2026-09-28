import {
  dentitionStage,
  isoDateSchema,
  PATIENT_SEXES,
  type Patient,
  type Session,
} from '@dcm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DateInput } from '@/components/ui/date-input';
import { Eyebrow, Field, Select, TextInput } from '@/components/ui/field';
import { RightPanel } from '@/components/ui/right-panel';
import { useToast } from '@/components/ui/toast-context';
import { type GuardLocation, UnsavedChangesGuard } from '@/components/unsaved-changes-guard';
import { usePermission } from '@/features/auth/use-permission';
import { createWithOpeningBalance } from '@/features/billing/billing-api';
import { useStaffNames } from '@/features/users/use-staff-names';
import { ageOrNull, dateInputOrder, formatCalendarDate, todayIn } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type PatientPanel, parsePatientsSearch } from '../list-query';
import {
  amountValue,
  emptyForm,
  fromPatient,
  isDirty,
  isEditDirty,
  parseAlerts,
  type PatientFormPrefill,
  type PatientFormValues,
  showGuardian,
  toCreatePayload,
  toOpeningBalance,
  toPatchPayload,
  validate,
  wantsOpeningBalance,
} from '../patient-form';
import { createPatient, invalidatePatientData, patientQuery, updatePatient } from '../patients-api';
import { AccountFields } from './account-fields';
import { type ErrorField, failureOf, fieldErrorsOf, type FormErrors } from './form-server-errors';
import { PanelFallback } from './panel-fallback';
import { useDuplicateTwin } from './use-duplicate-twin';

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

/** Every form value but `sex` is plain text. */
type TextField = Exclude<keyof PatientFormValues, 'sex'>;

/** Required fields are 40px and prominent, optional ones demoted: 38px on the sunken fill with
 * muted labels (workspace spec §Screen 2). */
type FieldTone = 'required' | 'demoted';

const demoted = 'h-[38px] rounded-[7px] border-border bg-faint';

/**
 * Create / Edit patient (design §Right panel, `Patients.dc.html` form, workspace spec §Screen 2
 * styling): Full name* and Phone* up front, the optional details demoted below, the guardian
 * pair only while the date of birth makes the patient a minor, and — create only, with
 * `payment:write` — the Account group's opening balance (design Q1).
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
  const canRecordBalance = usePermission('payment:write');
  const { names, practitioners } = useStaffNames();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);

  const { country } = tenant;
  const today = todayIn(tenant.timeZone);
  const order = dateInputOrder(country);
  const editing = patient !== undefined;
  const archived = patient !== undefined && patient.archivedAt !== null;
  const showAccount = !editing && canRecordBalance;

  const [initial] = useState<PatientFormValues>(() =>
    patient
      ? fromPatient(patient, country)
      : { ...emptyForm(prefill), openingBalanceAsOf: todayIn(tenant.timeZone) },
  );
  const [values, setValues] = useState(initial);
  const [amountText, setAmountText] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [serverErrors, setServerErrors] = useState<FormErrors>({});
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

  const dirty = editing ? isEditDirty(initial, values, today, country) : isDirty(initial, values);
  const guardian = showGuardian(values, today);
  const ready = values.fullName.trim() !== '' && values.phone.trim() !== '';
  const twin = useDuplicateTwin({
    fullName: values.fullName,
    dateOfBirth: values.dateOfBirth,
    excludeId: patient?.id,
    today,
  });

  const clientErrors = (): FormErrors => validate(values, { country, today });
  const errors: FormErrors = { ...(attempts > 0 ? clientErrors() : {}), ...serverErrors };

  useEffect(() => {
    if (attempts === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempts]);

  const set = (field: TextField) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    const errorField: ErrorField = field === 'alertsText' ? 'alerts' : field;
    // Remove the server's error rather than masking the field's own validation with `undefined`.
    setServerErrors(({ [errorField]: _, ...rest }) => rest);
  };

  const mutation = useMutation({
    mutationFn: async (): Promise<string> => {
      if (patient) {
        const patch = toPatchPayload(initial, values, today, country);
        if (patch) await updatePatient(patient.id, patch);
        return patient.id;
      }
      const input = toCreatePayload(values, today);
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
    setAttempts((count) => count + 1);
    setServerErrors({});
    if (Object.keys(clientErrors()).length > 0) return;
    saving.current = true;
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
            onOpen({ kind: 'quick', id });
          },
        });
      }
    } catch (error) {
      const failure = failureOf(error);
      // Someone archived the patient meanwhile: reload it, so the form shows why.
      if (failure === 'archived') void invalidatePatientData(queryClient);
      if (!mounted.current) return;
      const fields = fieldErrorsOf(error);
      if (fields) {
        setServerErrors(fields);
        setAttempts((count) => count + 1);
        return;
      }
      toast(t('form.failed', { reason: t(`failures.${failure}`) }), { tone: 'danger' });
    } finally {
      saving.current = false;
    }
  };

  const message = (field: ErrorField) => {
    const key = errors[field];
    return key === undefined ? undefined : t(`form.errors.${key}`);
  };

  const text = (
    field: Exclude<TextField, 'alertsText'>,
    options: {
      label: ReactNode;
      hint?: string;
      placeholder?: string;
      type?: string;
      mono?: boolean;
      className?: string;
      tone?: FieldTone;
    },
  ) => {
    const tone = options.tone ?? 'demoted';
    return (
      <Field
        label={options.label}
        hint={options.hint}
        error={message(field)}
        className={cn(tone === 'demoted' && 'text-ink-muted', options.className)}
      >
        {(props) => (
          <TextInput
            {...props}
            type={options.type ?? 'text'}
            inputSize={tone === 'required' ? 'lg' : 'md'}
            placeholder={options.placeholder}
            aria-required={tone === 'required' || undefined}
            value={values[field]}
            onChange={(event) => {
              set(field)(event.target.value);
            }}
            {...(options.mono ? { dir: 'ltr' } : {})}
            className={cn(tone === 'demoted' && demoted, options.mono && 'font-mono')}
          />
        )}
      </Field>
    );
  };

  const required = (label: string) => (
    <>
      {label}
      <span aria-hidden className="ms-0.5 text-danger">
        {'*'}
      </span>
    </>
  );

  const dob = values.dateOfBirth;
  const age = isoDateSchema.safeParse(dob).success ? ageOrNull(dob, today) : null;
  const alerts = parseAlerts(values.alertsText);
  const dentistIds = new Set((practitioners ?? []).map((p) => p.userId));
  const keptDentist =
    initial.primaryDentistUserId !== '' && !dentistIds.has(initial.primaryDentistUserId)
      ? initial.primaryDentistUserId
      : null;
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

        {text('fullName', {
          label: required(t('form.fields.fullName')),
          placeholder: t('form.placeholders.fullName'),
          tone: 'required',
        })}
        {text('phone', {
          label: required(t('form.fields.phone')),
          type: 'tel',
          mono: true,
          tone: 'required',
        })}

        <Eyebrow className="mt-1">{t('form.optional')}</Eyebrow>
        <div className="grid grid-cols-2 gap-x-2.5 gap-y-3">
          <Field
            label={t('form.fields.dateOfBirth')}
            hint={t(`common:dateFormat.${order}`)}
            error={message('dateOfBirth')}
            className="text-ink-muted"
          >
            {(props) => (
              <>
                <DateInput
                  {...props}
                  order={order}
                  value={values.dateOfBirth}
                  onChange={set('dateOfBirth')}
                  className={demoted}
                />
                {age !== null && (
                  <span className="mt-[5px] block text-xs leading-tight text-ink-muted">
                    {t('form.ageLine', {
                      age: t('ageYears', { count: age }),
                      stage: t(`form.dentition.${dentitionStage(age)}`),
                    })}
                  </span>
                )}
              </>
            )}
          </Field>
          <Field label={t('form.fields.sex')} className="text-ink-muted">
            {(props) => (
              <Select
                {...props}
                value={values.sex}
                onChange={(event) => {
                  const sex = PATIENT_SEXES.find((value) => value === event.target.value);
                  if (sex) setValues((current) => ({ ...current, sex }));
                }}
                className={demoted}
              >
                {PATIENT_SEXES.map((sex) => (
                  <option key={sex} value={sex}>
                    {t(`form.sexOptions.${sex}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {guardian && (
            <>
              {text('guardianName', {
                label: t('form.fields.guardianName'),
                hint: t('form.guardianHint'),
              })}
              {text('guardianPhone', {
                label: t('form.fields.guardianPhone'),
                type: 'tel',
                mono: true,
              })}
            </>
          )}
          {text('email', {
            label: t('form.fields.email'),
            type: 'email',
            placeholder: t('form.placeholders.email'),
            className: 'col-span-2',
          })}
          {text('address', { label: t('form.fields.address'), className: 'col-span-2' })}
          {text('insurance', {
            label: t('form.fields.insurance'),
            placeholder: t('form.placeholders.insurance'),
          })}
          {text('emergencyContact', {
            label: t('form.fields.emergencyContact'),
            placeholder: t('form.placeholders.emergencyContact'),
          })}
          <Field
            label={t('form.fields.alerts')}
            hint={t('form.alertsHint')}
            error={message('alerts')}
            className="col-span-2 text-ink-muted"
          >
            {(props) => (
              <>
                <TextInput
                  {...props}
                  placeholder={t('form.placeholders.alerts')}
                  value={values.alertsText}
                  onChange={(event) => {
                    set('alertsText')(event.target.value);
                  }}
                  className={demoted}
                />
                {alerts.length > 0 && (
                  <ul className="m-0 mt-1.5 flex list-none flex-wrap gap-1.5 p-0">
                    {alerts.map((alert) => (
                      <li
                        key={alert}
                        className="rounded-md border border-danger-border bg-danger-bg px-2 py-1 text-[11.5px] leading-none font-medium text-danger"
                      >
                        {alert}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </Field>
          <Field
            label={t('form.fields.dentist')}
            error={message('primaryDentistUserId')}
            className="col-span-2 text-ink-muted"
          >
            {(props) => (
              <Select
                {...props}
                value={values.primaryDentistUserId}
                onChange={(event) => {
                  set('primaryDentistUserId')(event.target.value);
                }}
                className={demoted}
              >
                <option value="">{t('form.noDentist')}</option>
                {(practitioners ?? []).map((practitioner) => (
                  <option key={practitioner.userId} value={practitioner.userId}>
                    {practitioner.displayName}
                  </option>
                ))}
                {keptDentist !== null && (
                  <option value={keptDentist}>
                    {names.get(keptDentist) ?? t('quickView.unknownDentist')}
                  </option>
                )}
              </Select>
            )}
          </Field>
          <Field
            label={t('form.fields.notes')}
            error={message('notes')}
            className="col-span-2 text-ink-muted"
          >
            {(props) => (
              <textarea
                {...props}
                rows={3}
                value={values.notes}
                onChange={(event) => {
                  set('notes')(event.target.value);
                }}
                className="w-full resize-y rounded-[7px] border border-border bg-faint px-[11px] py-[9px] text-[13px] leading-[1.45] text-ink aria-invalid:border-danger"
              />
            )}
          </Field>
        </div>

        {showAccount && (
          <AccountFields
            amountText={amountText}
            asOf={values.openingBalanceAsOf}
            note={values.openingBalanceNote}
            errors={{
              amount: message('openingBalanceAmount'),
              asOf: message('openingBalanceAsOf'),
              note: message('openingBalanceNote'),
            }}
            currency={tenant.currency}
            locale={locale}
            order={order}
            onAmount={(typed) => {
              setAmountText(typed);
              set('openingBalanceAmount')(amountValue(typed, locale));
            }}
            onAsOf={set('openingBalanceAsOf')}
            onNote={set('openingBalanceNote')}
          />
        )}
      </form>
    </RightPanel>
  );
}
