import { dentitionStage, isoDateSchema, PATIENT_SEXES } from '@dcm/contracts';
import type { SelectHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { DateInput } from '@/components/ui/date-input';
import { Field, Select, TextInput } from '@/components/ui/field';
import { useStaffNames } from '@/features/users/use-staff-names';
import { ageOrNull } from '@/lib/format';
import { cn } from '@/lib/utils';
import { parseAlerts } from './patient-form';
import type { PatientForm, TextField } from './use-patient-form';

export type PatientFieldName =
  | 'fullName'
  | 'phone'
  | 'dateOfBirth'
  | 'sex'
  | 'guardianName'
  | 'guardianPhone'
  | 'email'
  | 'address'
  | 'insurance'
  | 'emergencyContact'
  | 'alerts'
  | 'dentist'
  | 'notes';

/**
 * Where the field sits: the right panel (workspace spec §Screen 2 — Full name and Phone required
 * and prominent at 40px, the rest demoted: 38px on the sunken fill with muted labels), or the
 * record's Patient information card (§Tab: Patient information — 36px inputs, 7px radius,
 * uppercase labels).
 */
export type FieldVariant = 'panel' | 'page';

type Tone = 'required' | 'demoted' | 'page';

const REQUIRED: ReadonlySet<PatientFieldName> = new Set(['fullName', 'phone']);

const INPUT: Record<Tone, string> = {
  required: '',
  demoted: 'h-[38px] rounded-[7px] border-border bg-faint',
  page: 'rounded-[7px]',
};

const TEXTAREA: Record<Tone, string> = {
  required: '',
  demoted: 'border-border bg-faint',
  page: 'border-border-control bg-surface',
};

/**
 * One field of the patient form, bound to `form` (`usePatientForm`) — the one rendering of each
 * field the create/edit panel and the Patient information tab share; each arranges them itself.
 * The guardian pair is the caller's to show only while `form.guardian` holds.
 */
export function PatientField({
  form,
  name,
  variant,
  className,
}: {
  form: PatientForm;
  name: PatientFieldName;
  variant: FieldVariant;
  className?: string;
}) {
  const { t } = useTranslation(['patients', 'common']);
  const { values, set } = form;
  const tone: Tone = variant === 'page' ? 'page' : REQUIRED.has(name) ? 'required' : 'demoted';
  const wrapper = cn(tone === 'demoted' && 'text-ink-muted', className);

  const message = form.messageOf;

  const label = (text: string) => {
    const required = REQUIRED.has(name) && (
      <span aria-hidden className="ms-0.5 text-danger">
        {'*'}
      </span>
    );
    if (tone !== 'page') {
      return (
        <>
          {text}
          {required}
        </>
      );
    }
    return (
      <span className="tracking-[0.04em] text-ink-tertiary uppercase">
        {text}
        {required}
      </span>
    );
  };

  const text = (
    field: Exclude<TextField, 'alertsText'>,
    options: {
      label: string;
      hint?: string;
      placeholder?: string;
      type?: string;
      mono?: boolean;
    },
  ) => (
    <Field
      label={label(options.label)}
      hint={options.hint}
      error={message(field)}
      className={wrapper}
    >
      {(props) => (
        <TextInput
          {...props}
          type={options.type ?? 'text'}
          inputSize={tone === 'required' ? 'lg' : 'md'}
          placeholder={options.placeholder}
          aria-required={REQUIRED.has(name) || undefined}
          value={values[field]}
          onChange={(event) => {
            set(field)(event.target.value);
          }}
          {...(options.mono ? { dir: 'ltr' } : {})}
          className={cn(INPUT[tone], options.mono && 'font-mono')}
        />
      )}
    </Field>
  );

  switch (name) {
    case 'fullName':
      return text('fullName', {
        label: t('form.fields.fullName'),
        placeholder: t('form.placeholders.fullName'),
      });
    case 'phone':
      return text('phone', { label: t('form.fields.phone'), type: 'tel', mono: true });
    case 'guardianName':
      return text('guardianName', {
        label: t('form.fields.guardianName'),
        hint: t('form.guardianHint'),
      });
    case 'guardianPhone':
      return text('guardianPhone', {
        label: t('form.fields.guardianPhone'),
        type: 'tel',
        mono: true,
      });
    case 'email':
      return text('email', {
        label: t('form.fields.email'),
        type: 'email',
        placeholder: t('form.placeholders.email'),
      });
    case 'address':
      return text('address', { label: t('form.fields.address') });
    case 'insurance':
      return text('insurance', {
        label: t('form.fields.insurance'),
        placeholder: t('form.placeholders.insurance'),
      });
    case 'emergencyContact':
      return text('emergencyContact', {
        label: t('form.fields.emergencyContact'),
        placeholder: t('form.placeholders.emergencyContact'),
      });
    case 'dateOfBirth': {
      const dob = values.dateOfBirth;
      const age = isoDateSchema.safeParse(dob).success ? ageOrNull(dob, form.today) : null;
      return (
        <Field
          label={label(t('form.fields.dateOfBirth'))}
          hint={t(`common:dateFormat.${form.order}`)}
          error={message('dateOfBirth')}
          className={wrapper}
        >
          {(props) => (
            <>
              <DateInput
                {...props}
                order={form.order}
                value={dob}
                onChange={set('dateOfBirth')}
                className={INPUT[tone]}
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
      );
    }
    case 'sex':
      return (
        <Field label={label(t('form.fields.sex'))} className={wrapper}>
          {(props) => (
            <Select
              {...props}
              value={values.sex}
              onChange={(event) => {
                const sex = PATIENT_SEXES.find((value) => value === event.target.value);
                if (sex) form.setSex(sex);
              }}
              className={INPUT[tone]}
            >
              {PATIENT_SEXES.map((sex) => (
                <option key={sex} value={sex}>
                  {t(`form.sexOptions.${sex}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      );
    case 'alerts': {
      const alerts = parseAlerts(values.alertsText);
      return (
        <Field
          label={label(t('form.fields.alerts'))}
          hint={t('form.alertsHint')}
          error={message('alerts')}
          className={wrapper}
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
                className={INPUT[tone]}
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
      );
    }
    case 'dentist':
      return (
        <Field
          label={label(t('form.fields.dentist'))}
          error={message('primaryDentistUserId')}
          className={wrapper}
        >
          {(props) => (
            <DentistSelect
              {...props}
              value={values.primaryDentistUserId}
              current={form.initial.primaryDentistUserId}
              onValue={set('primaryDentistUserId')}
              className={INPUT[tone]}
            />
          )}
        </Field>
      );
    case 'notes':
      return (
        <Field label={label(t('form.fields.notes'))} error={message('notes')} className={wrapper}>
          {(props) => (
            <textarea
              {...props}
              rows={3}
              value={values.notes}
              onChange={(event) => {
                set('notes')(event.target.value);
              }}
              className={cn(
                'w-full resize-y rounded-[7px] border px-[11px] py-[9px] text-[13px] leading-[1.45] text-ink aria-invalid:border-danger',
                TEXTAREA[tone],
              )}
            />
          )}
        </Field>
      );
  }
}

/** The primary dentist picker: the active practitioners, plus the patient's `current` dentist
 * when no longer one of them (deactivated), so saving other fields never drops it. */
function DentistSelect({
  current,
  onValue,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  value: string;
  current: string;
  onValue: (value: string) => void;
}) {
  const { t } = useTranslation('patients');
  const { names, practitioners } = useStaffNames();
  const active = new Set((practitioners ?? []).map((p) => p.userId));
  const kept = current !== '' && !active.has(current) ? current : null;
  return (
    <Select
      {...props}
      onChange={(event) => {
        onValue(event.target.value);
      }}
    >
      <option value="">{t('form.noDentist')}</option>
      {(practitioners ?? []).map((practitioner) => (
        <option key={practitioner.userId} value={practitioner.userId}>
          {practitioner.displayName}
        </option>
      ))}
      {kept !== null && (
        <option value={kept}>{names.get(kept) ?? t('quickView.unknownDentist')}</option>
      )}
    </Select>
  );
}
