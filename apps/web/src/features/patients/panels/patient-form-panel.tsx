import {
  ageOn,
  dentitionStage,
  isoDateSchema,
  nameSchema,
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
import { MoneyInput } from '@/features/billing/money-input';
import { useStaffNames } from '@/features/users/use-staff-names';
import { ApiError } from '@/lib/api';
import { dateInputOrder, formatCalendarDate, todayIn } from '@/lib/format';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { cn } from '@/lib/utils';
import type { PatientPanel } from '../list-query';
import {
  emptyForm,
  type FormErrorKey,
  type FormField,
  fromPatient,
  isDirty,
  isEditDirty,
  parseAlerts,
  type PatientFormPrefill,
  type PatientFormValues,
  sanitizeAmount,
  showGuardian,
  toCreatePayload,
  toOpeningBalance,
  toPatchPayload,
  validate,
  wantsOpeningBalance,
} from '../patient-form';
import {
  createPatient,
  duplicateCheckQuery,
  invalidatePatientData,
  patientQuery,
  updatePatient,
} from '../patients-api';
import { PanelFallback } from './panel-fallback';

type Tenant = NonNullable<Session['tenant']>;

export type FormMode =
  | { kind: 'new'; prefill: { fullName?: string | undefined; phone?: string | undefined } }
  | { kind: 'edit'; id: string };

/** Every field an error can sit on: the form's own plus the dentist select (a server-only
 * `patient.unknown_dentist`). */
type ErrorField = FormField | 'primaryDentistUserId';
type ErrorKey = FormErrorKey | 'invalid' | 'unknownDentist';
type Errors = Partial<Record<ErrorField, ErrorKey>>;

const DUPLICATE_CHECK_DELAY = 300;
const DATE_OF_BIRTH_FLOOR = '1900-01-01';

/** Problem `errors[].path` (`patient.` prefixed on the opening-balance route) → form field. */
const SERVER_FIELDS: Record<string, ErrorField> = {
  fullName: 'fullName',
  phone: 'phone',
  dateOfBirth: 'dateOfBirth',
  email: 'email',
  address: 'address',
  insurance: 'insurance',
  emergencyContact: 'emergencyContact',
  notes: 'notes',
  guardianName: 'guardianName',
  guardianPhone: 'guardianPhone',
  medicalAlerts: 'alerts',
  primaryDentistUserId: 'primaryDentistUserId',
  'openingBalance.amount': 'openingBalanceAmount',
  'openingBalance.asOf': 'openingBalanceAsOf',
  'openingBalance.note': 'openingBalanceNote',
};

const SERVER_ERROR_KEYS: Partial<Record<ErrorField, ErrorKey>> = {
  phone: 'invalidPhone',
  guardianPhone: 'invalidPhone',
  email: 'invalidEmail',
  openingBalanceAmount: 'invalidAmount',
};

function fieldOfPath(path: string): ErrorField | undefined {
  const bare = path.replace(/^patient\./, '');
  return SERVER_FIELDS[bare] ?? (bare.startsWith('medicalAlerts') ? 'alerts' : undefined);
}

/** The field errors a failed save maps onto the form, or `null` when it isn't about a field. */
function serverErrorsOf(error: unknown): Errors | null {
  if (!(error instanceof ApiError)) return null;
  if (error.code === 'patient.unknown_dentist') return { primaryDentistUserId: 'unknownDentist' };
  const errors: Errors = {};
  for (const { path } of error.problem.errors ?? []) {
    const field = fieldOfPath(path);
    if (field) errors[field] = SERVER_ERROR_KEYS[field] ?? 'invalid';
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

const panelOf = (search: unknown) =>
  typeof search === 'object' && search !== null && 'panel' in search ? String(search.panel) : '';

/** A panel held in the URL search is left when its `panel` param changes, not just the path. */
const leavesPanel = (current: GuardLocation, next: GuardLocation) =>
  current.pathname !== next.pathname || panelOf(current.search) !== panelOf(next.search);

/** Every form value but `sex` is plain text. */
type TextField = Exclude<keyof PatientFormValues, 'sex'>;

/** Required fields are 40px and prominent, optional ones demoted: 38px on the sunken fill with
 * muted labels (workspace spec §Screen 2); the Account group is plain 36px. */
type FieldTone = 'required' | 'demoted' | 'plain';

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
  if (patient.data.archivedAt !== null) {
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
  const { t, i18n } = useTranslation(['patients', 'billing', 'common']);
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
  const showAccount = !editing && canRecordBalance;

  const [initial] = useState<PatientFormValues>(() =>
    patient
      ? fromPatient(patient, country)
      : { ...emptyForm(prefill), openingBalanceAsOf: todayIn(tenant.timeZone) },
  );
  const [values, setValues] = useState(initial);
  const [amountText, setAmountText] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [serverErrors, setServerErrors] = useState<Errors>({});
  // Set once a save has succeeded, so closing the panel afterwards isn't guarded.
  const saved = useRef(false);

  const dirty = editing ? isEditDirty(initial, values, today, country) : isDirty(initial, values);
  const guardian = showGuardian(values, today);
  const ready = values.fullName.trim() !== '' && values.phone.trim() !== '';

  const clientErrors = (): Errors => {
    const found: Errors = validate(values, { country, today });
    if (showAccount && amountText.trim() !== '' && values.openingBalanceAmount === '') {
      found.openingBalanceAmount = 'invalidAmount';
    }
    return found;
  };
  const errors: Errors = { ...(attempts > 0 ? clientErrors() : {}), ...serverErrors };

  useEffect(() => {
    if (attempts === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempts]);

  const duplicateName = useDebouncedValue(values.fullName.trim(), DUPLICATE_CHECK_DELAY);
  const duplicateDob = useDebouncedValue(values.dateOfBirth, DUPLICATE_CHECK_DELAY);
  const checkable =
    nameSchema.safeParse(duplicateName).success &&
    isoDateSchema.safeParse(duplicateDob).success &&
    duplicateDob <= today &&
    duplicateDob >= DATE_OF_BIRTH_FLOOR;
  const duplicates = useQuery({
    ...duplicateCheckQuery({
      fullName: duplicateName,
      dateOfBirth: duplicateDob,
      excludeId: patient?.id,
    }),
    enabled: checkable,
  });
  const twin = checkable ? duplicates.data?.[0] : undefined;

  const set = (field: TextField) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    const errorField: ErrorField = field === 'alertsText' ? 'alerts' : field;
    setServerErrors((current) => ({ ...current, [errorField]: undefined }));
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
    setAttempts((count) => count + 1);
    setServerErrors({});
    if (Object.keys(clientErrors()).length > 0) return;
    try {
      const id = await mutation.mutateAsync();
      void invalidatePatientData(queryClient);
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
      const fields = serverErrorsOf(error);
      if (fields) {
        setServerErrors(fields);
        setAttempts((count) => count + 1);
        return;
      }
      const reason = error instanceof ApiError ? error.problem.title : t('common:unexpected');
      toast(t('form.failed', { reason }), { tone: 'danger' });
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
  const age = isoDateSchema.safeParse(dob).success && dob <= today ? ageOn(dob, today) : null;
  const alerts = parseAlerts(values.alertsText);
  const dentistIds = new Set((practitioners ?? []).map((p) => p.userId));
  const keptDentist =
    initial.primaryDentistUserId !== '' && !dentistIds.has(initial.primaryDentistUserId)
      ? initial.primaryDentistUserId
      : null;

  return (
    <RightPanel
      eyebrow={t(editing ? 'form.editEyebrow' : 'form.newEyebrow')}
      title={patient ? patient.fullName : t('form.newTitle')}
      dirty={dirty}
      onClose={onClose}
      footer={
        <>
          {!ready && (
            <span className="me-auto text-xs leading-tight text-ink-muted">
              {t('form.requiredHint')}
            </span>
          )}
          <Button onClick={onClose}>{t('common:cancel')}</Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            busy={mutation.isPending}
            disabled={!ready || (editing && !dirty)}
          >
            {editing ? t('form.save') : mutation.isPending ? t('form.creating') : t('form.create')}
          </Button>
        </>
      }
    >
      <UnsavedChangesGuard
        when={dirty}
        isLeaving={(current, next) => !saved.current && leavesPanel(current, next)}
      />
      <form
        id={formId}
        ref={formRef}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (ready && !mutation.isPending) void submit();
        }}
        className="flex flex-col gap-3.5"
      >
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
                      age,
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
          <>
            <Eyebrow className="mt-1">{t('billing:account.title')}</Eyebrow>
            <div className="grid grid-cols-2 gap-x-2.5 gap-y-3">
              <Field
                label={t('billing:account.openingBalance')}
                hint={t('billing:account.openingBalanceHint')}
                error={message('openingBalanceAmount')}
              >
                {(props) => (
                  <MoneyInput
                    {...props}
                    value={amountText}
                    currency={tenant.currency}
                    locale={locale}
                    onChange={(typed) => {
                      setAmountText(typed);
                      set('openingBalanceAmount')(sanitizeAmount(typed, locale));
                    }}
                  />
                )}
              </Field>
              <Field label={t('billing:account.asOf')} error={message('openingBalanceAsOf')}>
                {(props) => (
                  <DateInput
                    {...props}
                    order={order}
                    value={values.openingBalanceAsOf}
                    onChange={set('openingBalanceAsOf')}
                  />
                )}
              </Field>
              {text('openingBalanceNote', {
                label: t('billing:account.note'),
                placeholder: t('billing:account.notePlaceholder'),
                className: 'col-span-2',
                tone: 'plain',
              })}
            </div>
          </>
        )}
      </form>
    </RightPanel>
  );
}
