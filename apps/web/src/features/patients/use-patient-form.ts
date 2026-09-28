import type { PatientSex, Session } from '@dcm/contracts';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dateInputOrder, todayIn } from '@/lib/format';
import { type ErrorField, type FormErrors } from './panels/form-server-errors';
import { type PatientFormValues, phoneOptional, validate } from './patient-form';

type Tenant = NonNullable<Session['tenant']>;

/** Every form value but `sex` is plain text. */
export type TextField = Exclude<keyof PatientFormValues, 'sex'>;

/**
 * The state of one patient form (`patient-form.ts`'s model), shared by the create/edit panel and
 * the record's Patient information tab: the values against their starting point, the errors to
 * show (client-side ones only once a save was attempted, plus whatever the server rejected), and
 * the tenant facts every field reads (country, today in the tenant's zone, DOB order). `formRef`
 * is the caller's `<form>`: each save attempt that shows errors focuses its first invalid field.
 * In `edit` mode the phone rule only applies to an edit that touches the phone or the date of
 * birth (`phoneOptional`), as on the server.
 */
export function usePatientForm(
  start: () => PatientFormValues,
  tenant: Tenant,
  formRef: RefObject<HTMLFormElement | null>,
  mode: 'create' | 'edit',
) {
  const { t } = useTranslation('patients');
  const { country } = tenant;
  const today = todayIn(tenant.timeZone);
  const order = dateInputOrder(country);

  const [initial, setInitial] = useState(start);
  const [values, setValues] = useState(initial);
  const [attempts, setAttempts] = useState(0);
  const [serverErrors, setServerErrors] = useState<FormErrors>({});
  // The values as last rendered, for a save that settles after the person typed on.
  const latest = useRef(values);
  useEffect(() => {
    latest.current = values;
  }, [values]);

  // Each attempt that shows errors moves focus to the first field in error.
  useEffect(() => {
    if (attempts === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [attempts, formRef]);

  const baseline = mode === 'edit' ? initial : undefined;
  const clientErrors = (): FormErrors =>
    validate(values, { country, today, ...(baseline ? { initial: baseline } : {}) });
  const errors: FormErrors = { ...(attempts > 0 ? clientErrors() : {}), ...serverErrors };

  const set = (field: TextField) => (value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    const errorField: ErrorField = field === 'alertsText' ? 'alerts' : field;
    // Remove the server's error rather than masking the field's own validation with `undefined`.
    setServerErrors(({ [errorField]: _, ...rest }) => rest);
  };

  /** Replaces the values with `next` (a new starting point) and forgets past attempts, so fields
   * are not validated eagerly again until the next save. */
  const replaceWith = (next: PatientFormValues) => {
    setInitial(next);
    setValues(next);
    setAttempts(0);
    setServerErrors({});
  };

  return {
    initial,
    values,
    errors,
    /** A field's error message, in the person's language. */
    messageOf: (field: ErrorField): string | undefined => {
      const key = errors[field];
      return key === undefined ? undefined : t(`form.errors.${key}`);
    },
    country,
    today,
    order,
    /** The phone is optional while the DOB makes the patient a minor (design addendum C3). */
    phoneOptional: phoneOptional(values, today, baseline),
    set,
    setSex: (sex: PatientSex) => {
      setValues((current) => ({ ...current, sex }));
    },
    /** Starts a save attempt: shows every client-side error (focusing the first) and clears the
     * server's; true when the values are valid. */
    check: (): boolean => {
      setAttempts((count) => count + 1);
      setServerErrors({});
      return Object.keys(clientErrors()).length === 0;
    },
    /** The fields a failed save was rejected for (`fieldErrorsOf`). */
    showServerErrors: (fields: FormErrors) => {
      setServerErrors(fields);
      setAttempts((count) => count + 1);
    },
    /** The record changed underneath an untouched form: it follows. */
    reset: replaceWith,
    /** After a save: `saved` becomes the new starting point, and the values too — unless they
     * were edited again while `submitted` was being saved, in which case those edits stay (and so
     * do their errors). */
    rebase: (saved: PatientFormValues, submitted: PatientFormValues) => {
      if (latest.current === submitted) replaceWith(saved);
      else setInitial(saved);
    },
  };
}

export type PatientForm = ReturnType<typeof usePatientForm>;
